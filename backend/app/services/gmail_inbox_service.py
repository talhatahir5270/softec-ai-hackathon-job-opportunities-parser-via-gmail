from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services import email_chunk_index, gmail_google, mongo_store, packaged_data

logger = logging.getLogger(__name__)


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _demo_payload_from_files() -> dict[str, Any]:
    emails = packaged_data.load_packaged_emails()
    student = packaged_data.load_packaged_student_profile()
    raw = packaged_data.load_email_file_raw()
    gmail_addr = raw.get("gmailUser")
    if not isinstance(gmail_addr, str) or not gmail_addr.strip():
        gmail_addr = "packaged.demo@khushpush.mail"
    return {
        "source": "demo",
        "gmail_connected": False,
        "gmail_email": gmail_addr.strip(),
        "emails": emails,
        "student": student,
        "demo_history_id": raw.get("historyId"),
    }


def build_demo_inbox_payload_sync() -> dict[str, Any]:
    """Return demo inbox for API: prefer Mongo snapshot; else JSON files and upsert Mongo."""
    if mongo_store.mongo_configured():
        doc = mongo_store.demo_inbox_get()
        if doc and isinstance(doc.get("emails"), list) and len(doc["emails"]) > 0:
            raw_u = doc.get("updated_at")
            if isinstance(raw_u, datetime):
                cached_iso = raw_u if raw_u.tzinfo else raw_u.replace(tzinfo=timezone.utc)
            else:
                cached_iso = datetime.now(timezone.utc)
            ge = doc.get("demo_gmail_email") or "packaged.demo@khushpush.mail"
            student = doc.get("student")
            if not isinstance(student, dict):
                student = packaged_data.load_packaged_student_profile()
            return {
                "source": "demo",
                "gmail_connected": False,
                "gmail_email": str(ge),
                "emails": doc["emails"],
                "student": student,
                "demo_history_id": doc.get("history_id"),
                "inbox_from_cache": True,
                "inbox_cached_at": cached_iso.isoformat(),
            }
    payload = _demo_payload_from_files()
    if mongo_store.mongo_configured():
        try:
            packaged_data.ensure_demo_inbox_mongo_from_files()
        except Exception:
            logger.warning("Could not persist demo inbox to Mongo", exc_info=True)
    return {
        **payload,
        "inbox_from_cache": False,
        "inbox_cached_at": None,
    }


def _get_session_row_sync(public_id: str) -> dict[str, Any] | None:
    return mongo_store.gmail_session_get(public_id)


def _resolve_access_token_sync(public_id: str) -> str | None:
    row = mongo_store.gmail_session_get(public_id)
    if not row:
        return None
    now = datetime.now(timezone.utc)
    exp = row.get("token_expires_at")
    if exp is None:
        return row.get("access_token")
    if isinstance(exp, datetime) and _as_utc(exp) > now + timedelta(minutes=1):
        return row.get("access_token")
    refresh = row.get("refresh_token")
    if not refresh:
        return None
    try:
        j = gmail_google.refresh_access_token_sync(str(refresh))
    except Exception:
        return None
    new_access = str(j.get("access_token", ""))
    new_exp = gmail_google.token_expiry_from_response(j)
    new_refresh = str(j["refresh_token"]) if j.get("refresh_token") else None
    mongo_store.gmail_session_update_tokens(
        public_id,
        new_access,
        new_exp,
        new_refresh if new_refresh else None,
    )
    return new_access


def get_session_status_sync(public_id: str) -> dict[str, Any]:
    row = _get_session_row_sync(public_id)
    if not row:
        return {"connected": False, "email": None}
    return {"connected": True, "email": row.get("email")}


def delete_gmail_session_sync(public_id: str) -> bool:
    mongo_store.delete_gmail_inbox_for_session(public_id)
    mongo_store.inbox_cache_delete(public_id)
    mongo_store.email_chunks_delete_for_owner(email_chunk_index.owner_key_from_gmail(public_id))
    return mongo_store.gmail_session_delete(public_id)


def _get_inbox_cache_sync(user_id: str) -> tuple[dict[str, Any], datetime] | None:
    return mongo_store.inbox_cache_get(user_id)


def _upsert_inbox_cache_sync(user_id: str, payload: dict[str, Any]) -> datetime:
    return mongo_store.inbox_cache_upsert(user_id, payload)


async def load_unified_inbox(
    gmail_session_id: str | None,
    *,
    refresh: bool = False,
    inbox_source: str | None = None,
) -> dict[str, Any]:
    """``inbox_source=demo`` → always packaged demo (Mongo-backed). ``live`` → Gmail when connected, else demo files."""
    mode = (inbox_source or "live").strip().lower()
    if mode not in ("demo", "live"):
        mode = "live"

    if mode == "demo":
        pl = await asyncio.to_thread(build_demo_inbox_payload_sync)
        return {
            "source": "demo",
            "gmail_connected": False,
            "gmail_email": pl.get("gmail_email"),
            "emails": pl["emails"],
            "student": pl["student"],
            "inbox_from_cache": bool(pl.get("inbox_from_cache")),
            "inbox_cached_at": pl.get("inbox_cached_at"),
            "inbox_pack": "demo",
            "demo_history_id": pl.get("demo_history_id"),
        }

    try:
        demo_fallback = _demo_payload_from_files()
    except (FileNotFoundError, ValueError) as exc:
        raise RuntimeError(str(exc)) from exc

    if not gmail_session_id or not gmail_session_id.strip():
        return {
            **demo_fallback,
            "inbox_from_cache": False,
            "inbox_cached_at": None,
            "inbox_pack": "live",
        }

    public_id = gmail_session_id.strip()
    row = await asyncio.to_thread(_get_session_row_sync, public_id)
    if not row:
        return {
            **demo_fallback,
            "inbox_from_cache": False,
            "inbox_cached_at": None,
            "inbox_pack": "live",
        }

    if not refresh:
        mongo_cached = await asyncio.to_thread(mongo_store.read_gmail_inbox_snapshot, public_id)
        if mongo_cached is not None:
            data, cached_at = mongo_cached
            return {
                **data,
                "inbox_from_cache": True,
                "inbox_cached_at": cached_at.isoformat(),
                "inbox_pack": "live",
            }
        cached = await asyncio.to_thread(_get_inbox_cache_sync, public_id)
        if cached is not None:
            data, cached_at = cached
            return {
                **data,
                "inbox_from_cache": True,
                "inbox_cached_at": cached_at.isoformat(),
                "inbox_pack": "live",
            }

    access = await asyncio.to_thread(_resolve_access_token_sync, public_id)
    if not access:
        return {
            **demo_fallback,
            "inbox_from_cache": False,
            "inbox_cached_at": None,
            "inbox_pack": "live",
        }

    try:
        emails = await asyncio.to_thread(gmail_google.fetch_gmail_emails_sync, access)
    except Exception:
        return {
            **demo_fallback,
            "inbox_from_cache": False,
            "inbox_cached_at": None,
            "inbox_pack": "live",
        }

    try:
        student = packaged_data.load_packaged_student_profile()
    except (FileNotFoundError, ValueError):
        student = demo_fallback["student"]

    built = {
        "source": "gmail",
        "gmail_connected": True,
        "gmail_email": row.get("email"),
        "emails": emails,
        "student": student,
    }
    mongo_at = await asyncio.to_thread(mongo_store.sync_gmail_inbox_snapshot, public_id, built)
    stored_local = await asyncio.to_thread(_upsert_inbox_cache_sync, public_id, built)
    cache_ts = mongo_at or stored_local
    if mongo_store.mongo_configured():
        try:
            await asyncio.to_thread(
                email_chunk_index.sync_email_chunks_for_owner,
                email_chunk_index.owner_key_from_gmail(public_id),
                built["emails"],
            )
        except Exception:
            logger.warning("Inbox email embedding index failed (non-fatal)", exc_info=True)
    return {
        **built,
        "inbox_from_cache": False,
        "inbox_cached_at": cache_ts.isoformat(),
        "inbox_pack": "live",
    }
