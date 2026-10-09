"""
app/api/routes/ingest.py

POST /api/v1/ingest        — trigger full RAG ingest pipeline for one video
POST /api/v1/ingest/batch  — trigger ingest for multiple videos at once
GET  /api/v1/ingest/status/{video_id} — check index status of a video

Time-based chunking:
    The ingest request accepts `chunk_window_seconds` (default: 60).
    The pipeline will group transcript segments that fall within each
    N-second window into a single chunk, preserving their natural
    time boundaries. Each chunk carries start_time and end_time metadata
    so retrieved results can be deep-linked to the exact video timestamp.

Transcript format expected in Redis (JSON string):
    [
        {"text": "Hello and welcome", "start": 0.0,  "duration": 2.5},
        {"text": "to this video",     "start": 2.5,  "duration": 1.8},
        ...
    ]
    Key: transcript:{video_id}
"""

from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Request
from pydantic import BaseModel, Field, field_validator

from app.core.config import get_settings
from app.core.exceptions import InvalidRequestError
from app.core.logger import get_logger

logger = get_logger(__name__)
settings = get_settings()
router = APIRouter()


# ── Request models ────────────────────────────────────────────────────────────

class IngestRequest(BaseModel):
    video_id: Annotated[str, Field(
        description="YouTube video ID (the part after ?v= in the URL).",
        min_length=5,
        max_length=20,
        examples=["dQw4w9WgXcQ"],
    )]
    video_title: Annotated[str | None, Field(
        default=None,
        description="Human-readable title stored as chunk metadata. Optional but recommended.",
        max_length=300,
    )]
    channel_name: Annotated[str | None, Field(
        default=None,
        description="Channel name stored as chunk metadata.",
        max_length=200,
    )]
    chunk_window_seconds: Annotated[int, Field(
        default=60,
        ge=10,      # minimum 10-second windows — anything smaller loses context
        le=300,     # maximum 5-minute windows — anything larger defeats RAG granularity
        description=(
            "Time window in seconds for grouping transcript segments into chunks. "
            "Each chunk contains all transcript text whose `start` time falls within "
            "a [N * window, (N+1) * window) interval. "
            "Recommended: 30s for short dense videos, 60s for lectures/podcasts."
        ),
    )]
    force_reindex: Annotated[bool, Field(
        default=False,
        description=(
            "If True, bypasses the already-indexed guard and re-runs the full pipeline. "
            "Use when the transcript in Redis has been updated."
        ),
    )]

    @field_validator("video_id")
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        return v.strip()


class BatchIngestRequest(BaseModel):
    videos: Annotated[list[IngestRequest], Field(
        min_length=1,
        max_length=20,  # cap batch size to avoid overwhelming the queue
        description="List of videos to ingest. Max 20 per request.",
    )]


# ── Response models ───────────────────────────────────────────────────────────

class IngestAcceptedResponse(BaseModel):
    success: Literal[True] = True
    status: Literal["accepted", "skipped"]
    video_id: str
    message: str
    request_id: str


class IngestStatusResponse(BaseModel):
    success: Literal[True] = True
    video_id: str
    indexed: bool
    chunk_count: int | None = None   # present only if indexed
    chunk_window_seconds: int | None = None


class BatchIngestAcceptedResponse(BaseModel):
    success: Literal[True] = True
    accepted: list[str]  # video_ids accepted for processing
    skipped: list[str]   # video_ids already indexed (and force_reindex=False)
    request_id: str


# ── Background task ───────────────────────────────────────────────────────────

async def _run_ingest_pipeline(
    video_id: str,
    video_title: str | None,
    channel_name: str | None,
    chunk_window_seconds: int,
    force_reindex: bool,
    request_id: str,
) -> None:
    """
    Runs inside FastAPI's BackgroundTasks after the HTTP response is returned.
    This keeps the POST /ingest endpoint fast (immediate 202 Accepted) while
    the actual pipeline work (chunking, embedding, upsert) runs asynchronously.

    In production, heavy ingest jobs should go through the Redis queue +
    worker process instead. This background task path is suitable for
    low-to-medium volume or dev environments.
    """
    from app.services.ingest_service import IngestService

    logger.info(
        "Background ingest started",
        video_id=video_id,
        chunk_window_seconds=chunk_window_seconds,
        request_id=request_id,
    )

    try:
        service = IngestService()
        result = await service.ingest(
            video_id=video_id,
            video_title=video_title,
            channel_name=channel_name,
            chunk_window_seconds=chunk_window_seconds,
            force_reindex=force_reindex,
        )
        logger.info(
            "Background ingest completed",
            video_id=video_id,
            chunks_indexed=result.get("chunks_indexed"),
            request_id=request_id,
        )
    except Exception as exc:
        # Background tasks cannot propagate exceptions to the client
        # (response is already sent). Log the full error instead.
        logger.error(
            "Background ingest failed",
            video_id=video_id,
            error=str(exc),
            request_id=request_id,
        )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post(
    "/ingest",
    response_model=IngestAcceptedResponse,
    status_code=202,
    summary="Trigger RAG ingest for a single YouTube video",
    description=(
        "Pulls the transcript from Redis, chunks it by time window, generates "
        "BGE embeddings, and upserts vectors into Pinecone. "
        "Returns 202 Accepted immediately — processing happens in the background."
    ),
)
async def ingest_video(
    body: IngestRequest,
    background_tasks: BackgroundTasks,
    request: Request,
) -> IngestAcceptedResponse:
    request_id: str = getattr(request.state, "request_id", "unknown")

    # Fast pre-check: if already indexed and not forcing, skip immediately
    # without even starting a background task
    if not body.force_reindex:
        import redis.asyncio as aioredis
        client = aioredis.from_url(settings.redis_url)
        already_indexed = await client.exists(f"{settings.REDIS_INDEXED_PREFIX}{body.video_id}")
        await client.aclose()

        if already_indexed:
            logger.info(
                "Ingest skipped — already indexed",
                video_id=body.video_id,
                request_id=request_id,
            )
            return IngestAcceptedResponse(
                status="skipped",
                video_id=body.video_id,
                message=f"Video {body.video_id!r} is already indexed. Pass force_reindex=true to re-run.",
                request_id=request_id,
            )

    import json
    import redis.asyncio as aioredis
    client = aioredis.from_url(settings.redis_url)
    
    payload = {
        "video_id": body.video_id,
        "video_title": body.video_title,
        "channel_name": body.channel_name,
        "chunk_window_seconds": body.chunk_window_seconds,
        "force_reindex": body.force_reindex,
        "request_id": request_id,
    }
    
    await client.lpush(settings.REDIS_INGEST_QUEUE_KEY, json.dumps(payload))
    await client.aclose()

    logger.info(
        "Ingest accepted",
        video_id=body.video_id,
        chunk_window_seconds=body.chunk_window_seconds,
        force_reindex=body.force_reindex,
        request_id=request_id,
    )

    return IngestAcceptedResponse(
        status="accepted",
        video_id=body.video_id,
        message=(
            f"Ingest pipeline started for {body.video_id!r} "
            f"with {body.chunk_window_seconds}s time windows."
        ),
        request_id=request_id,
    )


@router.post(
    "/ingest/batch",
    response_model=BatchIngestAcceptedResponse,
    status_code=202,
    summary="Trigger RAG ingest for multiple videos",
    description="Accepts up to 20 videos. Each is queued independently.",
)
async def ingest_batch(
    body: BatchIngestRequest,
    background_tasks: BackgroundTasks,
    request: Request,
) -> BatchIngestAcceptedResponse:
    request_id: str = getattr(request.state, "request_id", "unknown")

    # Deduplicate video_ids in the request
    seen: set[str] = set()
    unique_videos = []
    for v in body.videos:
        if v.video_id not in seen:
            seen.add(v.video_id)
            unique_videos.append(v)

    if not unique_videos:
        raise InvalidRequestError(message="All provided video_ids were duplicates.")

    # Bulk check which are already indexed
    import json
    import redis.asyncio as aioredis
    client = aioredis.from_url(settings.redis_url)
    pipe = client.pipeline()
    for v in unique_videos:
        pipe.exists(f"{settings.REDIS_INDEXED_PREFIX}{v.video_id}")
    indexed_flags: list[int] = await pipe.execute()
    await client.aclose()

    accepted: list[str] = []
    skipped: list[str] = []

    for video, is_indexed in zip(unique_videos, indexed_flags):
        if is_indexed and not video.force_reindex:
            skipped.append(video.video_id)
            continue

        payload = {
            "video_id": video.video_id,
            "video_title": video.video_title,
            "channel_name": video.channel_name,
            "chunk_window_seconds": video.chunk_window_seconds,
            "force_reindex": video.force_reindex,
            "request_id": request_id,
        }
        await client.lpush(settings.REDIS_INGEST_QUEUE_KEY, json.dumps(payload))
        accepted.append(video.video_id)

    logger.info(
        "Batch ingest accepted",
        accepted_count=len(accepted),
        skipped_count=len(skipped),
        request_id=request_id,
    )

    return BatchIngestAcceptedResponse(
        accepted=accepted,
        skipped=skipped,
        request_id=request_id,
    )


@router.get(
    "/ingest/status/{video_id}",
    response_model=IngestStatusResponse,
    summary="Check index status of a video",
    description=(
        "Returns whether a video has been indexed. "
        "Poll this after POST /ingest to know when processing is complete."
    ),
)
async def ingest_status(video_id: str, request: Request) -> IngestStatusResponse:
    import redis.asyncio as aioredis

    client = aioredis.from_url(settings.redis_url)

    # Check the indexed flag
    indexed_flag = await client.get(f"{settings.REDIS_INDEXED_PREFIX}{video_id}")

    # Also read chunk_count and window if stored
    # Convention: indexed:{video_id} stores JSON metadata, not just "1"
    # e.g. {"chunk_count": 42, "chunk_window_seconds": 60}
    chunk_count: int | None = None
    chunk_window_seconds: int | None = None

    if indexed_flag:
        import json
        try:
            meta = json.loads(indexed_flag)
            chunk_count = meta.get("chunk_count")
            chunk_window_seconds = meta.get("chunk_window_seconds")
        except (json.JSONDecodeError, TypeError):
            pass  # indexed_flag is plain "1" from older ingests — that's fine

    await client.aclose()

    return IngestStatusResponse(
        video_id=video_id,
        indexed=bool(indexed_flag),
        chunk_count=chunk_count,
        chunk_window_seconds=chunk_window_seconds,
    )