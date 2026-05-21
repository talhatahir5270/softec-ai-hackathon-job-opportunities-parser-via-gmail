"""Decode Gmail API `users.messages` payloads into plain text."""

from __future__ import annotations

import base64
import re
from html import unescape
from typing import Any


def _b64url_decode(data: str) -> bytes:
    padded = data + "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(padded.encode())


def _strip_html(html: str) -> str:
    without_blocks = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html)
    without_tags = re.sub(r"(?is)<[^>]+>", " ", without_blocks)
    return unescape(re.sub(r"\s+", " ", without_tags).strip())


def _collect_parts(part: dict[str, Any]) -> tuple[str | None, str | None]:
    mime = (part.get("mimeType") or "").lower()
    body = part.get("body") or {}
    raw = body.get("data")
    if raw and "text/plain" in mime:
        try:
            return _b64url_decode(raw).decode("utf-8", errors="replace"), None
        except (ValueError, UnicodeError):
            return None, None
    if raw and "text/html" in mime:
        try:
            return None, _b64url_decode(raw).decode("utf-8", errors="replace")
        except (ValueError, UnicodeError):
            return None, None

    plain: str | None = None
    html: str | None = None
    for sub in part.get("parts") or []:
        if not isinstance(sub, dict):
            continue
        p, h = _collect_parts(sub)
        plain = plain or p
        html = html or h
    return plain, html


def headers_map(payload: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for h in payload.get("headers") or []:
        if not isinstance(h, dict):
            continue
        name = str(h.get("name", "")).strip().lower()
        val = str(h.get("value", "")).strip()
        if name:
            out[name] = val
    return out


def payload_plain_text(payload: dict[str, Any]) -> str:
    plain, html = _collect_parts(payload)
    if plain and plain.strip():
        return plain.strip()
    if html and html.strip():
        return _strip_html(html)
    body = payload.get("body") or {}
    data = body.get("data")
    if data:
        try:
            return _b64url_decode(data).decode("utf-8", errors="replace").strip()
        except (ValueError, UnicodeError):
            return ""
    return ""


def message_plain_body(message: dict[str, Any]) -> str:
    payload = message.get("payload")
    if isinstance(payload, dict):
        return payload_plain_text(payload)
    return ""
