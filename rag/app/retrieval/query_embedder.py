"""
app/retrieval/query_embedder.py

Embeds an incoming user query at retrieval time using the same
BGEEmbedder singleton used during indexing.

Critical constraint: the SAME model must be used at index time and
query time. If you indexed with bge-large but query with bge-base,
the vector spaces don't match and retrieval quality collapses.
The BGE_MODEL_NAME config value enforces this across both stages.
"""

from app.core.exceptions import QueryEmbeddingError
from app.core.logger import get_logger
from app.pipeline.embedding.bge_embedder import BGEEmbedder

logger = get_logger(__name__)


class QueryEmbedder:
    """
    Wraps BGEEmbedder for query-time use.
    Separated from the pipeline embedder to keep retrieval
    and ingestion concerns independent.
    """

    def __init__(self) -> None:
        # BGEEmbedder is a singleton — no new model load here
        self._embedder = BGEEmbedder()

    def embed(self, question: str) -> list[float]:
        """
        Embed a user question with the BGE query instruction prefix.

        Args:
            question: Raw question string from the API request.

        Returns:
            Normalised float vector ready for Pinecone similarity search.

        Raises:
            QueryEmbeddingError: if embedding fails.
        """
        question = question.strip()
        if not question:
            raise QueryEmbeddingError(
                message="Cannot embed an empty query.",
            )

        logger.debug("Embedding query", question_length=len(question))

        try:
            vector = self._embedder.embed_query(question)
        except QueryEmbeddingError:
            raise
        except Exception as exc:
            raise QueryEmbeddingError(
                message="Unexpected error during query embedding.",
                detail=str(exc),
            ) from exc

        logger.debug(
            "Query embedded",
            vector_dimension=len(vector),
            model=self._embedder.model_name,
        )
        return vector