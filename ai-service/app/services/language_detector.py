"""
app/services/language_detector.py

Lightweight language detection using the ``langdetect`` library.
Returns a language code and a boolean indicating whether the text is English.
"""

from langdetect import detect_langs, LangDetectException
from app.core.logging import get_logger

logger = get_logger(__name__)


import re

def detect_language(text: str) -> tuple[str, bool]:
    """
    Detect the language of the given text with special handling for short internet comments.

    Returns:
        (primary_language_code, is_english_bool)
    """
    if not text:
        return "en", True

    text_clean = text.strip()
    
    # Strip emojis and weird punctuation which break langdetect
    text_alpha = re.sub(r'[^\w\s]', '', text_clean).strip()

    # langdetect is completely unreliable for strings under ~30-40 chars. 
    # It misclassifies "Very funny..😂😂" as Welsh (cy) or Norwegian (no).
    # Since Gemma can handle any language natively for reply generation, 
    # defaulting short comments to English ensures they don't skip the ML intent classifier!
    if len(text_alpha) < 40:
        return "en", True

    try:
        langs = detect_langs(text_clean)
        
        # Check if English is detected with a decent probability (> 0.2)
        is_english = False
        primary_lang = langs[0].lang
        
        for lang in langs:
            if lang.lang == "en" and lang.prob > 0.2:
                is_english = True
                primary_lang = "en"
                break
                
        # If the primary is 'en', override it
        if primary_lang == "en":
            is_english = True
            
        logger.debug(
            "Language detected",
            primary=primary_lang,
            is_english=is_english,
            langs=[f"{l.lang}:{l.prob:.2f}" for l in langs]
        )
        return primary_lang, is_english
    except LangDetectException as e:
        logger.warning(f"Language detection failed, defaulting to English: {str(e)}")
        return "en", True
