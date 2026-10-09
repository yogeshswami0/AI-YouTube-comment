from functools import lru_cache
from pathlib import Path
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve .env relative to this file (app/core/config.py → project root)
# This works regardless of which directory uvicorn / the worker is launched from.
_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ───────────────────────────────────────────────────────────────────
    APP_ENV: Literal["development", "staging", "production"] = "development"
    APP_NAME: str = "yt-rag"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # ── Redis ─────────────────────────────────────────────────────────────────
    REDIS_HOST: str
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: str
    REDIS_USERNAME: str = "default"
    REDIS_USE_TLS: bool = True
    REDIS_SOCKET_TIMEOUT: int = 10          # seconds — how long a regular command waits
    REDIS_SOCKET_CONNECT_TIMEOUT: int = 5   # seconds — TCP handshake timeout
    REDIS_MAX_CONNECTIONS: int = 10

    # Queue keys (must match exactly what Node.js pushes to)
    REDIS_INGEST_QUEUE_KEY: str = "rag:ingest:queue"
    REDIS_PROCESSING_KEY: str = "rag:ingest:processing"   # BRPOPLPUSH safety list
    REDIS_INDEXED_PREFIX: str = "indexed:"                # indexed:{videoId} = "1"
    REDIS_TRANSCRIPT_PREFIX: str = "transcript:"          # transcript:{videoId} = raw text

    # BRPOP timeout — 0 = block forever, >0 = unblock after N seconds and loop
    # Use 30 in production so the worker can do periodic health checks
    REDIS_BRPOP_TIMEOUT: int = 30

    # ── Pinecone ──────────────────────────────────────────────────────────────
    PINECONE_API_KEY: str
    PINECONE_INDEX_NAME: str = "yt-rag"
    PINECONE_CLOUD: str = "aws"
    PINECONE_REGION: str = "us-east-1"
    # Dimension must match the chosen BGE model:
    #   bge-base-en-v1.5  → 768
    #   bge-large-en-v1.5 → 1024
    #   bge-m3            → 1024
    PINECONE_DIMENSION: int = 768
    PINECONE_METRIC: str = "cosine"

    # ── Embedding ─────────────────────────────────────────────────────────────
    BGE_MODEL_NAME: str = "BAAI/bge-base-en-v1.5"
    # Options:
    #   "BAAI/bge-base-en-v1.5"   — fast, 768-dim, English only
    #   "BAAI/bge-large-en-v1.5"  — slower, 1024-dim, better quality, English only
    #   "BAAI/bge-m3"             — slowest, 1024-dim, multilingual (use for Hinglish)
    BGE_DEVICE: Literal["cpu", "cuda", "mps"] = "cpu"
    BGE_BATCH_SIZE: int = 8                # chunks per embedding batch
    BGE_MAX_SEQUENCE_LENGTH: int = 512     # tokens — hard limit for all BGE models
    BGE_NORMALIZE_EMBEDDINGS: bool = True  # required for cosine similarity

    # ── Chunking (time-based) ─────────────────────────────────────────────────
    CHUNK_WINDOW_SECONDS: int = 60         # each chunk covers N seconds of the video
    CONTEXT_PREFIX_SENTENCES: int = 2      # sentences from prev chunk used as context header

    # ── Retrieval ─────────────────────────────────────────────────────────────
    RETRIEVAL_TOP_K: int = 4               # how many chunks to fetch from Pinecone
    RETRIEVAL_SCORE_THRESHOLD: float = 0.65  # discard chunks below this cosine score
    RERANKER_ENABLED: bool = False         # flip to True when you add cross-encoder
    RERANKER_MODEL_NAME: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"

    # ── Worker ────────────────────────────────────────────────────────────────
    WORKER_MAX_RETRIES: int = 3            # retry failed ingest jobs N times before dead-lettering
    WORKER_RETRY_DELAY_SECONDS: int = 5    # base delay between retries (exponential backoff applied)

    @property
    def redis_url(self) -> str:
        scheme = "rediss" if self.REDIS_USE_TLS else "redis"
        return (
            f"{scheme}://{self.REDIS_USERNAME}:{self.REDIS_PASSWORD}"
            f"@{self.REDIS_HOST}:{self.REDIS_PORT}"
        )

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """
    Returns a cached singleton Settings instance.
    Import and call this everywhere instead of instantiating Settings directly.

    Usage:
        from app.core.config import get_settings
        settings = get_settings()
    """
    return Settings()