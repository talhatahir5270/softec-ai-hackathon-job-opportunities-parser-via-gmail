from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Query, status
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.services import gmail_google, mongo_store

router = APIRouter(tags=["google-auth"])


def _redirect_with_query(extra: dict[str, str]) -> RedirectResponse:
    base = settings.FRONTEND_OAUTH_SUCCESS_URL
    joiner = "&" if ("?" in base) else "?"
    url = f"{base}{joiner}{urlencode(extra)}"
    return RedirectResponse(url=url, status_code=status.HTTP_302_FOUND)


@router.get("/auth/google")
async def google_oauth_start() -> RedirectResponse:
    if not gmail_google.google_oauth_configured():
        return _redirect_with_query({"gmail_error": "server_missing_google_oauth_env"})

    state = gmail_google.new_oauth_state_value()
    expires = datetime.now(timezone.utc) + timedelta(minutes=10)

    def _save() -> None:
        mongo_store.oauth_csrf_put(state, expires)

    await asyncio.to_thread(_save)
    return RedirectResponse(
        url=gmail_google.build_authorize_url(state),
        status_code=status.HTTP_302_FOUND,
    )


@router.get("/auth/callback")
async def google_oauth_callback(
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
) -> RedirectResponse:
    if error:
        return _redirect_with_query({"gmail_error": error[:300]})
    if not code or not state:
        return _redirect_with_query({"gmail_error": "missing_code_or_state"})

    if not await asyncio.to_thread(mongo_store.oauth_csrf_consume_if_valid, state):
        return _redirect_with_query({"gmail_error": "invalid_or_expired_oauth_state"})

    if not gmail_google.google_oauth_configured():
        return _redirect_with_query({"gmail_error": "server_missing_google_oauth_env"})

    try:
        tokens = await asyncio.to_thread(gmail_google.exchange_code_for_tokens_sync, code)
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:500] if exc.response is not None else str(exc)
        return _redirect_with_query({"gmail_error": detail[:300]})
    except Exception as exc:  # noqa: BLE001
        return _redirect_with_query({"gmail_error": str(exc)[:300]})

    access = str(tokens.get("access_token", ""))
    if not access:
        return _redirect_with_query({"gmail_error": "no_access_token"})

    refresh = tokens.get("refresh_token")
    refresh_s = str(refresh) if refresh else None
    exp = gmail_google.token_expiry_from_response(tokens)

    email = await asyncio.to_thread(gmail_google.fetch_google_email_sync, access)
    public_id = gmail_google.new_session_public_id()
    now = datetime.now(timezone.utc)

    def _persist_session() -> None:
        mongo_store.gmail_session_insert(
            {
                "_id": public_id,
                "access_token": access,
                "refresh_token": refresh_s,
                "token_expires_at": exp,
                "email": email,
                "created_at": now,
                "updated_at": now,
            }
        )

    await asyncio.to_thread(_persist_session)
    return _redirect_with_query({"gmail_session": public_id})


@router.get("/auth/gmail/configured")
async def gmail_oauth_configured_flag() -> dict[str, bool]:
    """Lightweight check for the SPA (no secrets exposed)."""
    return {"configured": gmail_google.google_oauth_configured()}
