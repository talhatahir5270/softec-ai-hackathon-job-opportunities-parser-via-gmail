"""Remove common English stop-words to shrink LLM / embedding payloads (no NLTK dependency)."""

from __future__ import annotations

import re

# Snowball English stemmer stopword list + frequent contractions (lowercase lookup keys).
_ENGLISH_STOPWORDS: frozenset[str] = frozenset(
    {
        "a",
        "about",
        "above",
        "after",
        "again",
        "against",
        "all",
        "am",
        "an",
        "and",
        "any",
        "are",
        "aren't",
        "as",
        "at",
        "be",
        "because",
        "been",
        "before",
        "being",
        "below",
        "between",
        "both",
        "but",
        "by",
        "can't",
        "cannot",
        "could",
        "couldn't",
        "did",
        "didn't",
        "do",
        "does",
        "doesn't",
        "doing",
        "don't",
        "down",
        "during",
        "each",
        "few",
        "for",
        "from",
        "further",
        "had",
        "hadn't",
        "has",
        "hasn't",
        "have",
        "haven't",
        "having",
        "he",
        "he'd",
        "he'll",
        "he's",
        "her",
        "here",
        "here's",
        "hers",
        "herself",
        "him",
        "himself",
        "his",
        "how",
        "how's",
        "i",
        "i'd",
        "i'll",
        "i'm",
        "i've",
        "if",
        "in",
        "into",
        "is",
        "isn't",
        "it",
        "it's",
        "its",
        "itself",
        "let's",
        "me",
        "more",
        "most",
        "mustn't",
        "my",
        "myself",
        "no",
        "nor",
        "not",
        "of",
        "off",
        "on",
        "once",
        "only",
        "or",
        "other",
        "ought",
        "our",
        "ours",
        "ourselves",
        "out",
        "over",
        "own",
        "same",
        "shan't",
        "she",
        "she'd",
        "she'll",
        "she's",
        "should",
        "shouldn't",
        "so",
        "some",
        "such",
        "than",
        "that",
        "that's",
        "the",
        "their",
        "theirs",
        "them",
        "themselves",
        "then",
        "there",
        "there's",
        "these",
        "they",
        "they'd",
        "they'll",
        "they're",
        "they've",
        "this",
        "those",
        "through",
        "to",
        "too",
        "under",
        "until",
        "up",
        "very",
        "was",
        "wasn't",
        "we",
        "we'd",
        "we'll",
        "we're",
        "we've",
        "were",
        "weren't",
        "what",
        "what's",
        "when",
        "when's",
        "where",
        "where's",
        "which",
        "while",
        "who",
        "who's",
        "whom",
        "why",
        "why's",
        "with",
        "won't",
        "would",
        "wouldn't",
        "you",
        "you'd",
        "you'll",
        "you're",
        "you've",
        "your",
        "yours",
        "yourself",
        "yourselves",
        # email / marketing fluff often safe to drop for opportunity extraction
        "please",
        "kindly",
        "regards",
        "best",
        "thanks",
        "thank",
        "hello",
        "hi",
        "dear",
        "sincerely",
        "unsubscribe",
        "click",
        "herein",
        "whereupon",
        "viz",
        "vs",
        "via",
    }
)

_lookup_strip = re.compile(r"^[^\w]+|[^\w]+$", re.UNICODE)


def _lookup_token(raw: str) -> str:
    """Lowercase lemma used only to test membership in the stopword set."""
    s = _lookup_strip.sub("", raw)
    if not s:
        return ""
    return s.lower()


def compact_english_for_llm(text: str) -> str:
    """
    Drop common English grammatical stop-words; keeps original token spelling for non-stop words.

    Intended for long email bodies, RAG snippets, and CV text before LLM / embedding calls.
    If removal would empty the string, returns a short slice of the original so callers never
    send an empty payload by accident.
    """
    if not text or not str(text).strip():
        return text or ""

    raw_in = str(text)
    tokens = raw_in.split()
    kept: list[str] = []
    for tok in tokens:
        key = _lookup_token(tok)
        if not key:
            continue
        if key in _ENGLISH_STOPWORDS:
            continue
        kept.append(tok)

    if not kept:
        return raw_in[:800].strip()

    out = " ".join(kept)
    return re.sub(r"\s+", " ", out).strip()
