"""
app/retrieval/searcher.py

Sends the query vector to Pinecone and applies the score threshold filter.

Flow:
  1. QueryEmbedder produces the vector
  2. Searcher sends it to Pinecone (with optional video_id filter)
  3. Pinecone returns top_k matches with cosine similarity scores
  4. Searcher discards any match below score_threshold
  5. Returns the filtered list to query_service.py
"""

import asyncio

from app.core.config import get_settings
from app.core.exceptions import NoRelevantChunksError, PineconeQueryError
from app.core.logger import get_logger
from app.pipeline.storage.pinecone_client import PineconeVectorStore
from app.retrieval.query_embedder import QueryEmbedder

logger = get_logger(__name__)
settings = get_settings()


class Searcher:
    """
    Orchestrates the query-side pipeline:
    embed → Pinecone query → threshold filter.
    """

    def __init__(self) -> None:
        self._embedder = QueryEmbedder()
        self._store = PineconeVectorStore()

    async def search(
        self,
        question: str,
        video_id: str | None = None,
        top_k: int | None = None,
        score_threshold: float | None = None,
    ) -> list[dict]:
        """
        Full retrieval pipeline for one query.

        Args:
            question:        User's question string.
            video_id:        Restrict search to this video. None = global.
            top_k:           Max results from Pinecone (default from config).
            score_threshold: Min score to include (default from config).

        Returns:
            List of chunk dicts above the threshold, sorted by score descending.
            Each dict: {"chunk_id", "score", "text", "metadata"}

        Raises:
            NoRelevantChunksError: Pinecone returned results but all below threshold.
            QueryEmbeddingError:   Question could not be embedded.
            PineconeQueryError:    Pinecone search failed.
        """
        _top_k = top_k or settings.RETRIEVAL_TOP_K
        _threshold = score_threshold if score_threshold is not None else settings.RETRIEVAL_SCORE_THRESHOLD

        # Step 1: Embed the question
        loop = asyncio.get_event_loop()
        vector = await loop.run_in_executor(None, self._embedder.embed, question)

        # Step 2: Query Pinecone
        # Fetch slightly more than top_k so threshold filtering
        # still returns top_k results even if some are discarded
        fetch_k = min(_top_k * 2, 20)
        raw_matches = await self._store.query(
            vector=vector,
            top_k=fetch_k,
            video_id=video_id,
        )

        logger.info(
            "Pinecone query returned",
            total_matches=len(raw_matches),
            video_id=video_id,
            top_k=fetch_k,
        )

        if not raw_matches:
            return []

        # Step 3: Apply score threshold
        filtered = [m for m in raw_matches if m["score"] >= _threshold]

        # Trim to requested top_k
        filtered = filtered[:_top_k]

        if not filtered:
            logger.info(
                "All Pinecone results below threshold",
                threshold=_threshold,
                best_score=raw_matches[0]["score"] if raw_matches else None,
                question_preview=question[:80],
            )
            # Return empty — let query_service decide whether to raise NoRelevantChunksError
            return []

        logger.info(
            "Search results filtered",
            returned=len(filtered),
            threshold=_threshold,
            top_score=filtered[0]["score"],
            bottom_score=filtered[-1]["score"],
        )

        return filtered