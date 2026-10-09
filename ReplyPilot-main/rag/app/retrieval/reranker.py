"""
app/retrieval/reranker.py

Optional cross-encoder reranker.

After Pinecone returns top-K results by approximate cosine similarity,
the reranker scores each (question, chunk_text) pair with a more
accurate cross-encoder model and reorders the results.

Why rerank?
  Bi-encoder retrieval (BGE) is fast but approximate — it encodes
  question and chunk independently. A cross-encoder sees both together
  and scores relevance more accurately, improving precision noticeably.

Enable by setting RERANKER_ENABLED=true in .env.
When disabled, this module is a transparent pass-through.

Model: cross-encoder/ms-marco-MiniLM-L-6-v2
  - Free on HuggingFace, ~80MB, runs on CPU comfortably.
  - Specifically trained for passage retrieval re-ranking.
"""

from __future__ import annotations

import threading
from typing import ClassVar

from app.core.config import get_settings
from app.core.exceptions import RerankerError
from app.core.logger import get_logger

logger = get_logger(__name__)
settings = get_settings()


class Reranker:
    """
    Singleton cross-encoder reranker.
    Model loads lazily on first use (only if RERANKER_ENABLED=true).
    """

    _instance: ClassVar[Reranker | None] = None
    _lock: ClassVar[threading.Lock] = threading.Lock()
    _model: object | None = None   # sentence_transformers.CrossEncoder

    def __new__(cls) -> Reranker:
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def _load_model(self) -> object:
        if self._model is not None:
            return self._model
        with self._lock:
            if self._model is not None:
                return self._model
            try:
                from sentence_transformers import CrossEncoder
                logger.info(
                    "Loading cross-encoder reranker model",
                    model=settings.RERANKER_MODEL_NAME,
                )
                self._model = CrossEncoder(
                    settings.RERANKER_MODEL_NAME,
                    max_length=512,
                )
                logger.info("Reranker model loaded", model=settings.RERANKER_MODEL_NAME)
            except Exception as exc:
                raise RerankerError(
                    message=f"Failed to load reranker model {settings.RERANKER_MODEL_NAME!r}.",
                    detail=str(exc),
                ) from exc
        return self._model

    def rerank(self, question: str, matches: list[dict]) -> list[dict]:
        """
        Reranks Pinecone search results using the cross-encoder.

        Args:
            question: Original user question.
            matches:  List of match dicts from Searcher.search().

        Returns:
            Same list, reordered by cross-encoder score (highest first).
            If RERANKER_ENABLED=false, returns matches unchanged.

        Raises:
            RerankerError: cross-encoder inference fails.
        """
        if not settings.RERANKER_ENABLED:
            return matches

        if not matches:
            return matches

        model = self._load_model()

        try:
            pairs = [(question, m["text"]) for m in matches]
            scores = model.predict(pairs)  # type: ignore[union-attr]

            # Attach cross-encoder score and sort
            for match, score in zip(matches, scores):
                match["rerank_score"] = float(score)

            reranked = sorted(matches, key=lambda m: m["rerank_score"], reverse=True)

            logger.info(
                "Results reranked",
                original_order=[m["chunk_id"] for m in matches],
                new_order=[m["chunk_id"] for m in reranked],
            )
            return reranked

        except Exception as exc:
            # Reranking is optional — log and fall back to original order
            logger.warning(
                "Reranking failed — returning original Pinecone order",
                error=str(exc),
            )
            return matches