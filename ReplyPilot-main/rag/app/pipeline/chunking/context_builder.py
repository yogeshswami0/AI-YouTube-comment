"""
app/pipeline/chunking/context_builder.py

Prepends a context prefix from the previous chunk to each chunk's
`text_for_embedding` field.

Why this matters:
  A chunk starting at t=60s often begins mid-topic. Without any prior
  context the embedding only captures what's in that window. By prefixing
  the last N sentences of the previous chunk, the embedding model
  understands the discourse thread and retrieves more accurately.

  This is the "Contextual Retrieval" technique from Anthropic's research:
  each chunk's embedding is enriched with surrounding context, but the
  raw_text returned to users stays clean (no prefix clutter).

Format of text_for_embedding after this stage:
  "[Context: <last N sentences of previous chunk>] <current chunk text>"

The prefix is wrapped in a neutral marker so the BGE model treats it
as background context, not part of the chunk's main content.
"""

from app.core.config import get_settings
from app.core.logger import get_logger
from app.pipeline.chunking.models import Chunk, ChunkBatch

logger = get_logger(__name__)
settings = get_settings()

_CONTEXT_MARKER = "[Context: {}]"


def _last_n_sentences(text: str, n: int) -> str:
    """
    Extracts the last N sentences from a text block.
    Falls back to the full text if fewer than N sentences exist.

    Simple sentence boundary detection — splits on '. ', '! ', '? '.
    Good enough for transcript text which lacks complex punctuation.
    """
    # Split on sentence-ending punctuation followed by a space or end-of-string
    import re
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    last_n = sentences[-n:] if len(sentences) >= n else sentences
    return " ".join(last_n).strip()


def build_context(batch: ChunkBatch) -> ChunkBatch:
    """
    Mutates each chunk's `text_for_embedding` to include a context prefix
    derived from the previous chunk's raw_text.

    The first chunk in a video has no previous chunk, so it gets no prefix.
    Its text_for_embedding stays identical to its raw_text.

    Args:
        batch: ChunkBatch output from TimeBasedChunker.

    Returns:
        The same ChunkBatch with updated text_for_embedding fields.
        raw_text fields are never modified.
    """
    n_sentences = settings.CONTEXT_PREFIX_SENTENCES

    enriched_chunks: list[Chunk] = []

    for i, chunk in enumerate(batch.chunks):
        if i == 0:
            # First chunk — no previous context available
            enriched_chunks.append(chunk)
            continue

        prev_chunk = batch.chunks[i - 1]
        context_text = _last_n_sentences(prev_chunk.raw_text, n_sentences)

        if context_text:
            prefix = _CONTEXT_MARKER.format(context_text)
            new_embedding_text = f"{prefix} {chunk.raw_text}"
        else:
            new_embedding_text = chunk.raw_text

        # Pydantic models are immutable by default — use model_copy
        enriched_chunks.append(chunk.model_copy(
            update={"text_for_embedding": new_embedding_text}
        ))

    logger.info(
        "Context prefixes applied",
        video_id=batch.video_id,
        chunks_with_context=len(enriched_chunks) - 1,  # all except first
        context_sentences=n_sentences,
    )

    return ChunkBatch(
        video_id=batch.video_id,
        chunks=enriched_chunks,
        total_chunks=batch.total_chunks,
        total_duration_seconds=batch.total_duration_seconds,
    )