"""
app/pipeline/embedding/bge_embedder.py

BGE embedding implementation using sentence-transformers.

Supports:
  BAAI/bge-base-en-v1.5   → 768-dim,  fast,    English only
  BAAI/bge-large-en-v1.5  → 1024-dim, slower,  English only, better quality
  BAAI/bge-m3             → 1024-dim, slowest, multilingual (Hinglish-safe)

BGE instruction prefix:
  BGE models are trained with a query-side instruction prefix:
    "Represent this sentence for searching relevant passages: "
  This MUST be prepended to query text at retrieval time.
  Passage/chunk text (at index time) does NOT get this prefix.
  This is the BGE paper's asymmetric encoding protocol.

Model is loaded once and cached as a class-level singleton.
Loading a 400MB+ model per request would be unusably slow.
"""

from __future__ import annotations

import gc
import threading
from typing import ClassVar

from sentence_transformers import SentenceTransformer

from app.core.config import get_settings
from app.core.exceptions import (
    EmbeddingDimensionMismatchError,
    EmbeddingError,
    QueryEmbeddingError,
)
from app.core.logger import get_logger
from app.pipeline.chunking.models import ChunkBatch
from app.pipeline.embedding.base import EmbeddingProvider
from app.pipeline.embedding.batch_manager import BatchManager
from app.pipeline.embedding.models import EmbeddingBatch, EmbeddingResult

logger = get_logger(__name__)
settings = get_settings()

# BGE query-side instruction prefix (passage side uses no prefix)
_BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


class BGEEmbedder(EmbeddingProvider):
    """
    Singleton BGE embedder.

    Thread-safe: model load is protected by a lock so concurrent
    startup requests don't race to load the same model twice.
    """

    _instance: ClassVar[BGEEmbedder | None] = None
    _lock: ClassVar[threading.Lock] = threading.Lock()
    _execution_lock: ClassVar[threading.Lock] = threading.Lock()
    _model: SentenceTransformer | None = None

    def __new__(cls) -> BGEEmbedder:
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def _load_model(self) -> SentenceTransformer:
        """Load the model if not already loaded. Called lazily on first use."""
        if self._model is not None:
            return self._model

        with self._lock:
            if self._model is not None:
                return self._model

            logger.info(
                "Loading BGE embedding model (this takes a few seconds on first load)",
                model=settings.BGE_MODEL_NAME,
                device=settings.BGE_DEVICE,
            )
            try:
                model = SentenceTransformer(
                    settings.BGE_MODEL_NAME,
                    device=settings.BGE_DEVICE,
                )
                # Validate dimension matches Pinecone config
                test_vec = model.encode(["test"], normalize_embeddings=True)
                actual_dim = test_vec.shape[1]
                if actual_dim != settings.PINECONE_DIMENSION:
                    raise EmbeddingDimensionMismatchError(
                        message=(
                            f"Model {settings.BGE_MODEL_NAME!r} produces {actual_dim}-dim vectors "
                            f"but PINECONE_DIMENSION={settings.PINECONE_DIMENSION}. "
                            f"Update PINECONE_DIMENSION in your .env to match."
                        )
                    )
                self._model = model
                logger.info(
                    "BGE model loaded",
                    model=settings.BGE_MODEL_NAME,
                    dimension=actual_dim,
                    device=settings.BGE_DEVICE,
                )
            except EmbeddingDimensionMismatchError:
                raise
            except Exception as exc:
                raise EmbeddingError(
                    message=f"Failed to load BGE model {settings.BGE_MODEL_NAME!r}.",
                    detail=str(exc),
                ) from exc

        return self._model

    def embed_chunks(self, batch: ChunkBatch) -> EmbeddingBatch:
        """
        Embeds all chunks using text_for_embedding (context-enriched text).
        Internally uses BatchManager to split into sub-batches and handle retries.
        """
        model = self._load_model()
        with self._execution_lock:
            manager = BatchManager(
                model=model,
                batch_size=settings.BGE_BATCH_SIZE,
            )
            results: list[EmbeddingResult] = manager.embed(batch)
            
            # Explicitly force garbage collection to immediately free chunks 
            # and tensor allocations within the worker thread
            del manager
            gc.collect()

        logger.info(
            "Chunks embedded",
            video_id=batch.video_id,
            total_chunks=len(results),
            model=settings.BGE_MODEL_NAME,
        )

        return EmbeddingBatch(
            video_id=batch.video_id,
            results=results,
            model_name=settings.BGE_MODEL_NAME,
            total_embedded=len(results),
        )

    def embed_query(self, text: str) -> list[float]:
        """
        Embeds a single query string with the BGE query instruction prefix.
        The prefix is REQUIRED for bge-base and bge-large models.
        bge-m3 handles it internally but still works fine with the prefix.
        """
        model = self._load_model()
        try:
            prefixed = _BGE_QUERY_PREFIX + text.strip()
            with self._execution_lock:
                vector = model.encode(
                    [prefixed],
                    normalize_embeddings=settings.BGE_NORMALIZE_EMBEDDINGS,
                    batch_size=1,
                )
            return vector[0].tolist()
        except Exception as exc:
            raise QueryEmbeddingError(
                message="Failed to embed query text.",
                detail=str(exc),
            ) from exc

    @property
    def dimension(self) -> int:
        return settings.PINECONE_DIMENSION

    @property
    def model_name(self) -> str:
        return settings.BGE_MODEL_NAME
