import json
from typing import Any

import httpx
from pydantic import ValidationError

from app.core.config import settings
from app.schemas.email import (
    BatchCategorizeResponse,
    EmailCategorizationItem,
    EmailRecord,
)
from app.schemas.student import StudentProfileCreate
from app.services.categorize_prompt import (
    SYSTEM_PROMPT,
    build_categorization_user_content,
    parse_optional_string_list,
)
from app.services.evidence_quotes import filter_evidence_quotes_to_body

GEMINI_GENERATE_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def _parse_model_json(content: str) -> dict[str, Any]:
    stripped = content.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        return json.loads(stripped[start : end + 1])


def _extract_gemini_text(data: dict[str, Any]) -> str:
    feedback = data.get("promptFeedback")
    if isinstance(feedback, dict) and feedback.get("blockReason"):
        raise RuntimeError(f"Gemini blocked the prompt: {feedback.get('blockReason')}")
    try:
        candidates = data["candidates"]
        cand0 = candidates[0]
        parts = cand0["content"]["parts"]
        texts = [p["text"] for p in parts if isinstance(p, dict) and "text" in p]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Unexpected Gemini response shape") from exc
    if not texts:
        fr = None
        try:
            fr = data["candidates"][0].get("finishReason")
        except (KeyError, IndexError, TypeError):
            pass
        raise RuntimeError(
            f"Gemini returned no text parts{f' (finishReason={fr!r})' if fr else ''}."
        )
    return "\n".join(texts)


def _summarize_gemini_error(status: int, body: str) -> str:
    lowered = body.lower()
    if "fortiguard" in lowered or "urlfilter" in lowered or "blocked" in lowered:
        return (
            "Gemini is blocked by local/network filtering. "
            "Allowlist https://generativelanguage.googleapis.com or use another network."
        )
    clean = " ".join(body.split())
    if len(clean) > 300:
        clean = f"{clean[:300]}..."
    return f"Gemini HTTP {status}: {clean}" if clean else f"Gemini HTTP {status}: request rejected."


async def categorize_emails_with_gemini(
    student: StudentProfileCreate,
    emails: list[EmailRecord],
) -> BatchCategorizeResponse:
    if not settings.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured")

    user_text = build_categorization_user_content(student, emails)
    model = settings.GEMINI_MODEL.strip() or "gemini-2.0-flash"
    url = GEMINI_GENERATE_URL.format(model=model)
    payload: dict[str, Any] = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": user_text}]}],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json",
        },
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.post(url, params={"key": settings.GEMINI_API_KEY}, json=payload)

    if not r.is_success:
        raise RuntimeError(_summarize_gemini_error(r.status_code, r.text or ""))

    try:
        data = r.json()
    except json.JSONDecodeError as exc:
        raise RuntimeError("Gemini returned non-JSON body") from exc

    message = _extract_gemini_text(data)
    try:
        parsed = _parse_model_json(message)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Failed to parse Gemini JSON payload: {exc}") from exc

    raw_items = parsed.get("items")
    if not isinstance(raw_items, list):
        raise RuntimeError("Gemini JSON missing 'items' array")

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
        raise RuntimeError(f"ID mismatch after Gemini parse. missing={missing!r} extra={extra!r}")

    by_id = {i.email_id: i for i in items}
    ordered: list[EmailCategorizationItem] = []
    for e in emails:
        it = by_id[e.id]
        filtered_eq = filter_evidence_quotes_to_body(e.body, list(it.evidence_quotes))
        if filtered_eq != list(it.evidence_quotes):
            it = it.model_copy(update={"evidence_quotes": filtered_eq})
        ordered.append(it)

    batch_suggestions = parse_optional_string_list(parsed.get("batch_suggestions"))
    return BatchCategorizeResponse(items=ordered, model=model, batch_suggestions=batch_suggestions)
