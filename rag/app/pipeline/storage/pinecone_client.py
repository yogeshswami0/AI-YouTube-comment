"""
app/pipeline/storage/pinecone_client.py

Pinecone client wrapper — handles index lifecycle, upsert, and query.

Singleton pattern: one Pinecone client instance shared across the app.
Pinecone's SDK is synchronous so all calls are wrapped in
asyncio.run_in_executor to avoid blocking the event loop.

Upsert batching:
  Pinecone recommends upsert batches of 100 vectors max.
  We chunk our VectorRecords into batches of 100 before upserting.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any, ClassVar

from pinecone import Pinecone, ServerlessSpec

from app.core.config import get_settings
from app.core.exceptions import (
    PineconeConnectionError,
    PineconeIndexNotFoundError,
    PineconeQueryError,
    PineconeUpsertError,
)
from app.core.logger import get_logger
from app.pipeline.storage.models import UpsertResult, VectorRecord

logger = get_logger(__name__)
settings = get_settings()

_UPSERT_BATCH_SIZE = 100   # Pinecone recommended max per upsert call


class PineconeVectorStore:
    """
    Async-friendly Pinecone client.

    All heavy SDK calls run in a thread pool so they don't block
    FastAPI's event loop.
    """

    _instance: ClassVar[PineconeVectorStore | None] = None
    _lock: ClassVar[threading.Lock] = threading.Lock()
    _client: Pinecone | None = None
    _index: Any = None   # pinecone.Index

    def __new__(cls) -> PineconeVectorStore:
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def _get_client(self) -> Pinecone:
        if self._client is not None:
            return self._client
        try:
            self._client = Pinecone(api_key=settings.PINECONE_API_KEY)
            return self._client
        except Exception as exc:
            raise PineconeConnectionError(
                message="Failed to initialise Pinecone client.",
                detail=str(exc),
            ) from exc

    def _get_index(self) -> Any:
        """Returns the Pinecone Index object, creating the index if needed."""
        if self._index is not None:
            return self._index

        with self._lock:
            if self._index is not None:
                return self._index

            client = self._get_client()
            existing = [idx.name for idx in client.list_indexes()]

            if settings.PINECONE_INDEX_NAME not in existing:
                logger.info(
                    "Pinecone index not found — creating",
                    index_name=settings.PINECONE_INDEX_NAME,
                    dimension=settings.PINECONE_DIMENSION,
                    metric=settings.PINECONE_METRIC,
                )
                client.create_index(
                    name=settings.PINECONE_INDEX_NAME,
                    dimension=settings.PINECONE_DIMENSION,
                    metric=settings.PINECONE_METRIC,
                    spec=ServerlessSpec(
                        cloud=settings.PINECONE_CLOUD,
                        region=settings.PINECONE_REGION,
                    ),
                )

            self._index = client.Index(settings.PINECONE_INDEX_NAME)
            logger.info("Pinecone index connected", index_name=settings.PINECONE_INDEX_NAME)

        return self._index

    async def _get_index_async(self) -> Any:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._get_index)

    # ── Upsert ────────────────────────────────────────────────────────────────

    async def upsert(self, records: list[VectorRecord]) -> UpsertResult:
        """
        Upserts a list of VectorRecords into Pinecone.
        Splits into batches of 100 internally.

        Args:
            records: Built by payload_builder.build_vector_records().

        Returns:
            UpsertResult with counts of successes and failures.

        Raises:
            PineconeUpsertError: if any batch fails after retries.
        """
        index = await self._get_index_async()
        video_id = records[0].metadata.get("video_id", "unknown") if records else "unknown"

        # Split into Pinecone-safe batch sizes
        sub_batches = [
            records[i: i + _UPSERT_BATCH_SIZE]
            for i in range(0, len(records), _UPSERT_BATCH_SIZE)
        ]

        upserted_count = 0
        failed_count = 0

        loop = asyncio.get_event_loop()

        for batch_idx, sub_batch in enumerate(sub_batches):
            pinecone_vectors = [
                {"id": r.id, "values": r.values, "metadata": r.metadata}
                for r in sub_batch
            ]
            try:
                await loop.run_in_executor(
                    None,
                    lambda vecs=pinecone_vectors: index.upsert(vectors=vecs),
                )
                upserted_count += len(sub_batch)
                logger.debug(
                    "Pinecone upsert batch complete",
                    batch_idx=batch_idx,
                    batch_size=len(sub_batch),
                    total_batches=len(sub_batches),
                )
            except Exception as exc:
                failed_count += len(sub_batch)
                logger.error(
                    "Pinecone upsert batch failed",
                    batch_idx=batch_idx,
                    error=str(exc),
                    video_id=video_id,
                )
                raise PineconeUpsertError(
                    message=f"Pinecone upsert failed for batch {batch_idx} of video {video_id!r}.",
                    detail=str(exc),
                ) from exc

        logger.info(
            "Pinecone upsert complete",
            video_id=video_id,
            upserted_count=upserted_count,
            failed_count=failed_count,
        )

        return UpsertResult(
            video_id=video_id,
            upserted_count=upserted_count,
            failed_count=failed_count,
            total_attempted=len(records),
        )

    # ── Query ─────────────────────────────────────────────────────────────────

    async def query(
        self,
        vector: list[float],
        top_k: int,
        video_id: str | None = None,
    ) -> list[dict]:
        """
        Searches Pinecone for the most similar vectors.

        Args:
            vector:   Query embedding from BGEEmbedder.embed_query().
            top_k:    Number of results to return from Pinecone.
            video_id: If set, adds a metadata filter to restrict results
                      to this video only. None = global search.

        Returns:
            List of match dicts with keys: id, score, metadata.

        Raises:
            PineconeQueryError:        search call fails.
            PineconeIndexNotFoundError: index doesn't exist yet.
        """
        index = await self._get_index_async()
        filter_expr = {"video_id": {"$eq": video_id}} if video_id else None

        loop = asyncio.get_event_loop()
        try:
            response = await loop.run_in_executor(
                None,
                lambda: index.query(
                    vector=vector,
                    top_k=top_k,
                    include_metadata=True,
                    filter=filter_expr,
                ),
            )
        except Exception as exc:
            raise PineconeQueryError(
                message="Pinecone similarity search failed.",
                detail=str(exc),
            ) from exc

        matches = response.get("matches", [])

        return [
            {
                "chunk_id": m["id"],
                "score": float(m["score"]),
                "metadata": m.get("metadata", {}),
                "text": m.get("metadata", {}).get("text", ""),
            }
            for m in matches
        ]

    async def delete_video(self, video_id: str) -> None:
        """
        Deletes all vectors for a specific video from Pinecone.
        Called when force_reindex=True so old chunks don't accumulate.
        """
        index = await self._get_index_async()
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(
                None,
                lambda: index.delete(filter={"video_id": {"$eq": video_id}}),
            )
            logger.info("Deleted all vectors for video", video_id=video_id)
        except Exception as exc:
            logger.warning(
                "Failed to delete vectors for video — continuing with upsert",
                video_id=video_id,
                error=str(exc),
            )