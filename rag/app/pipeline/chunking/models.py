"""
app/pipeline/chunking/models.py

Pydantic models that flow between the chunker and the embedding stage.
Using Pydantic here (not dataclasses) so chunks can be serialised to JSON
easily for logging, caching, and debugging.
"""

from pydantic import BaseModel, Field


class Chunk(BaseModel):
    """
    A single time-windowed chunk of transcript text.

    text_for_embedding : context_prefix + raw_text — what gets sent to BGE.
    raw_text           : just the window's own text — what gets returned to users.
    """

    chunk_id: str = Field(
        description="Globally unique ID. Format: {video_id}_chunk_{index:04d}",
        examples=["dQw4w9WgXcQ_chunk_0003"],
    )
    video_id: str
    chunk_index: int                 # 0-based position in this video's chunk sequence
    raw_text: str                    # text shown to users in query results
    text_for_embedding: str          # raw_text prefixed with previous chunk context

    # Time metadata — enables deep-linking to exact video moment
    start_time_seconds: float        # start of this time window
    end_time_seconds: float          # end of this time window
    chunk_window_seconds: int        # the configured window size (e.g. 60)

    # Video metadata — stored in Pinecone payload alongside the vector
    video_title: str | None = None
    channel_name: str | None = None


class ChunkBatch(BaseModel):
    """A batch of chunks ready for embedding."""
    video_id: str
    chunks: list[Chunk]
    total_chunks: int
    total_duration_seconds: float