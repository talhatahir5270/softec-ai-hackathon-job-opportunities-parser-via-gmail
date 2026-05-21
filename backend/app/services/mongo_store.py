"""All application persistence in MongoDB (database from settings.MONGODB_DB_NAME, default KhushPush)."""

from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from pymongo import MongoClient
from pymongo.database import Database

from app.core.config import settings
from app.schemas.email import BatchCategorizeResponse, EmailCategorizationItem, EmailRecord
from app.schemas.student import StudentProfileCreate, StudentProfileStored

logger = logging.getLogger(__name__)

COL_STUDENTS = "student_profiles"
COL_OAUTH = "oauth_csrf_states"
COL_GMAIL_SESS = "gmail_account_sessions"
COL_INBOX_CACHE = "inbox_caches"
COL_GMAIL_INBOX = "gmail_inbox_snapshots"
COL_CAT_RUNS = "categorization_runs"
COL_EMAIL_CAT_CACHE = "email_categorization_cache"
COL_EMAIL_CHUNKS = "email_embedding_chunks"
COL_DEMO_INBOX = "demo_inbox_packaged"
COL_SUCURI_CACHE = "sucuri_sitecheck_cache"
COL_SAFE_BROWSING_CACHE = "google_safebrowsing_cache"

_client: MongoClient | None = None
_client_uri: str | None = None


def _get_db() -> Database | None:
    uri = (settings.MONGODB_URI or "").strip()
    if not uri:
        return None
    global _client, _client_uri
    try:
        if _client is None or _client_uri != uri:
            if _client is not None:
                _client.close()
            _client = MongoClient(uri, serverSelectionTimeoutMS=5000)
            _client_uri = uri
        return _client[settings.MONGODB_DB_NAME]
    except Exception:
        logger.exception("MongoDB: failed to create client")
        return None


def mongo_configured() -> bool:
    return bool((settings.MONGODB_URI or "").strip())


def init_mongo_db() -> None:
    """Create indexes (safe to call on every startup)."""
    db = _get_db()
    if db is None:
        logger.warning("MongoDB URI empty; skipping init_mongo_db")
        return
    try:
        db[COL_STUDENTS].create_index([("login_id", 1), ("created_at", -1)])
        db[COL_CAT_RUNS].create_index([("login_id", 1), ("created_at", -1)])
        db[COL_EMAIL_CAT_CACHE].create_index(
            [("login_id", 1), ("llm_provider", 1), ("student_fp", 1), ("email_fp", 1)],
            unique=True,
        )
        db[COL_EMAIL_CHUNKS].create_index([("owner_key", 1), ("email_id", 1), ("chunk_ix", 1)])
        db[COL_DEMO_INBOX].create_index([("updated_at", -1)])
        db[COL_OAUTH].create_index("expires_at", expireAfterSeconds=0)
    except Exception:
        logger.exception("MongoDB: index creation failed (continuing)")


def _student_doc_to_stored(doc: dict[str, Any]) -> StudentProfileStored:
    d = {k: v for k, v in doc.items() if k not in ("_id",)}
    raw_id = doc["_id"]
    d["id"] = UUID(str(raw_id)) if not isinstance(raw_id, UUID) else raw_id
    d["created_at"] = doc["created_at"]
    return StudentProfileStored.model_validate(d)


def student_profile_save(payload: StudentProfileCreate) -> StudentProfileStored:
    db = _get_db()
    if db is None:
        raise RuntimeError("MongoDB is not configured (set MONGODB_URI).")
    coll = db[COL_STUDENTS]
    now = datetime.now(timezone.utc)
    existing = coll.find_one({"login_id": payload.login_id}, sort=[("created_at", -1)])
    fields = payload.model_dump(mode="json")
    if existing:
        _id = existing["_id"]
        doc = {"_id": _id, "created_at": now, **fields}
        coll.replace_one({"_id": _id}, doc)
    else:
        sid = str(uuid.uuid4())
        doc = {"_id": sid, "created_at": now, **fields}
        coll.insert_one(doc)
    saved = coll.find_one({"_id": doc["_id"]})
    assert saved is not None
    return _student_doc_to_stored(saved)


def student_profile_get_latest(login_id: str) -> StudentProfileStored | None:
    db = _get_db()
    if db is None:
        return None
    doc = db[COL_STUDENTS].find_one({"login_id": login_id}, sort=[("created_at", -1)])
    if not doc:
        return None
    return _student_doc_to_stored(doc)


def sync_student_profile_stored(stored: StudentProfileStored) -> None:
    """Upsert a student row by id (used after profile save / demo sync)."""
    db = _get_db()
    if db is None:
        return
    raw = stored.model_dump(mode="json")
    sid = str(raw.pop("id"))
    doc: dict[str, Any] = {"_id": sid, **raw}
    try:
        db[COL_STUDENTS].replace_one({"_id": sid}, doc, upsert=True)
    except Exception:
        logger.exception("MongoDB: failed to upsert student_profiles")


def oauth_csrf_put(state: str, expires_at: datetime) -> None:
    db = _get_db()
    if db is None:
        raise RuntimeError("MongoDB is not configured (set MONGODB_URI).")
    db[COL_OAUTH].replace_one(
        {"_id": state},
        {"_id": state, "expires_at": expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)},
        upsert=True,
    )


def oauth_csrf_consume_if_valid(state: str) -> bool:
    db = _get_db()
    if db is None:
        return False
    now = datetime.now(timezone.utc)
    doc = db[COL_OAUTH].find_one({"_id": state})
    if not doc:
        return False
    exp = doc.get("expires_at")
    if isinstance(exp, datetime):
        exp_utc = exp if exp.tzinfo else exp.replace(tzinfo=timezone.utc)
        if exp_utc < now:
            db[COL_OAUTH].delete_one({"_id": state})
            return False
    db[COL_OAUTH].delete_one({"_id": state})
    return True


def gmail_session_get(public_id: str) -> dict[str, Any] | None:
    db = _get_db()
    if db is None:
        return None
    return db[COL_GMAIL_SESS].find_one({"_id": public_id})


def gmail_session_insert(doc: dict[str, Any]) -> None:
    db = _get_db()
    if db is None:
        raise RuntimeError("MongoDB is not configured (set MONGODB_URI).")
    db[COL_GMAIL_SESS].insert_one(doc)


def gmail_session_update_tokens(
    public_id: str,
    access_token: str,
    token_expires_at: datetime | None,
    refresh_token: str | None = None,
) -> None:
    db = _get_db()
    if db is None:
        return
    now = datetime.now(timezone.utc)
    update: dict[str, Any] = {
        "access_token": access_token,
        "token_expires_at": token_expires_at,
        "updated_at": now,
    }
    if refresh_token is not None:
        update["refresh_token"] = refresh_token
    db[COL_GMAIL_SESS].update_one({"_id": public_id}, {"$set": update})


def gmail_session_delete(public_id: str) -> bool:
    db = _get_db()
    if db is None:
        return False
    r = db[COL_GMAIL_SESS].delete_one({"_id": public_id})
    return r.deleted_count > 0


def inbox_cache_get(user_id: str) -> tuple[dict[str, Any], datetime] | None:
    db = _get_db()
    if db is None:
        return None
    doc = db[COL_INBOX_CACHE].find_one({"_id": user_id})
    if not doc:
        return None
    pl = doc.get("payload")
    if not isinstance(pl, dict):
        return None
    raw_u = doc.get("updated_at")
    if isinstance(raw_u, datetime):
        updated = raw_u if raw_u.tzinfo else raw_u.replace(tzinfo=timezone.utc)
    else:
        updated = datetime.now(timezone.utc)
    return dict(pl), updated


def inbox_cache_upsert(user_id: str, payload: dict[str, Any]) -> datetime:
    db = _get_db()
    if db is None:
        raise RuntimeError("MongoDB is not configured (set MONGODB_URI).")
    now = datetime.now(timezone.utc)
    to_store = {
        "emails": payload["emails"],
        "student": payload["student"],
        "source": payload["source"],
        "gmail_connected": payload["gmail_connected"],
        "gmail_email": payload["gmail_email"],
    }
    db[COL_INBOX_CACHE].replace_one(
        {"_id": user_id},
        {"_id": user_id, "payload": to_store, "updated_at": now},
        upsert=True,
    )
    return now


def inbox_cache_delete(user_id: str) -> None:
    db = _get_db()
    if db is None:
        return
    db[COL_INBOX_CACHE].delete_one({"_id": user_id})


def canonical_inbox_payload(inbox: dict[str, Any]) -> dict[str, Any]:
    emails_raw = inbox.get("emails") or []
    emails: list[dict[str, Any]] = []
    if isinstance(emails_raw, list):
        for e in emails_raw:
            if not isinstance(e, dict):
                continue
            mid = e.get("id")
            if not mid:
                continue
            emails.append(
                {
                    "id": str(mid),
                    "from": str(e.get("from", "")),
                    "subject": str(e.get("subject", "")),
                    "date": str(e.get("date") or ""),
                    "body": str(e.get("body", "")),
                }
            )
    stud = inbox.get("student")
    student: dict[str, Any] = dict(stud) if isinstance(stud, dict) else {}
    ge = inbox.get("gmail_email")
    return {
        "source": str(inbox.get("source", "gmail")),
        "gmail_connected": bool(inbox.get("gmail_connected", True)),
        "gmail_email": str(ge) if ge is not None else None,
        "emails": emails,
        "student": student,
    }


def sync_gmail_inbox_snapshot(gmail_session_id: str, inbox_payload: dict[str, Any]) -> datetime | None:
    db = _get_db()
    if db is None:
        return None
    fetched_at = datetime.now(timezone.utc)
    canonical = canonical_inbox_payload(inbox_payload)
    doc = {
        "_id": gmail_session_id,
        "gmail_session_id": gmail_session_id,
        "fetched_at": fetched_at,
        "inbox_payload": canonical,
    }
    try:
        db[COL_GMAIL_INBOX].replace_one({"_id": gmail_session_id}, doc, upsert=True)
        return fetched_at
    except Exception:
        logger.exception("MongoDB: failed to upsert gmail inbox snapshot")
        return None


def read_gmail_inbox_snapshot(gmail_session_id: str) -> tuple[dict[str, Any], datetime] | None:
    db = _get_db()
    if db is None:
        return None
    try:
        doc = db[COL_GMAIL_INBOX].find_one({"_id": gmail_session_id})
    except Exception:
        logger.exception("MongoDB: failed reading gmail inbox snapshot")
        return None
    if not doc:
        return None
    raw_fetched = doc.get("fetched_at")
    if isinstance(raw_fetched, datetime):
        fetched_at = raw_fetched if raw_fetched.tzinfo else raw_fetched.replace(tzinfo=timezone.utc)
    else:
        fetched_at = datetime.now(timezone.utc)
    blob = doc.get("inbox_payload")
    if isinstance(blob, dict) and isinstance(blob.get("emails"), list):
        return canonical_inbox_payload(blob), fetched_at
    return None


def delete_gmail_inbox_for_session(gmail_session_id: str) -> None:
    db = _get_db()
    if db is None:
        return
    try:
        db[COL_GMAIL_INBOX].delete_one({"_id": gmail_session_id})
    except Exception:
        logger.exception("MongoDB: failed deleting gmail inbox snapshot")


def _email_rows_for_cat(emails: list[EmailRecord]) -> list[dict[str, Any]]:
    return [
        {
            "id": str(e.id),
            "from": e.from_,
            "subject": e.subject,
            "date": e.date,
            "body": e.body,
        }
        for e in emails
    ]


def student_profile_fingerprint(student: StudentProfileCreate) -> str:
    return hashlib.sha256(student.model_dump_json().encode()).hexdigest()


def email_content_fingerprint(email: EmailRecord) -> str:
    payload = f"{email.from_}\n{email.subject}\n{email.date}\n{email.body}"
    return hashlib.sha256(payload.encode()).hexdigest()


def categorization_cache_doc_id(
    login_id: str, llm_provider: str, student_fp: str, email_fp: str
) -> str:
    raw = f"{login_id}\0{llm_provider}\0{student_fp}\0{email_fp}".encode()
    return hashlib.sha256(raw).hexdigest()


def categorization_cache_get(
    login_id: str, llm_provider: str, student_fp: str, email_fp: str
) -> tuple[str, dict[str, Any]] | None:
    """Return (model, item_fields) for a cache hit; item_fields exclude email_id."""
    db = _get_db()
    if db is None:
        return None
    _id = categorization_cache_doc_id(login_id, llm_provider, student_fp, email_fp)
    try:
        doc = db[COL_EMAIL_CAT_CACHE].find_one({"_id": _id})
    except Exception:
        logger.exception("MongoDB: categorization_cache_get failed")
        return None
    if not doc:
        return None
    model = doc.get("model")
    if not isinstance(model, str) or not model.strip():
        return None
    blob = doc.get("item")
    if not isinstance(blob, dict):
        return None
    return model, blob


def categorization_cache_upsert(
    login_id: str,
    llm_provider: str,
    student_fp: str,
    email_fp: str,
    model: str,
    item: EmailCategorizationItem,
) -> None:
    db = _get_db()
    if db is None:
        return
    _id = categorization_cache_doc_id(login_id, llm_provider, student_fp, email_fp)
    now = datetime.now(timezone.utc)
    item_blob = {
        "is_opportunity": item.is_opportunity,
        "opportunity_type": item.opportunity_type,
        "relevance_score": item.relevance_score,
        "profile_fit_label": item.profile_fit_label,
        "rationale": item.rationale,
        "deadlines": list(item.deadlines),
        "eligibility": list(item.eligibility),
        "required_documents": list(item.required_documents),
        "application_url": item.application_url,
        "contact_email": item.contact_email,
        "priority_rank": int(item.priority_rank),
        "action_suggestions": list(item.action_suggestions),
        "evidence_quotes": list(item.evidence_quotes),
        "scoring": item.scoring.model_dump(mode="json") if item.scoring is not None else None,
    }
    doc = {
        "_id": _id,
        "login_id": login_id,
        "llm_provider": llm_provider,
        "student_fp": student_fp,
        "email_fp": email_fp,
        "model": model,
        "item": item_blob,
        "updated_at": now,
    }
    try:
        db[COL_EMAIL_CAT_CACHE].replace_one({"_id": _id}, doc, upsert=True)
    except Exception:
        logger.exception("MongoDB: categorization_cache_upsert failed")


def categorization_cache_delete(
    login_id: str,
    llm_provider: str,
    student_fp: str,
    email_fp: str,
) -> None:
    db = _get_db()
    if db is None:
        return
    _id = categorization_cache_doc_id(login_id, llm_provider, student_fp, email_fp)
    try:
        db[COL_EMAIL_CAT_CACHE].delete_one({"_id": _id})
    except Exception:
        logger.exception("MongoDB: categorization_cache_delete failed")


def sync_categorization_run(
    student: StudentProfileCreate,
    emails: list[EmailRecord],
    result: BatchCategorizeResponse,
) -> None:
    db = _get_db()
    if db is None:
        return
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    items = [
        {
            "email_id": str(it.email_id),
            "is_opportunity": it.is_opportunity,
            "opportunity_type": it.opportunity_type,
            "relevance_score": it.relevance_score,
            "profile_fit_label": it.profile_fit_label,
            "rationale": it.rationale,
            "deadlines": list(it.deadlines),
            "eligibility": list(it.eligibility),
            "required_documents": list(it.required_documents),
            "application_url": it.application_url,
            "contact_email": it.contact_email,
            "priority_rank": int(it.priority_rank),
            "action_suggestions": list(it.action_suggestions),
            "evidence_quotes": list(it.evidence_quotes),
            "scoring": it.scoring.model_dump(mode="json") if it.scoring is not None else None,
        }
        for it in result.items
    ]
    doc = {
        "_id": run_id,
        "login_id": student.login_id,
        "model": result.model,
        "created_at": now,
        "student_snapshot": student.model_dump(mode="json"),
        "emails": _email_rows_for_cat(emails),
        "items": items,
        "batch_suggestions": list(result.batch_suggestions),
    }
    try:
        db[COL_CAT_RUNS].insert_one(doc)
    except Exception:
        logger.exception("MongoDB: failed to insert categorization_runs")


def demo_inbox_upsert_packaged(
    emails: list[dict[str, Any]],
    student: dict[str, Any],
    *,
    demo_gmail_email: str | None = None,
    history_id: str | None = None,
    raw_manifest: dict[str, Any] | None = None,
) -> datetime:
    """Persist packaged demo inbox (Gmail-shaped JSON normalized to canonical email rows)."""
    db = _get_db()
    if db is None:
        raise RuntimeError("MongoDB is not configured (set MONGODB_URI).")
    now = datetime.now(timezone.utc)
    doc: dict[str, Any] = {
        "_id": "packaged",
        "updated_at": now,
        "emails": emails,
        "student": student,
        "demo_gmail_email": demo_gmail_email,
        "history_id": history_id,
        "raw_manifest": raw_manifest or {},
    }
    db[COL_DEMO_INBOX].replace_one({"_id": "packaged"}, doc, upsert=True)
    return now


def demo_inbox_get() -> dict[str, Any] | None:
    db = _get_db()
    if db is None:
        return None
    try:
        doc = db[COL_DEMO_INBOX].find_one({"_id": "packaged"})
    except Exception:
        logger.exception("MongoDB: demo_inbox_get failed")
        return None
    if not doc:
        return None
    return dict(doc)


def email_chunks_delete_for_owner(owner_key: str) -> None:
    db = _get_db()
    if db is None:
        return
    try:
        db[COL_EMAIL_CHUNKS].delete_many({"owner_key": owner_key})
    except Exception:
        logger.exception("MongoDB: email_chunks_delete_for_owner failed")


def email_chunks_replace_owner(owner_key: str, docs: list[dict[str, Any]]) -> None:
    db = _get_db()
    if db is None:
        raise RuntimeError("MongoDB is not configured (set MONGODB_URI).")
    try:
        db[COL_EMAIL_CHUNKS].delete_many({"owner_key": owner_key})
        if docs:
            db[COL_EMAIL_CHUNKS].insert_many(docs)
    except Exception:
        logger.exception("MongoDB: email_chunks_replace_owner failed")
        raise


def email_chunks_list_for_owner(owner_key: str) -> list[dict[str, Any]]:
    db = _get_db()
    if db is None:
        return []
    try:
        cur = db[COL_EMAIL_CHUNKS].find({"owner_key": owner_key})
        return list(cur)
    except Exception:
        logger.exception("MongoDB: email_chunks_list_for_owner failed")
        return []


def read_latest_snapshot(login_id: str | None = None) -> dict[str, Any]:
    if not mongo_configured():
        return {
            "configured": False,
            "has_data": False,
            "student": None,
            "run": None,
            "emails": [],
            "items": [],
            "model": None,
        }
    db = _get_db()
    if db is None:
        return {
            "configured": False,
            "has_data": False,
            "student": None,
            "run": None,
            "emails": [],
            "items": [],
            "model": None,
        }
    try:
        q_student: dict[str, Any] = {}
        if login_id:
            q_student["login_id"] = login_id
        student_doc = db[COL_STUDENTS].find_one(q_student or {}, sort=[("created_at", -1)])
        student = None
        if student_doc:
            student = {k: v for k, v in student_doc.items() if k != "_id"}
            student["id"] = str(student_doc["_id"])

        q_run: dict[str, Any] = {}
        if login_id:
            q_run["login_id"] = login_id
        run = db[COL_CAT_RUNS].find_one(q_run or {}, sort=[("created_at", -1)])
        if not run:
            return {
                "configured": True,
                "has_data": bool(student_doc),
                "login_id": login_id,
                "student": student,
                "run": None,
                "emails": [],
                "items": [],
                "model": None,
            }

        emails = run.get("emails") or []
        items = run.get("items") or []
        return {
            "configured": True,
            "has_data": True,
            "login_id": run.get("login_id") or login_id,
            "student": run.get("student_snapshot") or student,
            "run": {"id": str(run["_id"]), "created_at": run.get("created_at")},
            "emails": emails,
            "items": items,
            "model": run.get("model"),
            "batch_suggestions": list(run.get("batch_suggestions") or []),
        }
    except Exception:
        logger.exception("MongoDB: failed reading latest snapshot")
        return {
            "configured": True,
            "has_data": False,
            "login_id": login_id,
            "student": None,
            "run": None,
            "emails": [],
            "items": [],
            "model": None,
            "error": "Failed reading latest snapshot from MongoDB",
        }


def sucuri_sitecheck_cache_key(normalized_url: str) -> str:
    return hashlib.sha256(normalized_url.strip().encode()).hexdigest()


def sucuri_sitecheck_cache_get(normalized_url: str) -> dict[str, Any] | None:
    db = _get_db()
    if db is None:
        return None
    _id = sucuri_sitecheck_cache_key(normalized_url)
    try:
        doc = db[COL_SUCURI_CACHE].find_one({"_id": _id})
    except Exception:
        logger.exception("MongoDB: sucuri_sitecheck_cache_get failed")
        return None
    if not doc:
        return None
    payload = doc.get("payload")
    return payload if isinstance(payload, dict) else None


def sucuri_sitecheck_cache_put(normalized_url: str, payload: dict[str, Any]) -> None:
    db = _get_db()
    if db is None:
        return
    _id = sucuri_sitecheck_cache_key(normalized_url)
    now = datetime.now(timezone.utc)
    doc = {
        "_id": _id,
        "url": normalized_url[:2048],
        "payload": payload,
        "updated_at": now,
    }
    try:
        db[COL_SUCURI_CACHE].replace_one({"_id": _id}, doc, upsert=True)
    except Exception:
        logger.exception("MongoDB: sucuri_sitecheck_cache_put failed")


def safe_browsing_cache_key(normalized_url: str) -> str:
    return hashlib.sha256(normalized_url.strip().encode()).hexdigest()


def safe_browsing_cache_get(normalized_url: str) -> dict[str, Any] | None:
    db = _get_db()
    if db is None:
        return None
    _id = safe_browsing_cache_key(normalized_url)
    try:
        doc = db[COL_SAFE_BROWSING_CACHE].find_one({"_id": _id})
    except Exception:
        logger.exception("MongoDB: safe_browsing_cache_get failed")
        return None
    if not doc:
        return None
    payload = doc.get("payload")
    return payload if isinstance(payload, dict) else None


def safe_browsing_cache_put(normalized_url: str, payload: dict[str, Any]) -> None:
    db = _get_db()
    if db is None:
        return
    _id = safe_browsing_cache_key(normalized_url)
    now = datetime.now(timezone.utc)
    doc = {
        "_id": _id,
        "url": normalized_url[:2048],
        "payload": payload,
        "updated_at": now,
    }
    try:
        db[COL_SAFE_BROWSING_CACHE].replace_one({"_id": _id}, doc, upsert=True)
    except Exception:
        logger.exception("MongoDB: safe_browsing_cache_put failed")
