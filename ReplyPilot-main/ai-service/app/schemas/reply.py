from pydantic import BaseModel, Field, ConfigDict
from typing import Literal, Optional


class FewShotExample(BaseModel):
    """A single few-shot example: original comment + creator's reply."""
    comment_text: str
    reply_text:   str


class IntentScore(BaseModel):
    label:      str
    confidence: float = Field(..., ge=0.0, le=1.0)


class ReplyRequest(BaseModel):
    comment_id:       str  = Field(..., description="MongoDB ObjectId of the comment")
    comment_text:     str  = Field(..., min_length=1, max_length=10_000)
    tone:             Literal[
        "friendly", "professional", "humorous", "promotional",
        "appreciative", "informative", "supportive", "apologetic", "neutral",
        "romantic", "rude", "crazy",
    ] = "friendly"
    persona_id:       Optional[str]  = None
    video_context:    Optional[str]  = Field(
        default="",
        description="Video title + description passed as a string for prompt context",
    )
    # ── New fields for enriched generation ────────────────────────────────────
    video_id:         Optional[str]  = Field(
        default=None,
        description="YouTube video ID — used to scope RAG retrieval to a specific video",
    )
    intents:          Optional[list[IntentScore]] = Field(
        default=None,
        description="Full multi-label intent scores from classification",
    )
    is_english:       Optional[bool] = Field(
        default=True,
        description="Whether the comment is in English (from language detection)",
    )
    creator_bio:      Optional[str]  = Field(
        default=None,
        description="The creator's bio / persona description for voice matching",
    )
    few_shot_examples: Optional[list[FewShotExample]] = Field(
        default=None,
        description="Matched PersonaExamples for few-shot prompt injection",
    )


class ReplyResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    comment_id:  str
    reply_text:  str
    tone:        str
    model_used:  str
    char_count:  int
