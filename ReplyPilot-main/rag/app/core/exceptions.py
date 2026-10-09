"""
Custom exception hierarchy for the YT-RAG pipeline.

Design principles:
  - Every exception carries a human-readable `message` and a machine-readable `code`.
  - Pipeline stages raise their own typed exception so the orchestrator can
    handle each failure mode differently (e.g. retry embedding errors, skip
    already-indexed videos, dead-letter corrupt transcripts).
  - HTTP layer maps these to structured JSON responses via the error handler
    middleware — no raw Python exceptions ever reach the client.
"""


class YTRagBaseException(Exception):
    """Root exception. All custom exceptions inherit from this."""

    code: str = "INTERNAL_ERROR"

    def __init__(self, message: str, detail: str | None = None) -> None:
        self.message = message
        self.detail = detail  # optional extra context (e.g. original exception str)
        super().__init__(message)

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(code={self.code!r}, message={self.message!r})"


# ── Redis / Ingestion ─────────────────────────────────────────────────────────

class RedisConnectionError(YTRagBaseException):
    """Raised when the Redis client cannot establish or sustain a connection."""
    code = "REDIS_CONNECTION_ERROR"


class TranscriptNotFoundError(YTRagBaseException):
    """
    Raised when a videoId is popped from the ingest queue but no transcript
    exists in Redis under transcript:{videoId}.
    """
    code = "TRANSCRIPT_NOT_FOUND"


class TranscriptAlreadyIndexedError(YTRagBaseException):
    """
    Raised by guard.py when indexed:{videoId} is already set in Redis.
    The orchestrator treats this as a no-op, not a hard failure.
    """
    code = "TRANSCRIPT_ALREADY_INDEXED"


class TranscriptCleaningError(YTRagBaseException):
    """Raised when text_cleaner fails to produce usable output."""
    code = "TRANSCRIPT_CLEANING_ERROR"


# ── Chunking ──────────────────────────────────────────────────────────────────

class ChunkingError(YTRagBaseException):
    """Raised when the token splitter or context builder fails."""
    code = "CHUNKING_ERROR"


class EmptyChunkError(YTRagBaseException):
    """
    Raised when the chunker produces zero chunks from a transcript.
    Usually means the cleaned transcript was too short or entirely whitespace.
    """
    code = "EMPTY_CHUNK_ERROR"


# ── Embedding ─────────────────────────────────────────────────────────────────

class EmbeddingError(YTRagBaseException):
    """Generic embedding failure — model load error, inference crash, etc."""
    code = "EMBEDDING_ERROR"


class EmbeddingBatchError(YTRagBaseException):
    """
    Raised when a specific batch of chunks fails to embed after all retries.
    Carries `batch_index` so the orchestrator knows which batch failed.
    """
    code = "EMBEDDING_BATCH_ERROR"

    def __init__(self, message: str, batch_index: int, detail: str | None = None) -> None:
        self.batch_index = batch_index
        super().__init__(message, detail)


class EmbeddingDimensionMismatchError(YTRagBaseException):
    """
    Raised when the model produces vectors of a different dimension than
    PINECONE_DIMENSION in config. Catches model/config drift early.
    """
    code = "EMBEDDING_DIMENSION_MISMATCH"


# ── Vector Storage ────────────────────────────────────────────────────────────

class PineconeConnectionError(YTRagBaseException):
    """Raised when the Pinecone client cannot connect or authenticate."""
    code = "PINECONE_CONNECTION_ERROR"


class PineconeUpsertError(YTRagBaseException):
    """Raised when a batch upsert to Pinecone fails after retries."""
    code = "PINECONE_UPSERT_ERROR"


class PineconeQueryError(YTRagBaseException):
    """Raised when a similarity search query to Pinecone fails."""
    code = "PINECONE_QUERY_ERROR"


class PineconeIndexNotFoundError(YTRagBaseException):
    """Raised when the configured index does not exist in Pinecone."""
    code = "PINECONE_INDEX_NOT_FOUND"


# ── Retrieval ─────────────────────────────────────────────────────────────────

class QueryEmbeddingError(YTRagBaseException):
    """Raised when the query text cannot be embedded at retrieval time."""
    code = "QUERY_EMBEDDING_ERROR"


class NoRelevantChunksError(YTRagBaseException):
    """
    Raised when Pinecone returns results but all scores fall below
    RETRIEVAL_SCORE_THRESHOLD. Signals the caller to return a
    "no relevant context found" response rather than hallucinating.
    """
    code = "NO_RELEVANT_CHUNKS"


class RerankerError(YTRagBaseException):
    """Raised when the optional cross-encoder reranker fails."""
    code = "RERANKER_ERROR"


# ── Worker ────────────────────────────────────────────────────────────────────

class WorkerMaxRetriesExceededError(YTRagBaseException):
    """
    Raised when a videoId has been retried WORKER_MAX_RETRIES times
    and still fails. The worker dead-letters it and moves on.
    """
    code = "WORKER_MAX_RETRIES_EXCEEDED"


# ── API ───────────────────────────────────────────────────────────────────────

class InvalidRequestError(YTRagBaseException):
    """Raised for malformed API request payloads before pipeline starts."""
    code = "INVALID_REQUEST"