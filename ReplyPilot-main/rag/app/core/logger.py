"""
Structured JSON logger built on loguru.

Every log line is a JSON object when running in staging/production,
and a pretty human-readable coloured line in development.

Usage anywhere in the codebase:
    from app.core.logger import get_logger
    logger = get_logger(__name__)
    logger.info("Chunk created", chunk_id="vid_001_chunk_003", tokens=312)

The `get_logger` wrapper returns a loguru logger bound with the module name
so every log line automatically carries `module` as a field — you never
have to pass it manually.
"""

import sys
import json
import logging
from typing import Any
from loguru import logger as _loguru_logger

from app.core.config import get_settings

settings = get_settings()


# ── JSON sink for structured logging (staging / production) ───────────────────

def _json_sink(message: "loguru.Message") -> None:  # type: ignore[name-defined]  # noqa: F821
    """
    Custom sink that writes one JSON object per log line to stdout.
    This is what log aggregators (Datadog, Loki, CloudWatch) expect.
    """
    record = message.record
    log_entry: dict[str, Any] = {
        "timestamp": record["time"].isoformat(),
        "level": record["level"].name,
        "module": record["name"],
        "function": record["function"],
        "line": record["line"],
        "message": record["message"],
    }
    # Any extra key=value pairs passed to logger.info(...) land in `extra`
    if record["extra"]:
        log_entry["extra"] = record["extra"]

    # If an exception was logged, include the traceback as a string
    if record["exception"]:
        exc = record["exception"]
        log_entry["exception"] = {
            "type": exc.type.__name__ if exc.type else None,
            "value": str(exc.value),
        }

    sys.stdout.write(json.dumps(log_entry) + "\n")
    sys.stdout.flush()


# ── Intercept standard library `logging` calls into loguru ───────────────────
# Libraries like uvicorn, httpx, and pinecone use stdlib logging.
# This intercept makes all of them flow through our single loguru config.

class _InterceptHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = _loguru_logger.level(record.levelname).name
        except ValueError:
            level = record.levelno  # type: ignore[assignment]

        frame, depth = sys._getframe(6), 6
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back  # type: ignore[assignment]
            depth += 1

        _loguru_logger.opt(depth=depth, exception=record.exc_info).log(
            level, record.getMessage()
        )


def _configure_logger() -> None:
    _loguru_logger.remove()  # drop loguru's default stderr sink

    if settings.APP_ENV == "development":
        # Pretty coloured output for local dev
        _loguru_logger.add(
            sys.stdout,
            level="DEBUG",
            colorize=True,
            format=(
                "<green>{time:HH:mm:ss}</green> | "
                "<level>{level: <8}</level> | "
                "<cyan>{name}</cyan>:<cyan>{line}</cyan> — "
                "<level>{message}</level>"
                "{extra}"
            ),
        )
    else:
        # Structured JSON for staging / production
        _loguru_logger.add(
            _json_sink,
            level="INFO",
            serialize=False,  # we handle serialization ourselves in _json_sink
        )

    # Route all stdlib logging through loguru
    logging.basicConfig(handlers=[_InterceptHandler()], level=0, force=True)
    for noisy_lib in ["uvicorn", "uvicorn.access", "fastapi", "httpx"]:
        logging.getLogger(noisy_lib).handlers = [_InterceptHandler()]


_configure_logger()


def get_logger(name: str) -> "loguru.Logger":  # type: ignore[name-defined]  # noqa: F821
    """
    Returns a loguru logger bound with `module=name`.

    Args:
        name: Typically `__name__` of the calling module.

    Returns:
        A loguru Logger instance with the module name pre-bound.
    """
    return _loguru_logger.bind(module=name)