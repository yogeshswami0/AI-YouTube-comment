
from fastapi import APIRouter, HTTPException, status
from app.schemas.comment import CommentIn, CommentOut, BatchCommentIn, BatchCommentOut
from app.services.classify_service import classify_comment
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()


@router.post(
    "/classify",
    response_model=CommentOut,
    status_code=status.HTTP_200_OK,
    summary="Classify a comment's intent and spam score",
)
async def classify(input: CommentIn) -> CommentOut:
    try:
        result = await classify_comment(input)
        return result

    except RuntimeError as e:
        # Model not loaded
        logger.error(f"[classify] Model not ready: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Classifier model is not loaded. Check startup logs.",
        )
    except Exception as e:
        logger.error(f"[classify] Unexpected error for comment {input.comment_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Classification failed. Please retry.",
        )

@router.post(
    "/classify_batch",
    response_model=BatchCommentOut,
    status_code=status.HTTP_200_OK,
    summary="Classify batch comment's intent and spam score",
)
async def classify_batch(input: BatchCommentIn):
    try:
        results = []
        for item in input.items:
            result = await classify_comment(item)
            results.append(result)

        spam_count = sum(1 for r in results if r["is_spam"])
        return {
            "results": results,
            "total": len(results),
            "spam": spam_count,
            "valid": len(results) - spam_count
        }

    except RuntimeError as e:
        logger.error(f"[classify_batch] Model not ready: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Classifier model is not loaded. Check startup logs.",
        )
    except Exception as e:
        logger.error(f"[classify_batch] Unexpected error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Classification failed. Please retry.",
        )
