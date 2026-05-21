"""Strip HTML/CSS noise, truncate, and compress English filler before LLM prompts."""

from __future__ import annotations

import re

from app.services.stopword_compact import compact_english_for_llm


def clean_email_for_llm(raw_email_text: str, max_words: int = 1000) -> str:
    """
    Strips token-heavy formatting, truncates, then removes common English stop-words
    to reduce tokenizer output (Groq / Gemini) without changing meaning much for models.
    Default max_words=1000 is roughly 1,300 tokens before stop-word stripping.
    """
    if not raw_email_text:
        return ""

    # 1. Strip HTML tags (leaves the actual text and URLs intact)
    clean_text = re.sub(r"<[^>]+>", " ", raw_email_text)

    # 2. Remove inline CSS/Style blocks often found in corporate emails
    clean_text = re.sub(r"\{.*?\}", " ", clean_text)

    # 3. Normalize whitespace (compresses multiple spaces/newlines into one)
    clean_text = re.sub(r"\s+", " ", clean_text).strip()

    # 4. Truncate to save tokens
    words = clean_text.split()
    if len(words) > max_words:
        clean_text = " ".join(words[:max_words]) + " ... [TRUNCATED]"

    return compact_english_for_llm(clean_text)
