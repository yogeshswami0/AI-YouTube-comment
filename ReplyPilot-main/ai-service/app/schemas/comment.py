from pydantic import BaseModel, Field
from typing import Literal, Optional


class CommentIn(BaseModel):
    comment_id: str = Field(..., description="MongoDB ObjectId of the comment")
    text:       str = Field(..., min_length=1, max_length=10_000)
    video_id:   Optional[str] = Field(
        default=None,
        description="YouTube video ID — used by the spam gatekeeper for bot-swarm dedup",
    )


class IntentScore(BaseModel):
    label:      str
    confidence: float = Field(..., ge=0.0, le=1.0)


class CommentOut(BaseModel):
    comment_id:   str
    intent:       Literal["spam", "praise", "criticism", "neutral", "question"]
    confidence:   float = Field(..., ge=0.0, le=1.0)
    intents:      list[IntentScore] = Field(default_factory=list, description="All intents with confidence scores")
    is_spam:      bool
    # spam_score is separate from intent confidence —
    # a comment can be "criticism" with high confidence but still flagged spam
    spam_score:   float = Field(..., ge=0.0, le=1.0)
    # routing tells the caller what to do next
    routing:      Literal["generate", "review", "discard"]
    # Language detection results
    language:     Optional[str] = Field(default=None, description="ISO 639-1 language code")
    is_english:   Optional[bool] = Field(default=None, description="Whether the comment is in English")


class BatchCommentIn(BaseModel):
    items: list[CommentIn] = Field(..., min_length=1, max_length=100)


class BatchCommentOut(BaseModel):
    results: list[CommentOut]
    total:   int
    spam:    int
    valid:   int
