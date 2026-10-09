"""
app/worker/queue_consumer.py

Long-running Redis BRPOP queue consumer.

Lifecycle:
  1. Connects to Redis
  2. Calls BRPOP on rag:ingest:queue — blocks until a job appears
  3. Atomically copies the job to rag:ingest:processing (crash safety)
  4. Calls run_ingest_task(payload)
  5. On success : removes job from processing list
  6. On failure : retries up to WORKER_MAX_RETRIES with exponential backoff
  7. On max retries exceeded : dead-letters job to rag:ingest:dead
  8. Loops back to step 2

Run this as a separate process:
    python -m app.worker.queue_consumer

BRPOP crash safety:
  If the worker crashes mid-pipeline the job stays in rag:ingest:processing.
  On next startup, _recover_processing_jobs() moves it back to the main
  queue so it gets retried automatically — nothing is silently lost.
"""

import asyncio
import json
import signal
import time

import redis.asyncio as aioredis

from app.core.config import get_settings
from app.core.logger import get_logger
from app.worker.tasks import run_ingest_task

logger = get_logger(__name__)
settings = get_settings()

INGEST_QUEUE    = settings.REDIS_INGEST_QUEUE_KEY   # "rag:ingest:queue"
PROCESSING_LIST = settings.REDIS_PROCESSING_KEY      # "rag:ingest:processing"
DEAD_LETTER     = "rag:ingest:dead"


class QueueConsumer:

    def __init__(self) -> None:
        self._client: aioredis.Redis | None = None
        self._running = True

    # ── Connection ────────────────────────────────────────────────────────────

    async def _connect(self) -> aioredis.Redis:
        client = aioredis.from_url(
            settings.redis_url,
            socket_connect_timeout=settings.REDIS_SOCKET_CONNECT_TIMEOUT,
            socket_timeout=None,      # no timeout — BRPOP blocks intentionally
            decode_responses=True,
        )
        await client.ping()
        return client

    async def _ensure_connection(self) -> aioredis.Redis:
        if self._client is None:
            self._client = await self._connect()
            logger.info("Redis connected")
        return self._client

    async def _reconnect(self) -> None:
        if self._client:
            try:
                await self._client.aclose()
            except Exception:
                pass
            self._client = None

        delay = 2.0
        while self._running:
            try:
                self._client = await self._connect()
                logger.info("Redis reconnected")
                return
            except Exception as exc:
                logger.warning("Redis reconnect failed", error=str(exc), retry_in=delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30)

    # ── Crash recovery ────────────────────────────────────────────────────────

    async def _recover_processing_jobs(self) -> None:
        """
        On startup, move jobs stuck in processing list back to the main queue.
        These were in-flight when the worker last crashed.
        """
        client = await self._ensure_connection()
        stuck: list[str] = await client.lrange(PROCESSING_LIST, 0, -1)
        if not stuck:
            return

        logger.warning("Recovering stuck jobs", count=len(stuck))
        pipe = client.pipeline()
        for job in stuck:
            pipe.lrem(PROCESSING_LIST, 1, job)
            pipe.lpush(INGEST_QUEUE, job)
        await pipe.execute()
        logger.info("Stuck jobs recovered", count=len(stuck))

    # ── Job execution ─────────────────────────────────────────────────────────

    async def _process_job(self, raw_payload: str) -> None:
        """Execute the ingest task with exponential backoff retry."""
        client = await self._ensure_connection()
        max_retries = settings.WORKER_MAX_RETRIES
        base_delay = float(settings.WORKER_RETRY_DELAY_SECONDS)

        for attempt in range(1, max_retries + 1):
            try:
                await run_ingest_task(raw_payload)
                # Success — remove from processing
                await client.lrem(PROCESSING_LIST, 1, raw_payload)
                logger.info("Job succeeded", attempt=attempt)
                return

            except Exception as exc:
                logger.error(
                    "Job attempt failed",
                    attempt=attempt,
                    max_retries=max_retries,
                    error=str(exc),
                )

                if attempt == max_retries:
                    # Dead-letter: record full failure context
                    record = json.dumps({
                        "payload": raw_payload,
                        "error": str(exc),
                        "failed_at": time.time(),
                        "attempts": attempt,
                    })
                    pipe = client.pipeline()
                    pipe.lrem(PROCESSING_LIST, 1, raw_payload)
                    pipe.lpush(DEAD_LETTER, record)
                    await pipe.execute()
                    logger.error("Job dead-lettered", payload_preview=raw_payload[:120])
                    return

                delay = base_delay * (2 ** (attempt - 1))
                logger.info("Retrying job", retry_in_seconds=delay, attempt=attempt)
                await asyncio.sleep(delay)

    # ── Main loop ─────────────────────────────────────────────────────────────

    async def run(self) -> None:
        logger.info(
            "Worker started",
            queue=INGEST_QUEUE,
            max_retries=settings.WORKER_MAX_RETRIES,
        )

        await self._recover_processing_jobs()

        while self._running:
            try:
                client = await self._ensure_connection()

                # BRPOP blocks for REDIS_BRPOP_TIMEOUT seconds (default 30).
                # Returns None on timeout — we simply loop and block again.
                result = await client.brpop(
                    INGEST_QUEUE,
                    timeout=settings.REDIS_BRPOP_TIMEOUT,
                )

                if result is None:
                    continue  # timeout — no jobs, loop again

                _key, raw_payload = result
                logger.info("Job dequeued", payload_preview=raw_payload[:120])

                # Push to processing list BEFORE starting work (crash safety)
                await client.lpush(PROCESSING_LIST, raw_payload)

                await self._process_job(raw_payload)
                
                # Requested by user: wait 100 milliseconds between processing queue items
                await asyncio.sleep(0.1)

            except (aioredis.ConnectionError, aioredis.TimeoutError, ConnectionResetError) as exc:
                logger.warning("Redis connection lost — reconnecting", error=str(exc))
                await self._reconnect()

            except asyncio.CancelledError:
                self._running = False
                break

            except Exception as exc:
                # Fringe error in the consumer loop itself — log and continue
                logger.error("Unexpected consumer loop error", error=str(exc))
                await asyncio.sleep(2)

        logger.info("Worker stopped cleanly")

    def stop(self) -> None:
        self._running = False


# ── Entry point ───────────────────────────────────────────────────────────────

_consumer: QueueConsumer | None = None


def _handle_signal(sig: int, _frame: object) -> None:
    logger.info("Shutdown signal received", signal=sig)
    if _consumer:
        _consumer.stop()


async def _main() -> None:
    global _consumer
    _consumer = QueueConsumer()
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)
    await _consumer.run()


if __name__ == "__main__":
    asyncio.run(_main())