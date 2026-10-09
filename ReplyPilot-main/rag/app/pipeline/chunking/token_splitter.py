"""
app/pipeline/chunking/token_splitter.py

Time-based transcript chunker.

Strategy:
  - Divide the video timeline into fixed-size windows of `window_seconds`.
  - Assign each transcript segment to the window that contains its `start` time.
  - Concatenate all segment texts within the same window into one chunk.
  - Windows with no segments (silent gaps) are skipped entirely.

Example (window_seconds=60):
  Window 0 : segments with start in [0s,   60s)  → chunk_0000
  Window 1 : segments with start in [60s,  120s) → chunk_0001
  Window 2 : segments with start in [120s, 180s) → chunk_0002
  ...

Why time-based instead of token-based?
  - Natural for YouTube: users think in timestamps, not token counts.
  - Enables precise deep-links back to the video (t=120).
  - Consistent chunk granularity regardless of speaking pace.
  - Works well with auto-generated captions which vary in density.
"""

import math

from app.core.config import get_settings
from app.core.exceptions import ChunkingError, EmptyChunkError
from app.core.logger import get_logger
from app.pipeline.ingestion.redis_reader import RawTranscript
from app.pipeline.chunking.models import Chunk, ChunkBatch

logger = get_logger(__name__)
settings = get_settings()


class TimeBasedChunker:
    """
    Groups transcript segments into fixed-duration time windows.

    Args:
        window_seconds: Duration of each chunk window in seconds.
                        Pulled from IngestRequest.chunk_window_seconds.
    """

    def __init__(self, window_seconds: int) -> None:
        if window_seconds < 10:
            raise ChunkingError(
                message=f"window_seconds must be >= 10, got {window_seconds}.",
            )
        self._window = window_seconds

    def split(
        self,
        transcript: RawTranscript,
        video_title: str | None = None,
        channel_name: str | None = None,
    ) -> ChunkBatch:
        """
        Splits a cleaned transcript into time-windowed chunks.

        Args:
            transcript:   Cleaned RawTranscript from text_cleaner.
            video_title:  Optional — stored in chunk metadata.
            channel_name: Optional — stored in chunk metadata.

        Returns:
            ChunkBatch containing all chunks, ready for context building.

        Raises:
            EmptyChunkError: if no chunks are produced (transcript too short).
        """
        if not transcript.segments:
            raise EmptyChunkError(
                message=f"Transcript for {transcript.video_id!r} has no segments to chunk.",
            )

        # Determine total number of windows needed
        total_duration = transcript.total_duration_seconds
        num_windows = math.ceil(total_duration / self._window) or 1

        # Bucket segments into their windows
        windows: dict[int, list[str]] = {i: [] for i in range(num_windows)}

        for seg in transcript.segments:
            window_idx = int(seg.start // self._window)
            # Clamp to last window (handles floating point edge cases)
            window_idx = min(window_idx, num_windows - 1)
            windows[window_idx].append(seg.text)

        # Build Chunk objects for non-empty windows
        chunks: list[Chunk] = []
        chunk_index = 0

        for window_idx in range(num_windows):
            texts = windows[window_idx]
            if not texts:
                continue  # silent gap — skip entirely

            raw_text = " ".join(texts)
            start_time = window_idx * self._window
            end_time = min((window_idx + 1) * self._window, total_duration)

            chunks.append(Chunk(
                chunk_id=f"{transcript.video_id}_chunk_{chunk_index:04d}",
                video_id=transcript.video_id,
                chunk_index=chunk_index,
                raw_text=raw_text,
                text_for_embedding=raw_text,  # context_builder fills this in next
                start_time_seconds=round(start_time, 2),
                end_time_seconds=round(end_time, 2),
                chunk_window_seconds=self._window,
                video_title=video_title,
                channel_name=channel_name,
            ))
            chunk_index += 1

        if not chunks:
            raise EmptyChunkError(
                message=f"Transcript for {transcript.video_id!r} produced zero chunks.",
                detail=f"total_duration={total_duration}s, window={self._window}s",
            )

        logger.info(
            "Transcript chunked by time",
            video_id=transcript.video_id,
            window_seconds=self._window,
            total_chunks=len(chunks),
            total_duration_seconds=round(total_duration, 1),
        )

        return ChunkBatch(
            video_id=transcript.video_id,
            chunks=chunks,
            total_chunks=len(chunks),
            total_duration_seconds=total_duration,
        )