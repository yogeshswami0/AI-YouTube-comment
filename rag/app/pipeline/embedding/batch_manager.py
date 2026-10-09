"""
app/pipeline/embedding/batch_manager.py

Splits a ChunkBatch into smaller sub-batches, calls the model,
and handles transient failures with exponential backoff retry.

Why batch?
  - sentence-transformers encodes a list of strings in one GPU/CPU pass.
  - Larger batches = better hardware utilisation but more memory.
  - BGE_BATCH_SIZE in config (default 32) is the sweet spot for CPU.
  - If one batch fails we retry just that batch, not the whole video.
"""

import time

from sentence_transformers import SentenceTransformer

from app.core.config import get_settings
from app.core.exceptions import EmbeddingBatchError
from app.core.logger import get_logger
from app.pipeline.chunking.models import ChunkBatch
from app.pipeline.embedding.models import EmbeddingResult

logger = get_logger(__name__)
settings = get_settings()

_MAX_RETRIES = 3
_BASE_DELAY_SECONDS = 1.0   # doubles on each retry: 1s, 2s, 4s


class BatchManager:
    """
    Handles sub-batching and retry logic for embedding inference.

    Args:
        model:      Loaded SentenceTransformer model instance.
        batch_size: Number of texts per model inference call.
    """

    def __init__(self, model: SentenceTransformer, batch_size: int) -> None:
        self._model = model
        self._batch_size = batch_size

    def embed(self, chunk_batch: ChunkBatch) -> list[EmbeddingResult]:
        """
        Embeds all chunks in chunk_batch, splitting into sub-batches internally.

        Returns:
            List of EmbeddingResult in the same order as chunk_batch.chunks.

        Raises:
            EmbeddingBatchError: if a sub-batch fails after _MAX_RETRIES attempts.
        """
        chunks = chunk_batch.chunks
        all_results: list[EmbeddingResult] = []

        # Split into sub-batches
        sub_batches = [
            chunks[i: i + self._batch_size]
            for i in range(0, len(chunks), self._batch_size)
        ]

        for batch_idx, sub_batch in enumerate(sub_batches):
            texts = [c.text_for_embedding for c in sub_batch]
            vectors = self._embed_with_retry(texts, batch_idx)
            
            # Immediately delete texts arrays to clear the string payload from RAM
            del texts

            for chunk, vector in zip(sub_batch, vectors):
                all_results.append(EmbeddingResult(
                    chunk_id=chunk.chunk_id,
                    vector=vector,
                    dimension=len(vector),
                ))

            logger.debug(
                "Sub-batch embedded",
                batch_idx=batch_idx,
                batch_size=len(sub_batch),
                total_batches=len(sub_batches),
                video_id=chunk_batch.video_id,
            )
            
            # Wipe generated vectors arrays and invoke PyTorch CPU garbage collection natively 
            del vectors
            import gc
            gc.collect()

        return all_results

    def _embed_with_retry(
        self,
        texts: list[str],
        batch_idx: int,
    ) -> list[list[float]]:
        """
        Calls model.encode with exponential backoff on failure.

        Returns list of float vectors in same order as texts.
        """
        delay = _BASE_DELAY_SECONDS

        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                vectors = self._model.encode(
                    texts,
                    normalize_embeddings=settings.BGE_NORMALIZE_EMBEDDINGS,
                    batch_size=self._batch_size,
                    show_progress_bar=False,
                )
                
                # Convert standard tensors into Python floats then destroy the tensor representation entirely
                converted_vectors = [v.tolist() for v in vectors]
                del vectors
                
                import gc
                gc.collect()
                return converted_vectors

            except Exception as exc:
                if attempt == _MAX_RETRIES:
                    raise EmbeddingBatchError(
                        message=(
                            f"Sub-batch {batch_idx} failed after {_MAX_RETRIES} retries."
                        ),
                        batch_index=batch_idx,
                        detail=str(exc),
                    ) from exc

                logger.warning(
                    "Embedding sub-batch failed, retrying",
                    batch_idx=batch_idx,
                    attempt=attempt,
                    retry_in_seconds=delay,
                    error=str(exc),
                )
                time.sleep(delay)
                delay *= 2  # exponential backoff

        # Unreachable — satisfies type checker
        raise EmbeddingBatchError(
            message=f"Sub-batch {batch_idx} exhausted retries.",
            batch_index=batch_idx,
        )
