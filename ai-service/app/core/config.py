from functools import lru_cache
from pathlib import Path
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict

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
    DEBUG: bool = False

    # ── HuggingFace ───────────────────────────────────────────────────────────
    HF_TOKEN: str = ""

    # ── RAG Service ───────────────────────────────────────────────────────────
    RAG_SERVICE_URL: str = "http://localhost:8001"

    # ── Classification Thresholds ─────────────────────────────────────────────
    QUESTION_CONFIDENCE_THRESHOLD: float = 0.4

    # ── Redis (for spam gatekeeper bot-swarm detection) ───────────────────────
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: str = ""
    REDIS_USERNAME: str = "default"
    REDIS_USE_TLS: bool = True

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
    return Settings()
