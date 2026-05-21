from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.core.config import settings
from app.services import gmail_text

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

DEFAULT_SCOPES = (
    "openid "
    "https://www.googleapis.com/auth/gmail.readonly "
    "https://www.googleapis.com/auth/userinfo.email"
)


def google_oauth_configured() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)


def build_authorize_url(state: str) -> str:
    from urllib.parse import urlencode

    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": DEFAULT_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def new_oauth_state_value() -> str:
    return secrets.token_urlsafe(48)


def exchange_code_for_tokens_sync(code: str) -> dict[str, Any]:
    with httpx.Client(timeout=60.0) as client:
        r = client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        r.raise_for_status()
        return r.json()


def refresh_access_token_sync(refresh_token: str) -> dict[str, Any]:
    with httpx.Client(timeout=60.0) as client:
        r = client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        r.raise_for_status()
        return r.json()


def fetch_google_email_sync(access_token: str) -> str | None:
    with httpx.Client(timeout=30.0) as client:
        r = client.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
        if r.status_code != 200:
            return None
        data = r.json()
        email = data.get("email")
        return str(email) if email else None


def gmail_list_message_ids_sync(access_token: str, max_results: int = 40) -> list[str]:
    with httpx.Client(timeout=60.0) as client:
        r = client.get(
            f"{GMAIL_BASE}/messages",
            params={"maxResults": max_results},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        r.raise_for_status()
        data = r.json()
        msgs = data.get("messages") or []
        return [str(m["id"]) for m in msgs if isinstance(m, dict) and m.get("id")]


def gmail_get_message_full_sync(access_token: str, message_id: str) -> dict[str, Any]:
    with httpx.Client(timeout=60.0) as client:
        r = client.get(
            f"{GMAIL_BASE}/messages/{message_id}",
            params={"format": "full"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        r.raise_for_status()
        return r.json()


def fetch_gmail_emails_sync(access_token: str, limit: int = 28) -> list[dict[str, Any]]:
    """Pull recent Gmail threads and normalize to packaged `email_data.json` shape."""
    ids = gmail_list_message_ids_sync(access_token, max_results=min(50, limit + 10))
    out: list[dict[str, Any]] = []
    for mid in ids[:limit]:
        try:
            msg = gmail_get_message_full_sync(access_token, mid)
            out.append(gmail_message_to_record(msg))
        except httpx.HTTPError:
            continue
    return out


def _header_date(msg: dict[str, Any]) -> str:
    ms = msg.get("internalDate")
    if ms:
        try:
            ts = int(str(ms)) / 1000.0
            return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
        except (ValueError, OSError):
            pass
    payload = msg.get("payload")
    if isinstance(payload, dict):
        h = gmail_text.headers_map(payload)
        d = h.get("date")
        if d:
            return d[:16].replace("T", " ")[:10] if len(d) >= 10 else d
    return ""


def gmail_message_to_record(msg: dict[str, Any]) -> dict[str, Any]:
    mid = str(msg.get("id", ""))
    payload = msg.get("payload")
    headers: dict[str, str] = {}
    if isinstance(payload, dict):
        headers = gmail_text.headers_map(payload)
    from_ = headers.get("from", "(unknown sender)")
    subject = headers.get("subject", "(no subject)")
    body = gmail_text.message_plain_body(msg) if isinstance(payload, dict) else ""
    if not body.strip():
        body = "(No extractable body — try opening in Gmail.)"
    return {
        "id": mid,
        "from": from_,
        "subject": subject,
        "date": _header_date(msg),
        "body": body.strip(),
    }


def token_expiry_from_response(token_json: dict[str, Any]) -> datetime | None:
    sec = token_json.get("expires_in")
    if sec is None:
        return None
    try:
        return datetime.now(timezone.utc) + timedelta(seconds=int(sec))
    except (ValueError, TypeError):
        return None


def new_session_public_id() -> str:
    return str(uuid.uuid4())
