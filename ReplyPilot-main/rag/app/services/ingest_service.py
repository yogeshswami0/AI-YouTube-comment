"""
app/services/ingest_service.py

Business logic layer for the ingest pipeline.

Called by:
  - app/api/routes/ingest.py  (via BackgroundTasks — HTTP-triggered ingest)
  - app/worker/tasks.py       (via BRPOP queue consumer — worker-triggered ingest)

This layer exists so both callers share identical logic without
duplicating code. Routes handle HTTP concerns; this handles pipeline concerns.
"""

from app.core.exceptions import TranscriptAlreadyIndexedError
from app.core.logger import get_logger
from app.pipeline.orchestrator import IngestOrchestrator

logger = get_logger(__name__)


class IngestService:
    """
    Thin orchestration wrapper used by both the API background task
    and the Redis queue worker.
    """

    def __init__(self) -> None:
        self._orchestrator = IngestOrchestrator()

    async def ingest(
        self,
        video_id: str,
        video_title: str | None = None,
        channel_name: str | None = None,
        chunk_window_seconds: int = 60,
        force_reindex: bool = False,
    ) -> dict:
        """
        Run the full ingest pipeline for one video.

        Returns:
            Summary dict:
            {
                "video_id":               str,
                "chunks_indexed":         int,
                "total_duration_seconds": float,
                "chunk_window_seconds":   int,
                "skipped":                bool,  ← True if already indexed and not forced
            }

        Raises:
            TranscriptNotFoundError — no transcript in Redis for this video_id.
            EmbeddingError          — BGE model failed.
            PineconeUpsertError     — Pinecone write failed.
            (All other pipeline exceptions propagate as-is to the caller.)
        """
        try:
            result = await self._orchestrator.run(
                video_id=video_id,
                video_title=video_title,
                channel_name=channel_name,
                chunk_window_seconds=chunk_window_seconds,
                force_reindex=force_reindex,
            )
            return {**result, "skipped": False}

        except TranscriptAlreadyIndexedError:
            logger.info(
                "Ingest skipped — video already indexed",
                video_id=video_id,
            )
            return {
                "video_id": video_id,
                "chunks_indexed": 0,
                "total_duration_seconds": 0.0,
                "chunk_window_seconds": chunk_window_seconds,
                "skipped": True,
            }