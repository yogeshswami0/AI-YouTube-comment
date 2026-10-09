"""
app/services/classify_service.py

Full classification pipeline:
  1. SpamGatekeeper (4-layer fast filter)
  2. Language detection
  3. ML intent classification (English only)
  4. Routing decision
"""

from transformers import pipeline as hf_pipeline
import os

from app.schemas.comment import CommentIn
from app.services.spam_gatekeeper import gatekeeper
from app.services.language_detector import detect_language
from app.core.logging import get_logger

logger = get_logger(__name__)

# ── Load the fine-tuned intent classifier once (singleton) ────────────────────
HF_REPO_ID = os.getenv("HF_REPO_ID")
HF_CLASSIFIER_TOKEN = os.getenv("HF_CLASSIFIER_TOKEN")

if HF_REPO_ID:
    MODEL_PATH = HF_REPO_ID
    logger.info("Using Hugging Face model", repo_id=HF_REPO_ID)
else:
    MODEL_PATH = os.path.join(os.path.dirname(__file__), "../model_files")
    logger.info("Using local model", model_path=MODEL_PATH)

try:
    classifier = hf_pipeline(
        "text-classification", 
        model=MODEL_PATH, 
        tokenizer=MODEL_PATH,
        token=HF_CLASSIFIER_TOKEN
    )
    logger.info("Intent classifier loaded successfully", model_path=MODEL_PATH)
except Exception as e:
    classifier = None
    logger.error("Could not load intent classifier", error=str(e))

ALLOWED_INTENTS = ["spam", "praise", "criticism", "neutral", "question"]


def _run_ml_classifier(text: str) -> dict:
    """Run the ML classifier and return structured intent data."""
    if classifier:
        results = classifier(text, top_k=None)
        intents = [
            {"label": r["label"].lower(), "confidence": round(r["score"], 4)}
            for r in results
            if r["label"].lower() in ALLOWED_INTENTS
        ]
    else:
        intents = [{"label": "neutral", "confidence": 0.99}]

    intents.sort(key=lambda x: x["confidence"], reverse=True)
    primary = intents[0] if intents else {"label": "neutral", "confidence": 0.0}

    return {
        "intent": primary["label"],
        "confidence": primary["confidence"],
        "intents": intents,
    }


def _determine_routing(intent: str, is_spam: bool) -> str:
    """Decide the next step for the comment."""
    if is_spam:
        return "discard"
    return "generate"


async def classify_comment(comment: CommentIn) -> dict:
    """
    Full classification pipeline.

    1. SpamGatekeeper: fast structural/pattern checks + Redis dedup
    2. Language detection via langdetect
    3. ML classification (English only)
    4. Routing decision

    For non-English comments:
      - Skip ML classification
      - Return routing="generate" with is_english=False
      - The generate endpoint will handle RAG + anti-spam prompt for Gemma
    """
    video_id = comment.video_id or ""

    # ── Step 1: Spam Gatekeeper ──────────────────────────────────────────────
    gate_spam, gate_reason = await gatekeeper.check_comment(video_id, comment.text)

    if gate_spam:
        logger.info(
            "Spam caught by gatekeeper",
            comment_id=comment.comment_id,
            reason=gate_reason,
        )
        return {
            "comment_id": comment.comment_id,
            "intent": "spam",
            "confidence": 1.0,
            "intents": [{"label": "spam", "confidence": 1.0}],
            "is_spam": True,
            "spam_score": 1.0,
            "routing": "discard",
            "language": None,
            "is_english": None,
        }

    # ── Step 2: Language Detection ───────────────────────────────────────────
    language, is_english = detect_language(comment.text)

    # ── Step 3: ML Classification (English only) ─────────────────────────────
    if not is_english:
        logger.info(
            "Non-English comment, skipping ML classification",
            comment_id=comment.comment_id,
            language=language,
        )
        return {
            "comment_id": comment.comment_id,
            "intent": "neutral",
            "confidence": 0.0,
            "intents": [],
            "is_spam": False,
            "spam_score": 0.0,
            "routing": "generate",
            "language": language,
            "is_english": False,
        }

    # English comment → run the ML classifier
    intent_data = _run_ml_classifier(comment.text)
    intent = intent_data["intent"]
    intents = intent_data["intents"]

    # Determine spam from ML classifier
    if intent == "spam":
        is_spam = True
        spam_score = max(0.8, intent_data["confidence"])
    else:
        is_spam = False
        spam_score = 0.0

    routing = _determine_routing(intent, is_spam)

    logger.info(
        "Classification complete",
        comment_id=comment.comment_id,
        intent=intent,
        confidence=intent_data["confidence"],
        is_spam=is_spam,
        routing=routing,
        language=language,
    )

    return {
        "comment_id": comment.comment_id,
        "intent": intent,
        "confidence": intent_data["confidence"],
        "intents": intents,
        "is_spam": is_spam,
        "spam_score": spam_score,
        "routing": routing,
        "language": language,
        "is_english": True,
    }