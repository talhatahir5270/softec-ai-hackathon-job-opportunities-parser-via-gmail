import json
import re
import ssl
from typing import Any

import certifi
from openai import APIConnectionError, APIError, APIStatusError
from pydantic import ValidationError

from app.core.config import settings
from app.models.enums import (
    Availability,
    Degree,
    ExperienceLevel,
    FinancialNeed,
    Interest,
    LocationPreference,
    OpportunityType,
    Skill,
)
from app.schemas.cv import CvExtractResponse, CvSuggestedProfile
from app.services.groq_categorize import (
    build_groq_async_client,
    extract_chat_message_content,
    parse_chat_json_payload,
    summarize_groq_status_error,
)
from app.services.stopword_compact import compact_english_for_llm

_SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())


def _values(enum_cls: type) -> list[str | int]:
    return [e.value for e in enum_cls]  # type: ignore[misc]


def _filter_list(values: Any, allowed: set[str]) -> list[str] | None:
    if not isinstance(values, list):
        return None
    out = [x for x in values if isinstance(x, str) and x in allowed]
    return out or None


def _sanitize_suggested(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    lid = raw.get("login_id")
    if isinstance(lid, str) and 3 <= len(lid) <= 64:
        if re.match(r"^[A-Za-z0-9._-]+$", lid):
            out["login_id"] = lid

    deg = raw.get("degree")
    if isinstance(deg, str) and deg in {d.value for d in Degree}:
        out["degree"] = deg

    sem = raw.get("semester")
    si: int | None = None
    if isinstance(sem, str) and sem.strip().isdigit():
        si = int(sem.strip())
    elif isinstance(sem, (int, float)) and float(sem).is_integer():
        si = int(sem)
    if si is not None and 1 <= si <= 9:
        out["semester"] = si

    cg = raw.get("cgpa")
    if isinstance(cg, str):
        try:
            cg = float(cg.strip())
        except ValueError:
            cg = None
    if isinstance(cg, (int, float)):
        cgf = float(cg)
        if 0.0 <= cgf <= 4.0:
            out["cgpa"] = cgf

    sk = _filter_list(raw.get("skills"), {s.value for s in Skill})
    if sk:
        out["skills"] = sk

    intr = _filter_list(raw.get("interests"), {i.value for i in Interest})
    if intr:
        out["interests"] = intr

    ot = _filter_list(
        raw.get("preferred_opportunity_types"),
        {o.value for o in OpportunityType},
    )
    if ot:
        out["preferred_opportunity_types"] = ot

    loc = _filter_list(
        raw.get("location_preference"),
        {l.value for l in LocationPreference},
    )
    if loc:
        out["location_preference"] = loc

    fn = raw.get("financial_need")
    if isinstance(fn, str) and fn in {f.value for f in FinancialNeed}:
        out["financial_need"] = fn

    av = raw.get("availability")
    if isinstance(av, str) and av in {a.value for a in Availability}:
        out["availability"] = av

    ex = raw.get("experience_level")
    if isinstance(ex, str) and ex in {e.value for e in ExperienceLevel}:
        out["experience_level"] = ex

    return out


def _build_messages(cv_text: str) -> list[dict[str, str]]:
    spec = {
        "degree": _values(Degree),
        "semester": list(range(1, 10)),
        "cgpa": "number 0–4",
        "skills": _values(Skill),
        "interests": _values(Interest),
        "preferred_opportunity_types": _values(OpportunityType),
        "location_preference": _values(LocationPreference),
        "financial_need": _values(FinancialNeed),
        "availability": _values(Availability),
        "experience_level": _values(ExperienceLevel),
        "login_id": (
            "optional: only if the CV clearly shows a stable handle/username "
            "matching ^[A-Za-z0-9._-]{3,64}$; otherwise omit"
        ),
    }
    system = (
        "You map resume/CV plain text to a structured student profile for an opportunity-matching app. "
        "Return ONLY JSON with shape "
        '{"suggested":{...},"notes":"optional short string"}. '
        "Put only confident fields inside suggested; omit keys you cannot infer. "
        "Every string value must exactly match one of the allowed literals below (case-sensitive). "
        "Use JSON arrays for list fields. semester is 1–8 for active terms, 9 if explicitly graduated. "
        "Do not invent login_id from a personal name alone.\n\n"
        f"Allowed fields and literals (JSON):\n{json.dumps(spec, ensure_ascii=False)}"
    )
    user = f"CV / resume text:\n\n{cv_text}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


async def extract_profile_from_cv_text(cv_text: str) -> tuple[CvSuggestedProfile, str]:
    if not settings.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not configured")

    cv_text = compact_english_for_llm(cv_text)
    messages = _build_messages(cv_text)
    verify: bool | str | ssl.SSLContext = _SSL_CONTEXT
    if not settings.GROQ_VERIFY_SSL:
        verify = False
    elif settings.GROQ_CA_BUNDLE.strip():
        verify = settings.GROQ_CA_BUNDLE.strip()

    async def _call_groq(verify_value: bool | str | ssl.SSLContext) -> dict[str, Any]:
        client = build_groq_async_client(verify=verify_value)
        try:
            resp = await client.chat.completions.create(
                model=settings.GROQ_MODEL,
                temperature=0.1,
                response_format={"type": "json_object"},
                messages=messages,
            )
            return resp.model_dump(mode="json")
        finally:
            await client.close()

    try:
        data = await _call_groq(verify)
    except APIConnectionError as exc:
        if "CERTIFICATE_VERIFY_FAILED" in str(exc):
            try:
                data = await _call_groq(False)
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

    sug_raw = parsed.get("suggested")
    notes = parsed.get("notes") if isinstance(parsed.get("notes"), str) else ""

    sanitized = _sanitize_suggested(sug_raw)
    try:
        suggested = CvSuggestedProfile.model_validate(sanitized)
    except ValidationError as exc:
        raise RuntimeError(f"Invalid suggested profile after sanitize: {exc}") from exc

    return suggested, notes


def build_cv_response(
    suggested: CvSuggestedProfile,
    notes: str,
    full_text: str,
    used_text: str,
    truncated: bool,
) -> CvExtractResponse:
    preview = used_text[:500].replace("\r", " ")
    return CvExtractResponse(
        suggested=suggested,
        text_char_count=len(full_text),
        text_used_chars=len(used_text),
        text_truncated=truncated,
        text_preview=preview,
        model=settings.GROQ_MODEL,
        notes=notes.strip(),
    )
