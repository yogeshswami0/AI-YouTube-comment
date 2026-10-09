"""
app/services/query_service.py

Business logic layer for the retrieval pipeline.

Called by:
  - app/api/routes/query.py (both /query and /query/batch)

Composes Searcher + Reranker into one clean call.
The route layer only deals with HTTP request/response shapes;
all retrieval decisions live here.
"""

import asyncio

from app.core.config import get_settings
from app.core.logger import get_logger
from app.retrieval.reranker import Reranker
from app.retrieval.searcher import Searcher

logger = get_logger(__name__)
settings = get_settings()


class QueryService:
    """
    Orchestrates the retrieval pipeline:
      embed query → Pinecone search → score filter → optional rerank
    """

    def __init__(self) -> None:
        self._searcher = Searcher()
        self._reranker = Reranker()

    async def search(
        self,
        question: str,
        video_id: str | None = None,
        top_k: int | None = None,
        score_threshold: float | None = None,
    ) -> list[dict]:
        """
        Full retrieval pipeline for one question.

        Args:
            question:        Natural language question from the user.
            video_id:        Restrict search to one video. None = global.
            top_k:           Number of results to return (default from config).
            score_threshold: Minimum cosine similarity (default from config).

        Returns:
            List of chunk dicts, sorted by relevance (highest first).
            Empty list if no results pass the threshold.
            Each dict shape:
            {
                "chunk_id":    str,
                "score":       float,   ← cosine similarity (or rerank score if reranking on)
                "text":        str,     ← raw transcript text for this time window
                "metadata": {
                    "video_id":             str,
                    "video_title":          str | None,
                    "channel_name":         str | None,
                    "chunk_index":          int,
                    "start_time_seconds":   float,
                    "end_time_seconds":     float,
                    "chunk_window_seconds": int,
                }
            }
        """
        _top_k = top_k or settings.RETRIEVAL_TOP_K
        _threshold = score_threshold if score_threshold is not None else settings.RETRIEVAL_SCORE_THRESHOLD

        logger.info(
            "Query service: search started",
            question_preview=question[:80],
            video_id=video_id,
            top_k=_top_k,
            score_threshold=_threshold,
            reranker_enabled=settings.RERANKER_ENABLED,
        )

        # Step 1: Embed + Pinecone search + threshold filter
        matches = await self._searcher.search(
            question=question,
            video_id=video_id,
            top_k=_top_k,
            score_threshold=_threshold,
        )

        if not matches:
            logger.info("Query service: no results above threshold", question_preview=question[:80])
            return []

        # Step 2: Optional reranking
        if settings.RERANKER_ENABLED:
            loop = asyncio.get_event_loop()
            matches = await loop.run_in_executor(
                None, 
                lambda p=(question, matches): self._reranker.rerank(*p)
            )
            # After rerank, trim again to requested top_k
            matches = matches[:_top_k]

        logger.info(
            "Query service: search complete",
            result_count=len(matches),
            top_score=matches[0]["score"] if matches else None,
        )

        return matches