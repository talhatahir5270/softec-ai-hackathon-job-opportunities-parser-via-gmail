from __future__ import annotations

import asyncio
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, status

from app.schemas.email_chat import EmailChatReindexBody, EmailChatRequest
from app.services import email_chunk_index, mongo_store
from app.services.email_rag_chat import answer_with_email_rag

logger = logging.getLogger(__name__)

router = APIRouter()


def _resolve_owner_key(
    x_gmail_session: str | None,
    x_login_id: str | None,
    x_inbox_source: str | None,
) -> str:
    if (x_inbox_source or "").strip().lower() == "demo":
        lid = (x_login_id or "").strip()
        if len(lid) < 3:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="X-Login-Id is required for demo inbox mode (min 3 characters).",
            )
        return email_chunk_index.owner_key_from_demo(lid)
    sid = (x_gmail_session or "").strip()
    if sid:
        row = mongo_store.gmail_session_get(sid)
        if not row:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired Gmail session.",
            )
        return email_chunk_index.owner_key_from_gmail(sid)
    lid = (x_login_id or "").strip()
    if len(lid) >= 3:
        return email_chunk_index.owner_key_from_login(lid)
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Send X-Gmail-Session or X-Login-Id (min 3 characters) to scope inbox chat.",
    )


def _emails_for_reindex(
    owner_key: str,
    body: EmailChatReindexBody,
    gmail_session_id: str | None,
) -> list[dict[str, Any]]:
    if owner_key.startswith("demo:"):
        if body.emails:
            out_demo: list[dict[str, Any]] = []
            for e in body.emails:
                if isinstance(e, dict):
                    out_demo.append(e)
            if out_demo:
                return out_demo
        doc = mongo_store.demo_inbox_get()
        if doc and isinstance(doc.get("emails"), list):
            return [x for x in doc["emails"] if isinstance(x, dict)]
        return []
    if body.emails:
        out: list[dict[str, Any]] = []
        for e in body.emails:
            if isinstance(e, dict):
                out.append(e)
        return out
    if gmail_session_id and owner_key.startswith("gmail:"):
        sid = gmail_session_id.strip()
        snap = mongo_store.read_gmail_inbox_snapshot(sid)
        if snap is not None:
            data, _ts = snap
            raw = data.get("emails") or []
            if isinstance(raw, list):
                return [x for x in raw if isinstance(x, dict)]
        cached = mongo_store.inbox_cache_get(sid)
        if cached is not None:
            payload, _u = cached
            raw = payload.get("emails") or []
            if isinstance(raw, list):
                return [x for x in raw if isinstance(x, dict)]
    return []


@router.post("/email-chat/reindex")
async def email_chat_reindex(
    body: EmailChatReindexBody,
    x_gmail_session: Annotated[str | None, Header(alias="X-Gmail-Session")] = None,
    x_login_id: Annotated[str | None, Header(alias="X-Login-Id")] = None,
    x_inbox_source: Annotated[str | None, Header(alias="X-Inbox-Source")] = None,
) -> dict[str, Any]:
    if not mongo_store.mongo_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MongoDB is not configured (set MONGODB_URI).",
        )
    try:
        owner_key = _resolve_owner_key(x_gmail_session, x_login_id, x_inbox_source)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    sid = (x_gmail_session or "").strip() or None
    emails = _emails_for_reindex(owner_key, body, sid)
    if not emails and not owner_key.startswith("gmail:") and not owner_key.startswith("demo:"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide a non-empty `emails` array for login-scoped indexing.",
        )
    if not emails:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No emails to index. For demo mode, ensure the packaged demo inbox is synced to MongoDB.",
        )

    try:
        stats = await asyncio.to_thread(email_chunk_index.sync_email_chunks_for_owner, owner_key, emails)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("email_chat_reindex failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Indexing failed: {exc}",
        ) from exc

    return {"ok": True, **stats}


@router.post("/email-chat/message")
async def email_chat_message(
    body: EmailChatRequest,
    x_gmail_session: Annotated[str | None, Header(alias="X-Gmail-Session")] = None,
    x_login_id: Annotated[str | None, Header(alias="X-Login-Id")] = None,
    x_inbox_source: Annotated[str | None, Header(alias="X-Inbox-Source")] = None,
) -> dict[str, str]:
    if not mongo_store.mongo_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MongoDB is not configured (set MONGODB_URI).",
        )
    owner_key = _resolve_owner_key(x_gmail_session, x_login_id, x_inbox_source)
    msgs = [{"role": m.role, "content": m.content} for m in body.messages]
    try:
        reply = await answer_with_email_rag(owner_key, msgs)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("email_chat_message failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Chat failed: {exc}",
        ) from exc
    return {"reply": reply}
