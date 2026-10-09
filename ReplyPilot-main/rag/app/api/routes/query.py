"""
app/api/routes/query.py

POST /api/v1/query — embed a question, search Pinecone, return top chunks

Each returned chunk includes:
  - The raw transcript text for that time window
  - start_time / end_time in seconds (deep-link to exact video moment)
  - video_id, video_title, channel_name
  - similarity score from Pinecone
  - chunk_index (position in the video's chunk sequence)

The caller (your Node.js backend or frontend) is responsible for passing
the chunks to an LLM. This service only handles retrieval — it deliberately
does NOT call an LLM so the pipeline stays modular and testable.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, field_validator

from app.core.config import get_settings
from app.core.exceptions import InvalidRequestError
from app.core.logger import get_logger

logger = get_logger(__name__)
settings = get_settings()
router = APIRouter()


# ── Request models ────────────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    question: Annotated[str, Field(
        description="The natural language question to search for in indexed transcripts.",
        min_length=3,
        max_length=1000,
        examples=["What did the speaker say about transformer attention?"],
    )]
    video_id: Annotated[str | None, Field(
        default=None,
        description=(
            "If provided, restricts the search to chunks from this video only. "
            "If None, searches across all indexed videos (global search)."
        ),
        min_length=5,
        max_length=20,
    )]
    top_k: Annotated[int, Field(
        default=4,
        ge=1,
        le=10,
        description="Number of top chunks to return. Default 4. Max 10.",
    )]
    score_threshold: Annotated[float, Field(
        default=settings.RETRIEVAL_SCORE_THRESHOLD,
        ge=0.0,
        le=1.0,
        description=(
            "Minimum cosine similarity score to include a chunk in results. "
            "Chunks below this threshold are discarded even if they are top-K. "
            "Lower = more permissive, higher = stricter. Recommended: 0.55–0.75."
        ),
    )]
    include_metadata: Annotated[bool, Field(
        default=True,
        description="If False, strips all metadata from results. Useful for lightweight responses.",
    )]

    @field_validator("question")
    @classmethod
    def strip_and_validate_question(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("question cannot be blank.")
        return v


# ── Response models ───────────────────────────────────────────────────────────

class ChunkMetadata(BaseModel):
    video_id: str
    video_title: str | None
    channel_name: str | None
    chunk_index: int              # position of this chunk in the video's sequence
    start_time_seconds: float     # video timestamp where this chunk begins
    end_time_seconds: float       # video timestamp where this chunk ends
    chunk_window_seconds: int     # the time window used when this video was indexed


class RetrievedChunk(BaseModel):
    chunk_id: str                 # e.g. "dQw4w9WgXcQ_chunk_003"
    text: str                     # raw transcript text for this time window
    score: float                  # cosine similarity score (0.0 – 1.0)
    metadata: ChunkMetadata | None = None


class QueryResponse(BaseModel):
    success: Literal[True] = True
    question: str
    results: list[RetrievedChunk]
    total_results: int
    search_scope: Literal["video", "global"]
    request_id: str


class NoResultsResponse(BaseModel):
    success: Literal[True] = True
    question: str
    results: list = []
    total_results: int = 0
    message: str
    search_scope: Literal["video", "global"]
    request_id: str


# ── Route ─────────────────────────────────────────────────────────────────────

@router.post(
    "/query",
    response_model=QueryResponse | NoResultsResponse,
    summary="Semantic search over indexed YouTube transcripts",
    description=(
        "Embeds the question using the same BGE model used at index time, "
        "queries Pinecone for the most semantically similar transcript chunks, "
        "filters by score threshold, and returns the raw chunks. "
        "Optionally scoped to a single video."
    ),
)
async def query_transcripts(
    body: QueryRequest,
    request: Request,
) -> QueryResponse | NoResultsResponse:
    request_id: str = getattr(request.state, "request_id", "unknown")
    search_scope: Literal["video", "global"] = "video" if body.video_id else "global"

    logger.info(
        "Query received",
        question_length=len(body.question),
        video_id=body.video_id,
        top_k=body.top_k,
        score_threshold=body.score_threshold,
        search_scope=search_scope,
        request_id=request_id,
    )

    from app.services.query_service import QueryService

    service = QueryService()

    raw_results = await service.search(
        question=body.question,
        video_id=body.video_id,
        top_k=body.top_k,
        score_threshold=body.score_threshold,
    )

    # No results above threshold
    if not raw_results:
        logger.info(
            "Query returned no results above threshold",
            score_threshold=body.score_threshold,
            search_scope=search_scope,
            request_id=request_id,
        )
        return NoResultsResponse(
            question=body.question,
            message=(
                f"No transcript chunks found with similarity above {body.score_threshold}. "
                "Try lowering score_threshold or rephrasing your question."
            ),
            search_scope=search_scope,
            request_id=request_id,
        )

    # Build response chunks
    chunks: list[RetrievedChunk] = []
    for hit in raw_results:
        metadata: ChunkMetadata | None = None
        if body.include_metadata:
            meta = hit.get("metadata", {})
            metadata = ChunkMetadata(
                video_id=meta.get("video_id", ""),
                video_title=meta.get("video_title"),
                channel_name=meta.get("channel_name"),
                chunk_index=meta.get("chunk_index", 0),
                start_time_seconds=meta.get("start_time_seconds", 0.0),
                end_time_seconds=meta.get("end_time_seconds", 0.0),
                chunk_window_seconds=meta.get("chunk_window_seconds", 60),
            )

        chunks.append(RetrievedChunk(
            chunk_id=hit["chunk_id"],
            text=hit["text"],
            score=round(hit["score"], 4),
            metadata=metadata,
        ))

    logger.info(
        "Query completed",
        result_count=len(chunks),
        top_score=chunks[0].score if chunks else None,
        search_scope=search_scope,
        request_id=request_id,
    )

    return QueryResponse(
        question=body.question,
        results=chunks,
        total_results=len(chunks),
        search_scope=search_scope,
        request_id=request_id,
    )


@router.post(
    "/query/batch",
    response_model=list[QueryResponse | NoResultsResponse],
    summary="Batch semantic search — multiple questions in one request",
    description="Run up to 5 independent queries in a single request. Each is processed in parallel.",
)
async def query_batch(
    questions: Annotated[list[QueryRequest], Field(min_length=1, max_length=5)],
    request: Request,
) -> list[QueryResponse | NoResultsResponse]:
    if len(questions) > 5:
        raise InvalidRequestError(message="Batch query accepts at most 5 questions per request.")

    import asyncio
    from app.services.query_service import QueryService

    request_id: str = getattr(request.state, "request_id", "unknown")
    service = QueryService()

    async def _single(body: QueryRequest) -> QueryResponse | NoResultsResponse:
        # Reuse the single-query logic without going through HTTP again
        raw_results = await service.search(
            question=body.question,
            video_id=body.video_id,
            top_k=body.top_k,
            score_threshold=body.score_threshold,
        )
        search_scope: Literal["video", "global"] = "video" if body.video_id else "global"

        if not raw_results:
            return NoResultsResponse(
                question=body.question,
                message=f"No chunks found above threshold {body.score_threshold}.",
                search_scope=search_scope,
                request_id=request_id,
            )

        chunks = [
            RetrievedChunk(
                chunk_id=h["chunk_id"],
                text=h["text"],
                score=round(h["score"], 4),
                metadata=ChunkMetadata(**h["metadata"]) if body.include_metadata else None,
            )
            for h in raw_results
        ]
        return QueryResponse(
            question=body.question,
            results=chunks,
            total_results=len(chunks),
            search_scope=search_scope,
            request_id=request_id,
        )

    results = await asyncio.gather(*[_single(q) for q in questions])
    return list(results)