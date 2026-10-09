"""
app/pipeline/storage/models.py

Data models for the Pinecone storage stage.
"""

from pydantic import BaseModel


class VectorRecord(BaseModel):
    """
    One record to upsert into Pinecone.
    id + values + metadata is exactly what Pinecone's upsert expects.
    """
    id: str                      # chunk_id — must be unique per index
    values: list[float]          # the embedding vector
    metadata: dict               # all chunk fields stored as Pinecone payload


class UpsertResult(BaseModel):
    """Summary of a completed upsert operation."""
    video_id: str
    upserted_count: int
    failed_count: int
    total_attempted: int