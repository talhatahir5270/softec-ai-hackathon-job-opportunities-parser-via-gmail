"""Keep evidence_quotes honest: only substrings that actually appear in the email body."""

from __future__ import annotations


def filter_evidence_quotes_to_body(
    body: str,
    quotes: list[str],
    *,
    max_quotes: int = 8,
    max_len: int = 500,
) -> list[str]:
    if not body or not quotes:
        return []
    out: list[str] = []
    for raw in quotes:
        s = (raw or "").strip()
        if len(s) < 3:
            continue
        if len(s) > max_len:
            s = s[:max_len]
        if s in body and s not in out:
            out.append(s)
        if len(out) >= max_quotes:
            break
    return out
