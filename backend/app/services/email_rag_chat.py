"""RAG answers over embedded inbox chunks using Groq chat."""

from __future__ import annotations

import asyncio
import ssl
from typing import Any

import certifi
import httpx
from openai import APIConnectionError, APIError, APIStatusError, AsyncOpenAI

from app.core.config import settings
from app.services.email_chunk_index import retrieve_chunks
from app.services.groq_categorize import build_groq_async_client, summarize_groq_status_error
from app.services.local_embeddings import embed_texts_sync
from app.services.stopword_compact import compact_english_for_llm

_SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())

_SYSTEM_INTRO = (
    "You help the user understand their email inbox. Answer using ONLY the email snippets below. "
    "If the answer is not contained there, say you cannot find it in the indexed emails. "
    "When you use a fact, cite the snippet number in brackets like [1]. Be concise."
)


def _last_user_text(messages: list[dict[str, str]]) -> str:
    for m in reversed(messages):
        if m.get("role") == "user":
            c = (m.get("content") or "").strip()
            if c:
                return c
    return (messages[-1].get("content") or "").strip()


def _clip(s: str, max_chars: int) -> str:
    s = (s or "").strip()
    if len(s) <= max_chars:
        return s
    return s[: max_chars - 20].rstrip() + "\n… [trimmed]"


def _rag_markers(rag_blob: str) -> str:
    return f"{_SYSTEM_INTRO}\n\n--- BEGIN EMAIL SNIPPETS ---\n{rag_blob}\n--- END EMAIL SNIPPETS ---"


def _messages_char_total(msgs: list[dict[str, Any]]) -> int:
    return sum(len(str(m.get("content") or "")) for m in msgs)


def _fit_groq_chat_payload(
    rag_blob: str,
    history: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Shrink RAG context and/or drop oldest turns until under GROQ_RAG_MAX_INPUT_CHARS."""
    budget = max(2_000, int(settings.GROQ_RAG_MAX_INPUT_CHARS))
    rag = rag_blob
    hist = list(history)

    while True:
        system_content = _rag_markers(rag)
        out: list[dict[str, Any]] = [{"role": "system", "content": system_content}]
        out.extend(hist)
        total = _messages_char_total(out)
        if total <= budget:
            return out
        if len(rag) > 800:
            rag = rag[: int(len(rag) * 0.75)].rstrip() + "\n\n[Context shortened for API limits.]"
            continue
        if len(hist) > 2:
            hist = hist[2:]  # drop oldest user+assistant pair
            continue
        hist = [{"role": h["role"], "content": _clip(str(h.get("content") or ""), 400)} for h in hist]
        rag = rag[:400] if rag else rag
        if _messages_char_total([{"role": "system", "content": _rag_markers(rag)}] + hist) <= budget:
            return [{"role": "system", "content": _rag_markers(rag)}] + hist
        return [{"role": "system", "content": _rag_markers("[Snippets omitted: context too large.]")}] + hist[-2:]


async def answer_with_email_rag(owner_key: str, messages: list[dict[str, str]]) -> str:
    if not (settings.GROQ_API_KEY or "").strip():
        raise RuntimeError("GROQ_API_KEY is not configured (required for the chat reply).")

    query = compact_english_for_llm(_last_user_text(messages))
    if not query:
        raise RuntimeError("Missing user message text.")

    vectors, _emb_model = await asyncio.to_thread(lambda: embed_texts_sync([query], is_query=True))
    if not vectors:
        raise RuntimeError("Failed to embed the question.")
    query_vec = vectors[0]

    top_k = max(1, min(20, int(settings.GROQ_RAG_TOP_K)))
    snippet_chars = max(200, min(4000, int(settings.GROQ_RAG_SNIPPET_BODY_CHARS)))

    chunks = retrieve_chunks(owner_key, query_vec, top_k=top_k)
    if not chunks:
        return (
            "I do not have any indexed emails for this session yet. "
            "Open the Inbox page so your messages can be embedded, or connect Gmail and refresh the inbox."
        )

    excerpt_lines: list[str] = []
    for i, c in enumerate(chunks, start=1):
        subj_raw = str(c.get("subject") or "")
        subj = compact_english_for_llm(subj_raw) or subj_raw
        frm = str(c.get("from") or "")
        dt = str(c.get("date") or "")
        body = compact_english_for_llm(_clip(str(c.get("text") or ""), snippet_chars))
        excerpt_lines.append(f"### Snippet [{i}]\nFrom: {frm}\nSubject: {subj}\nDate: {dt}\n{body}")

    rag_blob = "\n\n".join(excerpt_lines)

    max_hist = max(2, min(40, int(settings.GROQ_RAG_MAX_HISTORY_MESSAGES)))
    max_msg = max(200, min(4000, int(settings.GROQ_RAG_MAX_MESSAGE_CHARS)))

    hist_raw: list[dict[str, Any]] = []
    for m in messages:
        role = m.get("role")
        content = (m.get("content") or "").strip()
        if role == "system" or role not in ("user", "assistant") or not content:
            continue
        hist_raw.append({"role": role, "content": _clip(compact_english_for_llm(content), max_msg)})
    hist_trimmed = hist_raw[-max_hist:] if len(hist_raw) > max_hist else hist_raw

    openai_messages = _fit_groq_chat_payload(rag_blob, hist_trimmed)

    verify: bool | str | ssl.SSLContext = _SSL_CONTEXT
    if not settings.GROQ_VERIFY_SSL:
        verify = False
    elif settings.GROQ_CA_BUNDLE.strip():
        verify = settings.GROQ_CA_BUNDLE.strip()

    max_out = max(128, min(2048, int(settings.GROQ_RAG_MAX_COMPLETION_TOKENS)))

    async def _call(verify_value: bool | str | ssl.SSLContext) -> str:
        client = build_groq_async_client(verify=verify_value)
        try:
            resp = await client.chat.completions.create(
                model=settings.GROQ_MODEL,
                temperature=0.3,
                max_tokens=max_out,
                messages=openai_messages,
            )
            choice = resp.choices[0].message.content
            if isinstance(choice, str) and choice.strip():
                return choice.strip()
            return "I could not generate a text reply."
        finally:
            await client.close()

    try:
        return await _call(verify)
    except APIConnectionError as exc:
        if "CERTIFICATE_VERIFY_FAILED" in str(exc):
            return await _call(False)
        raise RuntimeError(f"Groq request failed: {exc}") from exc
    except APIStatusError as exc:
        raise RuntimeError(summarize_groq_status_error(exc)) from exc
    except APIError as exc:
        raise RuntimeError(f"Groq request failed: {exc}") from exc
