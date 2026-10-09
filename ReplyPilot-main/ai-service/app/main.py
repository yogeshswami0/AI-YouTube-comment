import os
os.environ["PYTORCH_JIT"] = "0"

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import time

from app.core.logging        import setup_logging, get_logger
from app.core.config         import get_settings

setup_logging()
logger = get_logger(__name__)
settings = get_settings()

from app.api.v1.classify import router as classify_router
from app.api.v1.generate import router as generate_router


app = FastAPI(
    title       = "YT Comment AI Service",
    description = "Intent classification and reply generation for YouTube comments",
    version     = "1.0.0",
    docs_url    = "/docs",
    redoc_url   = "/redoc",
)


# Get allowed origins from environment variable, fallback to localhost
allowed_origins_str = os.getenv("ALLOWED_ORIGINS", "http://localhost:5000,http://localhost:5173")
allowed_origins = [origin.strip() for origin in allowed_origins_str.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins     = allowed_origins,
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)


@app.middleware("http")
async def add_process_time(request: Request, call_next):
    start    = time.perf_counter()
    response = await call_next(request)
    elapsed  = (time.perf_counter() - start) * 1000   # ms
    response.headers["X-Process-Time-Ms"] = f"{elapsed:.1f}"
    logger.debug(f"{request.method} {request.url.path} → {response.status_code} ({elapsed:.1f}ms)")
    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception on {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
    )


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "ai-service"}


app.include_router(classify_router, prefix="/api/v1", tags=["classify"])
app.include_router(generate_router, prefix="/api/v1", tags=["generate"])
