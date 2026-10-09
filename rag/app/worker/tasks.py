"""
app/worker/tasks.py

Task definitions executed by the BRPOP queue consumer.

Each task receives a parsed job payload dict from the queue and
runs the appropriate service. Tasks are responsible for:
  - Deserialising the job payload
  - Calling the service
  - Logging success / failure
  - Raising exceptions so the consumer can apply retry logic

Job payload format pushed by Node.js:
    JSON string:
    {
        "video_id":             "dQw4w9WgXcQ",
        "video_title":          "Never Gonna Give You Up",   ← optional
        "channel_name":         "Rick Astley",               ← optional
        "chunk_window_seconds": 60,                          ← optional, default 60
        "force_reindex":        false                        ← optional, default false
    }

    OR just a plain video_id string (for simple Node.js LPUSH without metadata):
    "dQw4w9WgXcQ"
"""

import asyncio
import json

from app.core.logger import get_logger
from app.services.ingest_service import IngestService

logger = get_logger(__name__)

# Module-level service instance — created once when the worker starts,
# shared across all tasks in the same process.
_ingest_service = IngestService()


def _parse_payload(raw: str) -> dict:
    """
    Parse the raw string value from the Redis queue into a job dict.

    Handles two formats:
      1. JSON object: {"video_id": "...", "chunk_window_seconds": 60, ...}
      2. Plain string: "dQw4w9WgXcQ"  (just the video_id, no metadata)
    """
    raw = raw.strip()

    # Try JSON first
    try:
        payload = json.loads(raw)
        if isinstance(payload, dict):
            return payload
        if isinstance(payload, str):
            # JSON-encoded plain string: "\"dQw4w9WgXcQ\""
            return {"video_id": payload}
    except json.JSONDecodeError:
        pass

    # Plain string fallback
    return {"video_id": raw}


async def run_ingest_task(raw_payload: str) -> dict:
    """
    Main task: parse payload and run the full ingest pipeline.

    Args:
        raw_payload: Raw string value popped from rag:ingest:queue.

    Returns:
        Ingest summary dict from IngestService.

    Raises:
        ValueError:  video_id is missing or blank in the payload.
        Any exception from IngestService propagates up to the consumer
        so it can apply retry logic.
    """
    payload = _parse_payload(raw_payload)

    video_id: str = payload.get("video_id", "").strip()
    if not video_id:
        raise ValueError(
            f"Job payload is missing a valid video_id. Raw payload: {raw_payload!r}"
        )

    video_title: str | None = payload.get("video_title")
    channel_name: str | None = payload.get("channel_name")
    chunk_window_seconds: int = int(payload.get("chunk_window_seconds", 60))
    force_reindex: bool = bool(payload.get("force_reindex", False))

    logger.info(
        "Task: ingest started",
        video_id=video_id,
        video_title=video_title,
        chunk_window_seconds=chunk_window_seconds,
        force_reindex=force_reindex,
    )

    result = await _ingest_service.ingest(
        video_id=video_id,
        video_title=video_title,
        channel_name=channel_name,
        chunk_window_seconds=chunk_window_seconds,
        force_reindex=force_reindex,
    )

    if result.get("skipped"):
        logger.info("Task: video already indexed, skipped", video_id=video_id)
    else:
        logger.info(
            "Task: ingest completed",
            video_id=video_id,
            chunks_indexed=result.get("chunks_indexed"),
            total_duration_seconds=result.get("total_duration_seconds"),
        )

    return result