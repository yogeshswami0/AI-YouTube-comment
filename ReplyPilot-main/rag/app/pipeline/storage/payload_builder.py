"""
app/pipeline/storage/payload_builder.py

Builds the metadata dict stored alongside each vector in Pinecone.

Pinecone metadata is used for:
  1. Filtered search  — restrict query to a specific video_id
  2. Result display   — return chunk text and timestamps to the user
     without a separate DB lookup

What we store:
  All chunk fields EXCEPT text_for_embedding (it served its purpose
  at embedding time and doesn't need to be persisted).
  raw_text IS stored so retrieval returns displayable text.

Pinecone metadata limits (free tier):
  - Max 40KB metadata per vector
  - Max 1000 unique keys across the index
  - Filterable fields must be string, number, or boolean
"""

from app.pipeline.chunking.models import Chunk
from app.pipeline.embedding.models import EmbeddingResult
from app.pipeline.storage.models import VectorRecord


def build_vector_records(
    chunks: list[Chunk],
    embedding_results: list[EmbeddingResult],
) -> list[VectorRecord]:
    """
    Zips chunks with their embedding vectors to produce Pinecone upsert records.

    Args:
        chunks:            All chunks from the ChunkBatch (after context building).
        embedding_results: EmbeddingResults from the BGE embedder, same order.

    Returns:
        List of VectorRecord ready for pinecone_client.upsert().

    Note:
        Chunks and embedding_results must be in the same order.
        The orchestrator guarantees this by passing them in pipeline order.
    """
    assert len(chunks) == len(embedding_results), (
        f"Chunk count ({len(chunks)}) != embedding result count ({len(embedding_results)}). "
        "This is an orchestrator bug — chunks and embeddings must be aligned."
    )

    records: list[VectorRecord] = []

    for chunk, emb in zip(chunks, embedding_results):
        metadata: dict = {
            # ── Identifiers ─────────────────────────────
            "video_id": chunk.video_id,
            "chunk_id": chunk.chunk_id,
            "chunk_index": chunk.chunk_index,

            # ── Content ──────────────────────────────────
            "text": chunk.raw_text,   # stored as "text" for clean retrieval

            # ── Time metadata (enables deep-linking) ─────
            "start_time_seconds": chunk.start_time_seconds,
            "end_time_seconds": chunk.end_time_seconds,
            "chunk_window_seconds": chunk.chunk_window_seconds,

            # ── Video metadata ───────────────────────────
            "video_title": chunk.video_title or "",
            "channel_name": chunk.channel_name or "",
        }

        records.append(VectorRecord(
            id=chunk.chunk_id,
            values=emb.vector,
            metadata=metadata,
        ))

    return records