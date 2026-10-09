"""
app/services/generate.py

Reply generation service with conditional RAG retrieval and enriched prompt assembly.

Flow:
  1. Determine if RAG is needed (English + question confidence > threshold, or non-English)
  2. If RAG needed → call RAG service for video context chunks
  3. Assemble the full system prompt:
     - system_base.txt + tone-specific prompt
     - Creator bio (if provided)
     - Few-shot examples (if provided)
     - Video context from RAG (if fetched)
     - Anti-spam guard for non-English comments
  4. Call Gemma via HuggingFace Inference API
  5. Handle [SPAM_DETECTED] sentinel from non-English spam
"""

import os
from pathlib import Path

from openai import AsyncOpenAI

from app.schemas.reply import ReplyRequest, ReplyResponse
from app.services.rag_client import fetch_video_context
from app.core.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
logger = get_logger(__name__)

# ── Initialise the HuggingFace-compatible OpenAI client ──────────────────────
client = AsyncOpenAI(
    base_url="https://router.huggingface.co/v1",
    api_key=settings.HF_TOKEN or os.getenv("HF_TOKEN", ""),
)

MODEL_NAME = "google/gemma-4-31B-it:novita"

# ── Prompt directory ─────────────────────────────────────────────────────────
PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def load_prompt_template(filename: str) -> str:
    """Load a text file from the prompts directory."""
    filepath = PROMPTS_DIR / filename
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        logger.warning(f"Prompt file not found: {filename}")
        return ""


def _should_use_rag(request: ReplyRequest) -> bool:
    """
    Decide whether RAG retrieval is needed.

    Rules:
      - Non-English comments → always RAG (+ anti-spam prompt for Gemma)
      - English + question intent confidence > threshold → RAG
      - Otherwise → no RAG
    """
    # Non-English → always RAG
    if request.is_english is False:
        return True

    # English: check if question intent is above threshold
    if request.intents:
        for intent in request.intents:
            if intent.label == "question" and intent.confidence > settings.QUESTION_CONFIDENCE_THRESHOLD:
                return True

    return False


def _build_few_shot_block(examples: list) -> str:
    """Format few-shot examples into a prompt section."""
    if not examples:
        return ""

    lines = ["[FEW-SHOT EXAMPLES — Match this style closely]"]
    for i, ex in enumerate(examples, 1):
        lines.append(f"Example {i}:")
        lines.append(f"  Comment: {ex.comment_text}")
        lines.append(f"  Reply: {ex.reply_text}")
        lines.append("")

    return "\n".join(lines)


async def generate_reply_service(request: ReplyRequest) -> ReplyResponse:
    """
    Constructs the enriched prompt and calls the Gemma API.
    """

    # ── 1. Load base and tone prompts ────────────────────────────────────────
    system_base = load_prompt_template("system_base.txt")
    tone_filename = f"tone_{request.tone}.txt"
    tone_instructions = load_prompt_template(tone_filename)

    system_content = f"{system_base}\n\n{tone_instructions}"

    # ── 2. Creator bio (persona voice) ───────────────────────────────────────
    if request.creator_bio:
        system_content += (
            f"\n\n[CREATOR BIO — Match this voice]\n{request.creator_bio}"
        )

    # ── 3. Few-shot examples ─────────────────────────────────────────────────
    if request.few_shot_examples:
        few_shot_block = _build_few_shot_block(request.few_shot_examples)
        if few_shot_block:
            system_content += f"\n\n{few_shot_block}"

    # ── 4. Conditional RAG retrieval ─────────────────────────────────────────
    rag_context = None
    if _should_use_rag(request):
        logger.info(
            "RAG retrieval triggered",
            comment_id=request.comment_id,
            is_english=request.is_english,
            video_id=request.video_id,
        )
        rag_context = await fetch_video_context(
            question=request.comment_text,
            video_id=request.video_id,
        )

    # Add video context (RAG chunks or fallback to basic video_context)
    if rag_context:
        system_content += (
            f"\n\n[VIDEO TRANSCRIPT CONTEXT — Use this to answer the question accurately]\n"
            f"{rag_context}"
        )
    elif request.video_context:
        system_content += f"\n\n[CONTEXT ABOUT THE VIDEO]\n{request.video_context}"

    # ── 5. Non-English anti-spam guard ───────────────────────────────────────
    if request.is_english is False:
        non_english_guard = load_prompt_template("non_english_guard.txt")
        if non_english_guard:
            system_content += f"\n\n{non_english_guard}"

    # ── 6. Final instruction ─────────────────────────────────────────────────
    system_content += (
        "\n\nCRITICAL INSTRUCTION: Provide ONLY the final text of the reply. "
        "Do not include quotes, conversational filler, or internal thoughts."
    )

    # ── 7. Format user message ───────────────────────────────────────────────
    user_content = (
        f"Generate a reply to this YouTube comment:\n\n"
        f"[COMMENT]\n{request.comment_text}"
    )

    # ── 8. Call the LLM ──────────────────────────────────────────────────────
    try:
        response = await client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": system_content},
                {"role": "user", "content": user_content},
            ],
            max_tokens=250,
            temperature=0.7,
        )

        reply_text = response.choices[0].message.content.strip()

        # Handle non-English spam sentinel
        if "[SPAM_DETECTED]" in reply_text:
            logger.info(
                "Gemma detected non-English spam",
                comment_id=request.comment_id,
            )
            return ReplyResponse(
                comment_id=request.comment_id,
                reply_text="[SPAM_DETECTED]",
                tone=request.tone,
                model_used=MODEL_NAME,
                char_count=0,
            )

        return ReplyResponse(
            comment_id=request.comment_id,
            reply_text=reply_text,
            tone=request.tone,
            model_used=MODEL_NAME,
            char_count=len(reply_text),
        )

    except Exception as e:
        logger.error(f"LLM generation error: {e}", exc_info=True)
        fallback_text = "Thank you for your comment! We appreciate your feedback."
        return ReplyResponse(
            comment_id=request.comment_id,
            reply_text=fallback_text,
            tone=request.tone,
            model_used="error-fallback",
            char_count=len(fallback_text),
        )