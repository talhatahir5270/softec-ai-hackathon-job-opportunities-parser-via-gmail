from __future__ import annotations

import asyncio
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Query, status

from app.services import gmail_inbox_service
from app.services.gmail_inbox_service import delete_gmail_session_sync, get_session_status_sync

router = APIRouter()


@router.get("/inbox")
async def unified_inbox(
    x_gmail_session: Annotated[str | None, Header(alias="X-Gmail-Session")] = None,
    x_inbox_source: Annotated[str | None, Header(alias="X-Inbox-Source")] = None,
    refresh: Annotated[bool, Query(description="When true, refetch from Gmail and update the stored snapshot.")] = False,
) -> dict[str, Any]:
    """Packaged demo (``X-Inbox-Source: demo``) or live Gmail when a session header is present.

    Gmail results are persisted per session id; pass ``refresh=true`` to pull the latest from Gmail.
    """
    try:
        return await gmail_inbox_service.load_unified_inbox(
            x_gmail_session,
            refresh=refresh,
            inbox_source=x_inbox_source,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc


@router.get("/auth/gmail/status")
async def gmail_connection_status(
    x_gmail_session: Annotated[str | None, Header(alias="X-Gmail-Session")] = None,
) -> dict[str, Any]:
    if not x_gmail_session or not x_gmail_session.strip():
        return {"connected": False, "email": None}
    return await asyncio.to_thread(get_session_status_sync, x_gmail_session.strip())


@router.delete("/auth/gmail/session")
async def gmail_disconnect(
    x_gmail_session: Annotated[str | None, Header(alias="X-Gmail-Session")] = None,
) -> dict[str, bool]:
    if not x_gmail_session or not x_gmail_session.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="missing session header")
    ok = await asyncio.to_thread(delete_gmail_session_sync, x_gmail_session.strip())
    return {"ok": ok}
