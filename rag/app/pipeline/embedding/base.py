"""
app/pipeline/embedding/base.py

Abstract base class for embedding providers.
The rest of the pipeline only ever sees EmbeddingProvider — swap BGE for
anything else by adding a new subclass without touching orchestrator.py.
"""

from abc import ABC, abstractmethod

from app.pipeline.chunking.models import ChunkBatch
from app.pipeline.embedding.models import EmbeddingBatch


class EmbeddingProvider(ABC):
    """Interface that every embedding implementation must satisfy."""

    @abstractmethod
    def embed_chunks(self, batch: ChunkBatch) -> EmbeddingBatch:
        """
        Embed all chunks in a ChunkBatch.

        Uses text_for_embedding (with context prefix) — NOT raw_text.

        Args:
            batch: ChunkBatch from the context builder stage.

        Returns:
            EmbeddingBatch with one EmbeddingResult per chunk.

        Raises:
            EmbeddingError:      model load or inference failure.
            EmbeddingBatchError: a specific batch fails after all retries.
        """
        ...

    @abstractmethod
    def embed_query(self, text: str) -> list[float]:
        """
        Embed a single query string at retrieval time.

        Must use the SAME model as embed_chunks so vector spaces match.

        Args:
            text: Raw user question string.

        Returns:
            List of floats (the embedding vector).

        Raises:
            QueryEmbeddingError: inference failure.
        """
        ...

    @property
    @abstractmethod
    def dimension(self) -> int:
        """Vector dimension produced by this model."""
        ...

    @property
    @abstractmethod
    def model_name(self) -> str:
        """HuggingFace model identifier string."""
        ...