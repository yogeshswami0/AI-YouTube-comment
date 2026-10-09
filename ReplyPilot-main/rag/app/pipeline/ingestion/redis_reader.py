"""
app/pipeline/ingestion/redis_reader.py

Reads the raw YouTube transcript from Redis for a given videoId.

Expected Redis key   : transcript:{video_id}
Expected value format: JSON string — list of segment dicts:
    [
        {"text": "Hello and welcome", "start": 0.0,  "duration": 2.5},
        {"text": "to this channel",   "start": 2.5,  "duration": 1.8},
        ...
    ]

This is the exact format produced by the `youtube-transcript-api` Python
library, so your Node.js backend just serialises that and stores it as-is.
"""

import json
from dataclasses import dataclass

import redis.asyncio as aioredis

from app.core.config import get_settings
from app.core.exceptions import RedisConnectionError, TranscriptNotFoundError
from app.core.logger import get_logger

logger = get_logger(__name__)
settings = get_settings()


@dataclass
class TranscriptSegment:
    """One caption segment from the YouTube transcript."""
    text: str
    start: float     # seconds from video start
    duration: float  # how long this caption is displayed


@dataclass
class RawTranscript:
    """Full transcript pulled from Redis, ready for the chunker."""
    video_id: str
    segments: list[TranscriptSegment]
    total_duration_seconds: float  # end of last segment


class RedisTranscriptReader:
    """
    Async Redis client that fetches and deserialises a transcript.
    Creates its own connection per call — does not hold a long-lived
    connection so the ingestion worker stays stateless between videos.
    """

    def __init__(self) -> None:
        self._url = settings.redis_url
        self._prefix = settings.REDIS_TRANSCRIPT_PREFIX

    async def read(self, video_id: str) -> RawTranscript:
        """
        Fetch and parse the transcript for video_id from Redis.

        Args:
            video_id: YouTube video ID (e.g. "dQw4w9WgXcQ")

        Returns:
            RawTranscript with parsed segments sorted by start time.

        Raises:
            TranscriptNotFoundError: key does not exist or value is empty.
            RedisConnectionError:    cannot reach Redis.
        """
        key = f"{self._prefix}{video_id}"

        try:
            client = aioredis.from_url(
                self._url,
                socket_connect_timeout=settings.REDIS_SOCKET_CONNECT_TIMEOUT,
                socket_timeout=settings.REDIS_SOCKET_TIMEOUT,
                decode_responses=True,
            )
            raw_value: str | None = await client.get(key)
            await client.aclose()
        except Exception as exc:
            raise RedisConnectionError(
                message=f"Failed to connect to Redis while reading transcript for {video_id!r}.",
                detail=str(exc),
            ) from exc

        if not raw_value:
            raise TranscriptNotFoundError(
                message=f"No transcript found in Redis for video_id={video_id!r}.",
                detail=f"Expected key: {key}",
            )

        try:
            raw_segments: list[dict] = json.loads(raw_value)
        except json.JSONDecodeError as exc:
            raise TranscriptNotFoundError(
                message=f"Transcript for {video_id!r} is not valid JSON.",
                detail=str(exc),
            ) from exc

        if not isinstance(raw_segments, list) or len(raw_segments) == 0:
            raise TranscriptNotFoundError(
                message=f"Transcript for {video_id!r} is empty or malformed.",
                detail=f"Got type={type(raw_segments).__name__}, length={len(raw_segments) if isinstance(raw_segments, list) else 'N/A'}",
            )

        segments = [
            TranscriptSegment(
                text=str(seg.get("text", "")).strip(),
                start=float(seg.get("start", 0.0)),
                duration=float(seg.get("duration", 0.0)),
            )
            for seg in raw_segments
            if seg.get("text", "").strip()   # skip blank captions
        ]

        # Always sort by start time — Redis storage order is not guaranteed
        segments.sort(key=lambda s: s.start)

        last = segments[-1]
        total_duration = last.start + last.duration

        logger.info(
            "Transcript read from Redis",
            video_id=video_id,
            segment_count=len(segments),
            total_duration_seconds=round(total_duration, 1),
        )

        return RawTranscript(
            video_id=video_id,
            segments=segments,
            total_duration_seconds=total_duration,
        )