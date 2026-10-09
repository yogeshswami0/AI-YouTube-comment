"""
Global exception → structured JSON error response middleware.

Registered on the FastAPI app at startup. Every unhandled exception that
escapes a route handler is caught here and converted into a consistent
JSON envelope so the client never sees a raw Python traceback.

Response shape (all errors):
    {
        "success": false,
        "error": {
            "code":    "TRANSCRIPT_NOT_FOUND",   ← machine-readable
            "message": "No transcript found...", ← human-readable
            "detail":  "..."                     ← optional extra context
        },
        "request_id": "abc123"                   ← from X-Request-ID header if present
    }
"""

import uuid
import traceback
from typing import Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.exceptions import (
    YTRagBaseException,
    TranscriptNotFoundError,
    TranscriptAlreadyIndexedError,
    InvalidRequestError,
    NoRelevantChunksError,
    PineconeConnectionError,
    RedisConnectionError,
    EmbeddingError,
)
from app.core.logger import get_logger

logger = get_logger(__name__)


# ── HTTP status mapping ───────────────────────────────────────────────────────
# Maps our custom exception types to appropriate HTTP status codes.
# Anything not listed here defaults to 500.

_STATUS_MAP: dict[type[YTRagBaseException], int] = {
    InvalidRequestError:            400,
    TranscriptNotFoundError:        404,
    TranscriptAlreadyIndexedError:  409,
    NoRelevantChunksError:          422,
    RedisConnectionError:           503,
    PineconeConnectionError:        503,
    EmbeddingError:                 503,
}


def _get_status_code(exc: YTRagBaseException) -> int:
    return _STATUS_MAP.get(type(exc), 500)


def _build_error_response(
    code: str,
    message: str,
    detail: str | None,
    request_id: str,
    status_code: int,
) -> JSONResponse:
    body: dict = {
        "success": False,
        "error": {
            "code": code,
            "message": message,
        },
        "request_id": request_id,
    }
    if detail:
        body["error"]["detail"] = detail

    return JSONResponse(status_code=status_code, content=body)


# ── Middleware class ──────────────────────────────────────────────────────────

class ErrorHandlerMiddleware(BaseHTTPMiddleware):
    """
    Catches all exceptions that escape route handlers.

    Also injects an X-Request-ID header into every response (generated if
    not already present in the incoming request) so requests can be traced
    across logs end-to-end.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Generate or forward request ID
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())

        # Attach to request state so route handlers can log it
        request.state.request_id = request_id

        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = request_id
            return response

        except YTRagBaseException as exc:
            status_code = _get_status_code(exc)

            logger.warning(
                "Pipeline exception caught by error handler",
                request_id=request_id,
                exc_code=exc.code,
                exc_message=exc.message,
                status_code=status_code,
                path=request.url.path,
            )

            return _build_error_response(
                code=exc.code,
                message=exc.message,
                detail=exc.detail,
                request_id=request_id,
                status_code=status_code,
            )

        except Exception as exc:
            # Completely unexpected error — log full traceback, return 500
            logger.error(
                "Unhandled exception caught by error handler",
                request_id=request_id,
                exc_type=type(exc).__name__,
                exc_message=str(exc),
                traceback=traceback.format_exc(),
                path=request.url.path,
            )

            return _build_error_response(
                code="INTERNAL_ERROR",
                message="An unexpected error occurred. Please try again.",
                detail=str(exc) if settings_debug() else None,
                request_id=request_id,
                status_code=500,
            )


def settings_debug() -> bool:
    """Lazy import to avoid circular dependency with config at module load."""
    from app.core.config import get_settings
    return get_settings().DEBUG


# ── Registration helper ───────────────────────────────────────────────────────

def register_error_handlers(app: FastAPI) -> None:
    """
    Call this once in your app factory (main.py / app/__init__.py).

    Example:
        from app.api.middleware.error_handler import register_error_handlers
        register_error_handlers(app)
    """
    app.add_middleware(ErrorHandlerMiddleware)

    logger.info("Error handler middleware registered")