import asyncio
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, status
from fastapi.responses import HTMLResponse

from app.schemas.email import (
    BatchCategorizeRequest,
    BatchCategorizeResponse,
    EmailCategorizationItem,
    EmailRecord,
    ScoringBreakdown,
)
from app.schemas.student import StudentProfileCreate
from app.services import gemini_categorize, groq_categorize, mongo_store, packaged_data
from app.services.evidence_quotes import filter_evidence_quotes_to_body
from app.services.ranking_engine import apply_ranking

router = APIRouter()


def _cache_str_list(blob: dict[str, Any], key: str) -> list[str]:
    raw = blob.get(key)
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for x in raw[:10]:
        s = str(x).strip()
        if len(s) > 200:
            s = s[:200]
        if s:
            out.append(s)
    return out


def _cache_optional_str(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def _cache_evidence_quotes_list(blob: dict[str, Any]) -> list[str]:
    raw = blob.get("evidence_quotes")
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for x in raw[:8]:
        s = str(x).strip()
        if len(s) > 500:
            s = s[:500]
        if s:
            out.append(s)
    return out


def _inbox_source_is_demo(x_inbox_source: str | None) -> bool:
    return (x_inbox_source or "").strip().lower() == "demo"


async def _categorize_request_with_demo_emails(
    body: BatchCategorizeRequest,
    x_inbox_source: str | None,
) -> BatchCategorizeRequest:
    if not _inbox_source_is_demo(x_inbox_source):
        return body

    def _load_rows() -> list[dict[str, Any]]:
        doc = mongo_store.demo_inbox_get()
        if doc and isinstance(doc.get("emails"), list) and doc["emails"]:
            return list(doc["emails"])
        return packaged_data.load_packaged_emails()

    rows = await asyncio.to_thread(_load_rows)
    emails = [EmailRecord.model_validate(x) for x in rows]
    return body.model_copy(update={"emails": emails})


_DEMO_PAGE_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Email categorization demo</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 56rem; margin: 2rem auto; padding: 0 1rem; }
    #status { color: #333; }
    #status.error { color: #b00020; }
    pre { background: #f4f4f4; padding: 1rem; overflow: auto; border-radius: 6px; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <h1>Opportunity inbox — demo categorization</h1>
  <p id="status">Calling Groq (this often takes <strong>30–120 seconds</strong> for the full sample inbox). This page should appear immediately; JSON fills in when the model finishes.</p>
  <p>If the fetch fails instantly, the browser port must match the API (see the Uvicorn line in your terminal).</p>
  <pre id="out"></pre>
  <script>
    (async () => {
      const status = document.getElementById("status");
      const out = document.getElementById("out");
      try {
        const r = await fetch(window.location.pathname, {
          method: "POST",
          headers: { Accept: "application/json" },
        });
        const text = await r.text();
        if (!r.ok) {
          status.className = "error";
          status.textContent = "Request failed (" + r.status + "). Body below.";
        } else {
          status.textContent = "Done.";
          try {
            out.textContent = JSON.stringify(JSON.parse(text), null, 2);
          } catch {
            out.textContent = text;
          }
        }
        if (!r.ok) out.textContent = text;
      } catch (e) {
        status.className = "error";
        status.textContent = "Network error (is the API running on this origin?).";
        out.textContent = String(e);
      }
    })();
  </script>
</body>
</html>"""


async def _run_packaged_categorize_demo() -> BatchCategorizeResponse:
    try:
        raw_emails = packaged_data.load_packaged_emails()
        raw_student = packaged_data.load_packaged_student_profile()
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc

    student = StudentProfileCreate.model_validate(raw_student)
    emails = [EmailRecord.model_validate(e) for e in raw_emails]

    try:
        result = await groq_categorize.categorize_emails_with_groq(student, emails)
    except RuntimeError as exc:
        if "GROQ_API_KEY" in str(exc):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(exc),
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Categorization failed unexpectedly: {exc}",
        ) from exc

    ranked_items = apply_ranking(list(result.items))
    result = result.model_copy(update={"items": ranked_items})
    await asyncio.to_thread(mongo_store.sync_categorization_run, student, emails, result)
    return result


@router.get("/demo/inbox")
async def demo_packaged_inbox() -> dict[str, Any]:
    """Packaged demo inbox: prefer Mongo snapshot, else `email_data.json` + `student_profile_data.json`."""
    try:
        if mongo_store.mongo_configured():
            doc = mongo_store.demo_inbox_get()
            if doc and isinstance(doc.get("emails"), list) and doc.get("student"):
                return {"emails": doc["emails"], "student": doc["student"]}
        emails = packaged_data.load_packaged_emails()
        student = packaged_data.load_packaged_student_profile()
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    return {"emails": emails, "student": student}


@router.get("/db/latest-snapshot")
async def db_latest_snapshot(login_id: str | None = None) -> dict[str, Any]:
    """Return latest student + latest categorization run from MongoDB."""
    return await asyncio.to_thread(mongo_store.read_latest_snapshot, login_id)


def _categorize_runtime_http(exc: RuntimeError) -> HTTPException:
    msg = str(exc)
    if "GROQ_API_KEY" in msg or "GEMINI_API_KEY" in msg:
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=msg,
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=msg,
    )


async def _categorize_with_llm(
    student: StudentProfileCreate,
    emails: list[EmailRecord],
    llm_provider: str,
) -> BatchCategorizeResponse:
    try:
        if llm_provider == "gemini":
            return await gemini_categorize.categorize_emails_with_gemini(student, emails)
        return await groq_categorize.categorize_emails_with_groq(student, emails)
    except RuntimeError as exc:
        raise _categorize_runtime_http(exc) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Categorization failed unexpectedly: {exc}",
        ) from exc


@router.post("/emails/categorize", response_model=BatchCategorizeResponse)
async def categorize_emails(
    body: BatchCategorizeRequest,
    x_inbox_source: Annotated[str | None, Header(alias="X-Inbox-Source")] = None,
) -> BatchCategorizeResponse:
    eff = await _categorize_request_with_demo_emails(body, x_inbox_source)
    if not eff.emails:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="emails must be a non-empty list",
        )

    if not mongo_store.mongo_configured():
        result = await _categorize_with_llm(eff.student, eff.emails, eff.llm_provider)
        ranked_items = apply_ranking(list(result.items))
        result = result.model_copy(update={"items": ranked_items})
        await asyncio.to_thread(
            mongo_store.sync_categorization_run,
            eff.student,
            eff.emails,
            result,
        )
        return result

    student_fp = mongo_store.student_profile_fingerprint(eff.student)
    cached_by_id: dict[str, EmailCategorizationItem] = {}
    first_cached_model: str | None = None
    need_llm: list[EmailRecord] = []

    if eff.force_refresh:
        for e in eff.emails:
            email_fp = mongo_store.email_content_fingerprint(e)
            await asyncio.to_thread(
                mongo_store.categorization_cache_delete,
                eff.student.login_id,
                eff.llm_provider,
                student_fp,
                email_fp,
            )
        need_llm = list(eff.emails)
    else:
        for e in eff.emails:
            email_fp = mongo_store.email_content_fingerprint(e)
            row = await asyncio.to_thread(
                mongo_store.categorization_cache_get,
                eff.student.login_id,
                eff.llm_provider,
                student_fp,
                email_fp,
            )
            if row:
                model_m, blob = row
                if first_cached_model is None:
                    first_cached_model = model_m
                act_raw = blob.get("action_suggestions")
                action_suggestions = list(act_raw) if isinstance(act_raw, list) else []
                raw_scoring = blob.get("scoring")
                scoring: ScoringBreakdown | None = None
                if isinstance(raw_scoring, dict):
                    try:
                        scoring = ScoringBreakdown.model_validate(raw_scoring)
                    except Exception:
                        scoring = None
                evq = filter_evidence_quotes_to_body(e.body, _cache_evidence_quotes_list(blob))
                cached_by_id[e.id] = EmailCategorizationItem(
                    email_id=e.id,
                    is_opportunity=bool(blob.get("is_opportunity", False)),
                    opportunity_type=str(blob.get("opportunity_type", "none")),
                    relevance_score=float(blob.get("relevance_score", 0.0)),
                    profile_fit_label=str(blob.get("profile_fit_label", "")),
                    rationale=str(blob.get("rationale", "")),
                    deadlines=list(blob.get("deadlines") or [])
                    if isinstance(blob.get("deadlines"), list)
                    else [],
                    eligibility=_cache_str_list(blob, "eligibility"),
                    required_documents=_cache_str_list(blob, "required_documents"),
                    application_url=_cache_optional_str(blob.get("application_url")),
                    contact_email=_cache_optional_str(blob.get("contact_email")),
                    priority_rank=int(blob.get("priority_rank") or 0),
                    action_suggestions=action_suggestions,
                    evidence_quotes=evq,
                    scoring=scoring,
                )
            else:
                need_llm.append(e)

    llm_result: BatchCategorizeResponse | None = None
    if need_llm:
        llm_result = await _categorize_with_llm(eff.student, need_llm, eff.llm_provider)
        for e in need_llm:
            it = next((x for x in llm_result.items if x.email_id == e.id), None)
            if it is None:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Categorization returned items that do not match requested email ids.",
                )
            email_fp = mongo_store.email_content_fingerprint(e)
            await asyncio.to_thread(
                mongo_store.categorization_cache_upsert,
                eff.student.login_id,
                eff.llm_provider,
                student_fp,
                email_fp,
                llm_result.model,
                it,
            )

    items: list[EmailCategorizationItem] = []
    for e in eff.emails:
        if e.id in cached_by_id:
            items.append(cached_by_id[e.id])
        else:
            assert llm_result is not None
            llm_by_id = {x.email_id: x for x in llm_result.items}
            got = llm_by_id.get(e.id)
            if got is None:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Categorization returned items that do not match requested email ids.",
                )
            items.append(got)

    display_model = llm_result.model if llm_result is not None else (first_cached_model or "cached")
    batch_suggestions = list(llm_result.batch_suggestions) if llm_result is not None else []

    items = apply_ranking(items)
    result = BatchCategorizeResponse(
        items=items,
        model=display_model,
        batch_suggestions=batch_suggestions,
    )
    await asyncio.to_thread(
        mongo_store.sync_categorization_run,
        eff.student,
        eff.emails,
        result,
    )
    return result


@router.get("/emails/categorize-demo", response_class=HTMLResponse)
async def categorize_packaged_demo_page() -> HTMLResponse:
    """Fast HTML shell: browser shows text immediately, then JS POSTs for the slow Groq call."""
    return HTMLResponse(_DEMO_PAGE_HTML)


@router.post(
    "/emails/categorize-demo",
    response_model=BatchCategorizeResponse,
)
async def categorize_packaged_demo() -> BatchCategorizeResponse:
    return await _run_packaged_categorize_demo()
