"""
app/pipeline/orchestrator.py

Master controller for the full RAG ingest pipeline.

Stage order (strict — each stage depends on the previous):
  1. Guard       — skip if already indexed (unless force_reindex)
  2. RedisReader — pull raw transcript from Redis
  3. TextCleaner — strip noise from segment texts
  4. TimeChunker — group segments into time windows
  5. ContextBuilder — prepend prev-chunk context to each chunk's embedding text
  6. BGEEmbedder — generate vectors for each chunk
  7. PayloadBuilder — zip chunks + vectors into Pinecone records
  8. PineconeStore — upsert records into the vector index
  9. Guard.mark  — write indexed:{video_id} flag to Redis

The orchestrator is the ONLY file that knows the stage sequence.
Individual stages are completely unaware of each other.
"""

import asyncio

from app.core.exceptions import TranscriptAlreadyIndexedError
from app.core.logger import get_logger
from app.pipeline.chunking.context_builder import build_context
from app.pipeline.chunking.token_splitter import TimeBasedChunker
from app.pipeline.embedding.bge_embedder import BGEEmbedder
from app.pipeline.ingestion.guard import IndexGuard
from app.pipeline.ingestion.redis_reader import RedisTranscriptReader
from app.pipeline.ingestion.text_cleaner import clean_transcript
from app.pipeline.storage.payload_builder import build_vector_records
from app.pipeline.storage.pinecone_client import PineconeVectorStore

logger = get_logger(__name__)


class IngestOrchestrator:
    """
    Runs the full end-to-end ingest pipeline for one YouTube video.

    Instantiate once per ingest job — it creates fresh stage instances
    but uses the shared singletons for model and Pinecone client.
    """

    def __init__(self) -> None:
        self._guard = IndexGuard()
        self._reader = RedisTranscriptReader()
        self._embedder = BGEEmbedder()      # singleton — model loaded once
        self._store = PineconeVectorStore()  # singleton — Pinecone client

    async def run(
        self,
        video_id: str,
        video_title: str | None = None,
        channel_name: str | None = None,
        chunk_window_seconds: int = 60,
        force_reindex: bool = False,
    ) -> dict:
        """
        Execute the full ingest pipeline for one video.

        Args:
            video_id:             YouTube video ID.
            video_title:          Optional — stored as chunk metadata.
            channel_name:         Optional — stored as chunk metadata.
            chunk_window_seconds: Time window size for chunking (default 60s).
            force_reindex:        If True, clears old Pinecone vectors and
                                  re-runs the full pipeline even if already indexed.

        Returns:
            dict with pipeline summary:
            {
                "video_id":             str,
                "chunks_indexed":       int,
                "total_duration_seconds": float,
                "chunk_window_seconds": int,
            }

        Raises:
            TranscriptAlreadyIndexedError: video already indexed and force_reindex=False.
                                           The caller (service layer) treats this as a no-op.
            TranscriptNotFoundError:       no transcript in Redis.
            ChunkingError / EmptyChunkError.
            EmbeddingError / EmbeddingBatchError.
            PineconeUpsertError.
            RedisConnectionError.
        """
        logger.info(
            "Ingest pipeline started",
            video_id=video_id,
            chunk_window_seconds=chunk_window_seconds,
            force_reindex=force_reindex,
        )

        # ── Stage 1: Guard ────────────────────────────────────────────────────
        if force_reindex:
            await self._guard.clear_indexed(video_id)
            # Also purge old Pinecone vectors so they don't accumulate
            await self._store.delete_video(video_id)
            logger.info("Force re-index: cleared old data", video_id=video_id)
        else:
            # Raises TranscriptAlreadyIndexedError if already done
            await self._guard.assert_not_indexed(video_id)

        # ── Stage 2: Read transcript from Redis ───────────────────────────────
        logger.info("Stage 2: Reading transcript from Redis", video_id=video_id)
        raw_transcript = await self._reader.read(video_id)

        # ── Stage 3: Clean segment texts ─────────────────────────────────────
        logger.info("Stage 3: Cleaning transcript", video_id=video_id)
        clean = clean_transcript(raw_transcript)

        # ── Stage 4: Time-based chunking ──────────────────────────────────────
        logger.info(
            "Stage 4: Chunking by time window",
            video_id=video_id,
            window_seconds=chunk_window_seconds,
        )
        chunker = TimeBasedChunker(window_seconds=chunk_window_seconds)
        chunk_batch = chunker.split(
            transcript=clean,
            video_title=video_title,
            channel_name=channel_name,
        )

        # ── Stage 5: Build context prefixes ──────────────────────────────────
        logger.info("Stage 5: Building context prefixes", video_id=video_id)
        enriched_batch = build_context(chunk_batch)

        # ── Stage 6: Generate embeddings ─────────────────────────────────────
        logger.info(
            "Stage 6: Generating BGE embeddings",
            video_id=video_id,
            total_chunks=enriched_batch.total_chunks,
        )
        loop = asyncio.get_event_loop()
        embedding_batch = await loop.run_in_executor(
            None, 
            self._embedder.embed_chunks, 
            enriched_batch
        )

        # ── Stage 7: Build Pinecone records ───────────────────────────────────
        logger.info("Stage 7: Building vector records", video_id=video_id)
        records = build_vector_records(
            chunks=enriched_batch.chunks,
            embedding_results=embedding_batch.results,
        )

        # ── Stage 8: Upsert into Pinecone ─────────────────────────────────────
        logger.info(
            "Stage 8: Upserting to Pinecone",
            video_id=video_id,
            record_count=len(records),
        )
        upsert_result = await self._store.upsert(records)

        # ── Stage 9: Mark as indexed in Redis ─────────────────────────────────
        await self._guard.mark_indexed(
            video_id=video_id,
            chunk_count=upsert_result.upserted_count,
            chunk_window_seconds=chunk_window_seconds,
        )

        summary = {
            "video_id": video_id,
            "chunks_indexed": upsert_result.upserted_count,
            "total_duration_seconds": enriched_batch.total_duration_seconds,
            "chunk_window_seconds": chunk_window_seconds,
        }

        logger.info("Ingest pipeline completed successfully", **summary)
        return summary