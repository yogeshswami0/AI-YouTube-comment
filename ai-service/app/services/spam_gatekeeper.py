"""
app/services/spam_gatekeeper.py

Multi-layered spam filter with short-circuit evaluation.
Rejects obvious spam in microseconds before the comment reaches
the ML classifier or LLM, saving compute and API cost.

Layers (cheapest → most expensive):
  1. O(1) quick rejections (length, zero-intent phrases, AI leaks)
  2. Regex pattern matching (URLs, phone numbers, repeating chars)
  3. Obfuscation defeat + mathematical analysis (entropy, vowel ratio)
  4. Stateful bot-swarm detection via Redis SET NX
"""

import re
import math
import hashlib
import unicodedata
from collections import Counter
from typing import Tuple

import redis.asyncio as aioredis

from app.core.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
logger = get_logger(__name__)


class SpamGatekeeper:
    """
    A highly optimised, multi-layered spam filter.
    Uses short-circuit evaluation to reject obvious spam in microseconds
    before falling back to mathematical analysis and Redis caching.
    """

    def __init__(self) -> None:
        # ── Compile regexes once at startup ───────────────────────────────────
        self.url_pattern = re.compile(
            r"(?:https?://|www\.)[^\s]+|"
            r"[a-zA-Z0-9-]+\s?(?:dot|\.)\s?(?:com|net|org|xyz|ly|me|io|co)",
            re.IGNORECASE,
        )
        self.phone_pattern = re.compile(r"(?:\+?\d{1,3}[\s\-.\(\)]?){4,}")
        self.repeat_char_pattern = re.compile(r"(.)\1{9,}")
        self.emoji_spam_pattern = re.compile(
            r"[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF"
            r"\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF"
            r"\U00002702-\U000027B0\U0000FE00-\U0000FE0F]{10,}"
        )

        # ── Fast-lookup Sets (O(1)) ──────────────────────────────────────────
        self.crypto_keywords = frozenset({
            "whatsapp", "telegram", "inbox me", "dm me", "binance",
            "forex", "invest with", "crypto", "bitcoin", "earn money",
            "make money", "profit guaranteed", "trade with me",
        })
        self.zero_intent_phrases = frozenset({
            "first", "early", "sub4sub", "sub to my",
            "check out my channel", "who is watching in",
            "like if you agree", "anyone watching in",
        })
        self.ai_slips = frozenset({
            "as an ai", "i cannot fulfill", "sure, here is",
            "language model", "i'm an ai",
        })

        # ── Redis connection pool (lazy) ─────────────────────────────────────
        self._redis_pool: aioredis.Redis | None = None

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _normalize_text(self, text: str) -> str:
        """Strip zero-width characters and normalise homoglyphs."""
        text = re.sub(r"[\u200B-\u200D\uFEFF]", "", text)
        return (
            unicodedata.normalize("NFKD", text)
            .encode("ASCII", "ignore")
            .decode("utf-8")
            .lower()
        )

    @staticmethod
    def _shannon_entropy(text: str) -> float:
        """Shannon entropy to detect keyboard smashes / random strings."""
        if not text:
            return 0.0
        counts = Counter(text)
        length = len(text)
        return -sum(
            (count / length) * math.log2(count / length)
            for count in counts.values()
        )

    async def _get_redis(self) -> aioredis.Redis:
        if self._redis_pool is None:
            self._redis_pool = aioredis.from_url(
                settings.redis_url,
                decode_responses=True,
                socket_connect_timeout=3,
                socket_timeout=3,
            )
        return self._redis_pool

    # ── Main pipeline ─────────────────────────────────────────────────────────

    async def check_comment(
        self, video_id: str, comment_text: str
    ) -> Tuple[bool, str]:
        """
        Returns ``(is_spam, reason)``.
        Executes layers from cheapest to most expensive, short-circuiting
        as soon as spam is detected.
        """
        raw_text = comment_text.strip()

        # ── LAYER 1: O(1) Quick Rejections ───────────────────────────────────
        if len(raw_text) < 2:
            return True, "too_short"

        lower_text = raw_text.lower()

        if lower_text in self.zero_intent_phrases:
            return True, "zero_intent"

        if any(slip in lower_text for slip in self.ai_slips):
            return True, "ai_prompt_leakage"

        # ── LAYER 2: Regex & Pattern Matching ────────────────────────────────
        if self.url_pattern.search(lower_text):
            return True, "contains_url"

        if self.repeat_char_pattern.search(lower_text):
            return True, "repeating_characters"

        if self.emoji_spam_pattern.search(raw_text):
            return True, "emoji_spam"

        # Crypto/scam heuristic: phone number + messaging keyword
        if self.phone_pattern.search(lower_text) and any(
            kw in lower_text for kw in self.crypto_keywords
        ):
            return True, "crypto_scam"

        # ── LAYER 3: Obfuscation Defeat & Math ──────────────────────────────
        norm_text = self._normalize_text(raw_text)

        # Re-check scam keywords against cleaned text (zero-width bypass)
        if any(kw in norm_text for kw in self.crypto_keywords):
            return True, "obfuscated_scam_keyword"

        alpha_only = re.sub(r"[^a-z]", "", norm_text)
        alpha_len = len(alpha_only)
        total_len = len(norm_text)

        if total_len > 15:
            # High symbol ratio (ASCII art, severe obfuscation)
            alphanumeric_len = len(re.sub(r"[^a-z0-9]", "", norm_text))
            if (alphanumeric_len / total_len) < 0.4:
                return True, "high_symbol_ratio"

            if alpha_len > 5:
                # Vowel starvation (catches "hjksdfghjk")
                vowel_count = len(re.findall(r"[aeiouy]", alpha_only))
                if (vowel_count / alpha_len) < 0.08:
                    return True, "vowel_starvation"

                # Shannon entropy bounds
                entropy = self._shannon_entropy(alpha_only)
                if entropy < 1.5 or entropy > 5.2:
                    return True, "entropy_anomaly"

        # ── LAYER 4: Stateful Bot Swarm Detection (Redis) ────────────────────
        if video_id:
            is_duplicate = await self._is_recent_duplicate(video_id, norm_text)
            if is_duplicate:
                return True, "bot_swarm_duplicate"

        return False, "clean"

    async def _is_recent_duplicate(
        self, video_id: str, normalized_text: str
    ) -> bool:
        """
        SET NX in Redis with 1-hour TTL.
        If the exact text was already posted on this video → duplicate bot.
        """
        text_hash = hashlib.sha256(normalized_text.encode("utf-8")).hexdigest()
        cache_key = f"spam_cache:{video_id}:{text_hash}"

        try:
            client = await self._get_redis()
            is_new = await client.set(cache_key, "1", nx=True, ex=3600)
            return not is_new
        except Exception as e:
            # Fail open: if Redis is down, don't block legitimate comments
            logger.warning("Redis duplicate check failed, failing open", error=str(e))
            return False


# Singleton
gatekeeper = SpamGatekeeper()
