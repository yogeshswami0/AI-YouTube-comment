"""
app/pipeline/ingestion/text_cleaner.py

Cleans individual transcript segment texts before chunking.

What we clean:
  - HTML entities and tags (YouTube sometimes embeds <c> timing tags)
  - Music / sound effect annotations:  [Music], [Applause], (laughing)
  - Repeated filler words:             uh, um, hmm (standalone)
  - Excessive whitespace and newlines
  - Unicode control characters
  - Duplicate consecutive segments (auto-generated captions sometimes repeat)

What we deliberately DO NOT clean:
  - Punctuation (helps sentence boundary detection)
  - Numbers and timestamps spoken in text ("at 3:15 we covered...")
  - Non-English characters (bge-m3 handles multilingual text natively)
"""

import html
import re

from app.core.exceptions import TranscriptCleaningError
from app.core.logger import get_logger
from app.pipeline.ingestion.redis_reader import RawTranscript, TranscriptSegment

logger = get_logger(__name__)

# ── Compiled regex patterns (compiled once at module load) ────────────────────

# HTML tags like <c>, <00:00:01.000>, </c>
_RE_HTML_TAGS = re.compile(r"<[^>]+>")

# Annotation brackets: [Music], [Applause], [Laughter], (music), (applause)
_RE_ANNOTATIONS = re.compile(r"[\[\(][^\]\)]{1,30}[\]\)]", re.IGNORECASE)

# Standalone filler words (whole word only, case-insensitive)
_RE_FILLERS = re.compile(r"\b(uh+|um+|hmm+|uhh+|err+|ahh*)\b", re.IGNORECASE)

# Two or more consecutive whitespace characters (including newlines/tabs)
_RE_WHITESPACE = re.compile(r"\s{2,}")

# Unicode control characters (except newline \n which we handle separately)
_RE_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _clean_segment_text(text: str) -> str:
    """Apply all cleaning steps to a single segment's text."""
    # 1. Decode HTML entities first (&amp; → &, &#39; → ')
    text = html.unescape(text)

    # 2. Strip HTML / timing tags
    text = _RE_HTML_TAGS.sub("", text)

    # 3. Remove sound / music annotations
    text = _RE_ANNOTATIONS.sub("", text)

    # 4. Remove filler words
    text = _RE_FILLERS.sub("", text)

    # 5. Strip unicode control characters
    text = _RE_CONTROL.sub("", text)

    # 6. Collapse whitespace
    text = _RE_WHITESPACE.sub(" ", text)

    return text.strip()


def clean_transcript(transcript: RawTranscript) -> RawTranscript:
    """
    Cleans all segment texts in a RawTranscript and removes duplicates.

    Args:
        transcript: Raw transcript pulled from Redis.

    Returns:
        A new RawTranscript with cleaned segments.
        Segments that become empty after cleaning are dropped.

    Raises:
        TranscriptCleaningError: if cleaning produces zero usable segments.
    """
    cleaned_segments: list[TranscriptSegment] = []
    prev_text: str = ""

    for seg in transcript.segments:
        cleaned = _clean_segment_text(seg.text)

        # Drop empty segments
        if not cleaned:
            continue

        # Drop exact duplicate consecutive segments
        # (auto-generated captions often duplicate the previous line)
        if cleaned.lower() == prev_text.lower():
            continue

        cleaned_segments.append(TranscriptSegment(
            text=cleaned,
            start=seg.start,
            duration=seg.duration,
        ))
        prev_text = cleaned

    if not cleaned_segments:
        raise TranscriptCleaningError(
            message=f"Transcript for {transcript.video_id!r} produced zero segments after cleaning.",
            detail=f"Original segment count: {len(transcript.segments)}",
        )

    dropped = len(transcript.segments) - len(cleaned_segments)
    logger.info(
        "Transcript cleaned",
        video_id=transcript.video_id,
        original_segments=len(transcript.segments),
        cleaned_segments=len(cleaned_segments),
        dropped_segments=dropped,
    )

    return RawTranscript(
        video_id=transcript.video_id,
        segments=cleaned_segments,
        total_duration_seconds=transcript.total_duration_seconds,
    )