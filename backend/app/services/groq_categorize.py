"""Email categorization via Groq (OpenAI-compatible Chat Completions API)."""

import json
import ssl
from typing import Any

import certifi
import httpx
from openai import APIConnectionError, APIError, APIStatusError, AsyncOpenAI
from pydantic import ValidationError

from app.core.config import settings
from app.schemas.email import (
    BatchCategorizeResponse,
    EmailCategorizationItem,
    EmailRecord,
)
from app.schemas.student import StudentProfileCreate
from app.services.categorize_prompt import build_categorization_messages, parse_optional_string_list
from app.services.evidence_quotes import filter_evidence_quotes_to_body

_SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())


def parse_chat_json_payload(content: str) -> dict[str, Any]:
    stripped = content.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        return json.loads(stripped[start : end + 1])


def extract_chat_message_content(data: dict[str, Any]) -> str:
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Unexpected Groq response shape") from exc

    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                txt = part.get("text")
                if isinstance(txt, str):
                    parts.append(txt)
        if parts:
            return "\n".join(parts)
    raise RuntimeError("Groq returned non-text content")


def summarize_groq_status_error(exc: APIStatusError) -> str:
    status_code = getattr(exc, "status_code", None)
    body = ""
    response = getattr(exc, "response", None)
    if response is not None:
        try:
            body = response.text or ""
        except Exception:  # noqa: BLE001
            body = ""

    lowered = body.lower()
    if "fortiguard" in lowered or "urlfilter block" in lowered or "web page blocked" in lowered:
        return (
            "Groq is blocked by local/network filtering. "
            "Allowlist https://api.groq.com or use an unfiltered network."
        )

    if body:
        clean = " ".join(body.split())
        if len(clean) > 300:
            clean = f"{clean[:300]}..."
        return f"Groq HTTP {status_code}: {clean}"
    return f"Groq HTTP {status_code}: request rejected by upstream."


def build_groq_async_client(*, verify: bool | str | ssl.SSLContext) -> AsyncOpenAI:
    base = settings.GROQ_BASE_URL.strip().rstrip("/")
    http_client = httpx.AsyncClient(timeout=120.0, verify=verify)
    return AsyncOpenAI(
        api_key=settings.GROQ_API_KEY,
        base_url=base,
        http_client=http_client,
    )


async def categorize_emails_with_groq(
    student: StudentProfileCreate,
    emails: list[EmailRecord],
) -> BatchCategorizeResponse:
    if not settings.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not configured")

    messages = build_categorization_messages(student, emails)
    verify: bool | str | ssl.SSLContext = _SSL_CONTEXT
    if not settings.GROQ_VERIFY_SSL:
        verify = False
    elif settings.GROQ_CA_BUNDLE.strip():
        verify = settings.GROQ_CA_BUNDLE.strip()

    async def _call(verify_value: bool | str | ssl.SSLContext) -> dict[str, Any]:
        client = build_groq_async_client(verify=verify_value)
        try:
            resp = await client.chat.completions.create(
                model=settings.GROQ_MODEL,
                temperature=0.2,
                response_format={"type": "json_object"},
                messages=messages,
            )
            return resp.model_dump(mode="json")
        finally:
            await client.close()

    try:
        data = await _call(verify)
    except APIConnectionError as exc:
        if "CERTIFICATE_VERIFY_FAILED" in str(exc):
            try:
                data = await _call(False)
            except (APIConnectionError, APIStatusError, APIError) as inner_exc:
                raise RuntimeError(f"Groq request failed: {inner_exc}") from inner_exc
        else:
            raise RuntimeError(f"Groq request failed: {exc}") from exc
    except APIStatusError as exc:
        raise RuntimeError(summarize_groq_status_error(exc)) from exc
    except APIError as exc:
        raise RuntimeError(f"Groq request failed: {exc}") from exc

    message = extract_chat_message_content(data)
    try:
        parsed = parse_chat_json_payload(message)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Failed to parse Groq JSON payload: {exc}") from exc
    raw_items = parsed.get("items")
    if not isinstance(raw_items, list):
        raise RuntimeError("Groq JSON missing 'items' array")

    items: list[EmailCategorizationItem] = []
    for row in raw_items:
        try:
            items.append(EmailCategorizationItem.model_validate(row))
        except ValidationError as exc:
            raise RuntimeError(f"Invalid categorization row: {row}") from exc

    ids_expected = {e.id for e in emails}
    ids_got = {i.email_id for i in items}
    if ids_expected != ids_got:
        missing = ids_expected - ids_got
        extra = ids_got - ids_expected
        raise RuntimeError(f"ID mismatch after Groq parse. missing={missing!r} extra={extra!r}")

    by_id = {i.email_id: i for i in items}
    ordered: list[EmailCategorizationItem] = []
    for e in emails:
        it = by_id[e.id]
        filtered_eq = filter_evidence_quotes_to_body(e.body, list(it.evidence_quotes))
        if filtered_eq != list(it.evidence_quotes):
            it = it.model_copy(update={"evidence_quotes": filtered_eq})
        ordered.append(it)

    batch_suggestions = parse_optional_string_list(parsed.get("batch_suggestions"))
    return BatchCategorizeResponse(
        items=ordered,
        model=settings.GROQ_MODEL,
        batch_suggestions=batch_suggestions,
    )
