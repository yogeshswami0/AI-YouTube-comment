
from fastapi import APIRouter, HTTPException, status
from app.schemas.reply import ReplyRequest, ReplyResponse
from app.services.generate import generate_reply_service
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()


@router.post(
    "/generate",
    response_model=ReplyResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate a reply for a classified comment",
)
async def generate(request: ReplyRequest) -> ReplyResponse:
    try:
        result = await generate_reply_service(request)
        return result

    except RuntimeError as e:
        logger.error(f"[generate] Model not ready: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Generator model is not loaded. Check HF_TOKEN in .env",
        )
    except Exception as e:
        logger.error(f"[generate] Failed for comment {request.comment_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Reply generation failed. Please retry.",
        )


@router.post(
    "/generate_batch",
    response_model=list[ReplyResponse],
    status_code=status.HTTP_200_OK,
    summary="Generate replies for multiple classified comments",
)
async def generate_batch(requests: list[ReplyRequest]) -> list[ReplyResponse]:
    try:
        import asyncio
        results = await asyncio.gather(
            *[generate_reply_service(req) for req in requests]
        )
        return list(results)

    except RuntimeError as e:
        logger.error(f"[generate_batch] Model not ready: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Generator model is not loaded. Check HF_TOKEN in .env",
        )
    except Exception as e:
        logger.error(f"[generate_batch] Failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Reply generation failed. Please retry.",
        )
