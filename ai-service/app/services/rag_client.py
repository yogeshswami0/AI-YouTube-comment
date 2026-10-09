"""
app/services/rag_client.py

Async HTTP client for calling the RAG service to retrieve video context chunks.
Used by the generate service when a comment needs video-context-enriched replies.
"""

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
logger = get_logger(__name__)

# Reusable async client with connection pooling
_http_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(
            base_url=settings.RAG_SERVICE_URL,
            timeout=httpx.Timeout(30.0, connect=5.0),
        )
    return _http_client


async def fetch_video_context(
    question: str,
    video_id: str | None = None,
    top_k: int = 4,
    score_threshold: float = 0.55,
) -> str | None:
    """
    Query the RAG service for relevant transcript chunks.

    Args:
        question: The comment text (used as the semantic query).
        video_id: Scope retrieval to a specific video. None = global search.
        top_k: Number of chunks to retrieve.
        score_threshold: Minimum cosine similarity to include a chunk.

    Returns:
        Concatenated chunk texts as a single string, or None on failure / no results.
    """
    payload = {
        "question": question,
        "top_k": top_k,
        "score_threshold": score_threshold,
    }
    if video_id:
        payload["video_id"] = video_id

    try:
        client = _get_client()
        response = await client.post("/api/v1/query", json=payload)
        response.raise_for_status()
        data = response.json()

        results = data.get("results", [])
        if not results:
            logger.info(
                "RAG returned no results",
                video_id=video_id,
                question_length=len(question),
            )
            return None

        # Concatenate chunk texts with separator
        chunks_text = "\n---\n".join(
            chunk["text"] for chunk in results if chunk.get("text")
        )

        logger.info(
            "RAG context retrieved",
            video_id=video_id,
            chunk_count=len(results),
            top_score=results[0].get("score") if results else None,
        )
        return chunks_text

    except httpx.HTTPStatusError as e:
        logger.warning(
            "RAG service returned error",
            status_code=e.response.status_code,
            detail=e.response.text[:200],
        )
        return None
    except Exception as e:
        # Fail open: if RAG is down, generation proceeds without context
        logger.warning("RAG service call failed, proceeding without context", error=str(e))
        return None
