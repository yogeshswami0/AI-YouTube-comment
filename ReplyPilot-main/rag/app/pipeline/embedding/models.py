"""
app/pipeline/embedding/models.py

Data models for the embedding stage.
"""

from pydantic import BaseModel, ConfigDict


class EmbeddingResult(BaseModel):
    """Embedding output for a single chunk."""
    chunk_id: str
    vector: list[float]          # 768-dim (bge-base) or 1024-dim (bge-large/bge-m3)
    dimension: int               # sanity check field — must match PINECONE_DIMENSION


class EmbeddingBatch(BaseModel):
    """Embedding outputs for a full batch of chunks."""
    model_config = ConfigDict(protected_namespaces=())
    
    video_id: str
    results: list[EmbeddingResult]
    model_name: str              # e.g. "BAAI/bge-base-en-v1.5"
    total_embedded: int