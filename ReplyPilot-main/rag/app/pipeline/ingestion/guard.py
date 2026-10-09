"""
app/pipeline/ingestion/guard.py

Checks whether a video has already been indexed before running
the expensive chunking + embedding + upsert pipeline.

The indexed flag is stored in Redis as:
    Key   : indexed:{video_id}
    Value : JSON string — {"chunk_count": 42, "chunk_window_seconds": 60, "indexed_at": "..."}

Using JSON instead of plain "1" lets the /ingest/status endpoint
return useful metadata without hitting Pinecone.
"""

import json
from datetime import datetime, timezone

import redis.asyncio as aioredis

from app.core.config import get_settings
from app.core.exceptions import RedisConnectionError, TranscriptAlreadyIndexedError
from app.core.logger import get_logger

logger = get_logger(__name__)
settings = get_settings()


class IndexGuard:
    """
    Reads and writes the indexed:{video_id} flag in Redis.

    Used in two places:
      1. orchestrator.py — check before starting pipeline (raises if already indexed)
      2. orchestrator.py — mark as indexed after pipeline completes successfully
    """

    def __init__(self) -> None:
        self._url = settings.redis_url
        self._prefix = settings.REDIS_INDEXED_PREFIX

    def _key(self, video_id: str) -> str:
        return f"{self._prefix}{video_id}"

    async def is_indexed(self, video_id: str) -> bool:
        """Returns True if video_id has already been indexed."""
        try:
            client = aioredis.from_url(self._url, decode_responses=True)
            exists = await client.exists(self._key(video_id))
            await client.aclose()
            return bool(exists)
        except Exception as exc:
            raise RedisConnectionError(
                message=f"Redis error while checking index guard for {video_id!r}.",
                detail=str(exc),
            ) from exc

    async def assert_not_indexed(self, video_id: str) -> None:
        """
        Raises TranscriptAlreadyIndexedError if video_id is already indexed.
        The orchestrator catches this and treats it as a silent no-op.
        """
        if await self.is_indexed(video_id):
            raise TranscriptAlreadyIndexedError(
                message=f"Video {video_id!r} is already indexed. Pass force_reindex=True to re-run.",
            )

    async def mark_indexed(
        self,
        video_id: str,
        chunk_count: int,
        chunk_window_seconds: int,
    ) -> None:
        """
        Writes the indexed flag with metadata after a successful pipeline run.
        No TTL is set — the flag persists until manually deleted or the
        video is explicitly re-indexed.
        """
        payload = json.dumps({
            "chunk_count": chunk_count,
            "chunk_window_seconds": chunk_window_seconds,
            "indexed_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            client = aioredis.from_url(self._url, decode_responses=True)
            await client.set(self._key(video_id), payload)
            await client.aclose()
        except Exception as exc:
            raise RedisConnectionError(
                message=f"Redis error while marking {video_id!r} as indexed.",
                detail=str(exc),
            ) from exc

        logger.info("Video marked as indexed", video_id=video_id, chunk_count=chunk_count)

    async def clear_indexed(self, video_id: str) -> None:
        """
        Removes the indexed flag so the video can be re-ingested.
        Called by the orchestrator when force_reindex=True.
        """
        try:
            client = aioredis.from_url(self._url, decode_responses=True)
            await client.delete(self._key(video_id))
            await client.aclose()
        except Exception as exc:
            raise RedisConnectionError(
                message=f"Redis error while clearing index flag for {video_id!r}.",
                detail=str(exc),
            ) from exc

        logger.info("Index flag cleared for re-indexing", video_id=video_id)