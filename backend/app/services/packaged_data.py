import json
import logging
from pathlib import Path
from typing import Any

from app.services import mongo_store

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_SUBMISSION_ROOT = _BACKEND_ROOT.parent

logger = logging.getLogger(__name__)

# Short labels in older JSON -> values expected by `Interest` StrEnum
_INTEREST_ALIASES: dict[str, str] = {
    "ai": "Artificial Intelligence",
    "ml": "Artificial Intelligence",
    "web dev": "Web Development",
    "webdev": "Web Development",
    "mobile dev": "Mobile Development",
    "data science": "Data Science",
    "cyber security": "Cyber Security",
    "cybersecurity": "Cyber Security",
    "cloud": "Cloud Computing",
    "blockchain": "Blockchain",
    "game dev": "Game Development",
    "entrepreneurship": "Entrepreneurship",
    "research": "Research",
}


def _read_json(path: Path) -> Any:
    raw = path.read_text(encoding="utf-8")
    return json.loads(raw)


def email_data_file_path() -> Path:
    return _SUBMISSION_ROOT / "email_data.json"


def load_email_file_raw() -> dict[str, Any]:
    path = email_data_file_path()
    if not path.is_file():
        raise FileNotFoundError(f"Missing email_data.json at {path}")
    data = _read_json(path)
    if not isinstance(data, dict):
        raise ValueError("email_data.json must be a JSON object")
    return data


def normalize_demo_message_row(row: dict[str, Any]) -> dict[str, Any]:
    """Map Gmail API–shaped or legacy flat demo row to the canonical inbox row (same as live Gmail fetch)."""
    eid = str(row.get("id") or row.get("message_id") or "").strip()
    if not eid:
        raise ValueError("email row missing id")
    body = str(row.get("body") or "")
    if not body.strip():
        body = str(row.get("snippet") or "").strip() or "(No body in demo record.)"
    date = str(row.get("date") or "").strip()
    if not date and row.get("internalDate"):
        try:
            from datetime import datetime, timezone

            ms = int(str(row.get("internalDate"))) / 1000.0
            date = datetime.fromtimestamp(ms, tz=timezone.utc).strftime("%Y-%m-%d")
        except (ValueError, TypeError, OSError):
            date = ""
    return {
        "id": eid,
        "from": str(row.get("from") or "(unknown sender)"),
        "subject": str(row.get("subject") or "(no subject)"),
        "date": date,
        "body": body.strip(),
    }


def normalize_student_profile_dict(data: dict[str, Any]) -> dict[str, Any]:
    """Map legacy demo JSON to `StudentProfileCreate` (enums + field names)."""
    d = dict(data)
    raw_login = d.get("login_id")
    if isinstance(raw_login, str) and raw_login.strip():
        d["login_id"] = raw_login.strip()
    else:
        d["login_id"] = "demo_student"

    if "semester" not in d and "current_semester" in d:
        d["semester"] = d.pop("current_semester")

    fn = d.get("financial_need")
    if isinstance(fn, bool):
        d["financial_need"] = "High" if fn else "None"

    interests = d.get("interests")
    if isinstance(interests, list):
        out_i: list[str] = []
        for x in interests:
            if not isinstance(x, str):
                continue
            key = x.strip().lower()
            out_i.append(_INTEREST_ALIASES.get(key, x.strip()))
        d["interests"] = out_i

    opts = d.get("preferred_opportunity_types")
    if isinstance(opts, list):
        out_o: list[str] = []
        for ot in opts:
            if isinstance(ot, str) and ot.strip():
                out_o.append(ot.strip().title())
        d["preferred_opportunity_types"] = out_o

    avail = d.get("availability")
    if isinstance(avail, str) and avail.strip():
        s = avail.strip()
        d["availability"] = s.title() if s.islower() else s

    exp = d.get("experience_level")
    if isinstance(exp, str) and exp.strip():
        s = exp.strip()
        d["experience_level"] = s.title() if s.islower() else s

    return d


def load_packaged_emails() -> list[dict[str, Any]]:
    """Load `email_data.json`: supports Gmail-shaped ``messages`` or legacy ``emails`` array."""
    data = load_email_file_raw()
    raw_msgs: Any = None
    if isinstance(data.get("messages"), list):
        raw_msgs = data.get("messages")
    elif isinstance(data.get("emails"), list):
        raw_msgs = data.get("emails")
    if not isinstance(raw_msgs, list):
        raise ValueError("email_data.json must contain a `messages` or `emails` array")
    out: list[dict[str, Any]] = []
    for item in raw_msgs:
        if not isinstance(item, dict):
            continue
        try:
            out.append(normalize_demo_message_row(item))
        except ValueError:
            continue
    if not out:
        raise ValueError("No valid email rows in email_data.json")
    return out


def load_packaged_student_profile() -> dict[str, Any]:
    path = _SUBMISSION_ROOT / "student_profile_data.json"
    if not path.is_file():
        raise FileNotFoundError(f"Missing student_profile_data.json at {path}")
    raw = _read_json(path)
    if not isinstance(raw, dict):
        raise ValueError("student_profile_data.json must be a JSON object")
    return normalize_student_profile_dict(raw)


def ensure_demo_inbox_mongo_from_files() -> None:
    """Upsert packaged demo emails + student into Mongo (no-op if Mongo unavailable)."""
    if not mongo_store.mongo_configured():
        return
    try:
        raw = load_email_file_raw()
        emails = load_packaged_emails()
        student = load_packaged_student_profile()
        gmail_addr = raw.get("gmailUser")
        if not isinstance(gmail_addr, str) or not gmail_addr.strip():
            gmail_addr = "packaged.demo@khushpush.mail"
        hid = raw.get("historyId")
        if not isinstance(hid, str) or not hid.strip():
            hid = "demo-history-001"
        manifest = {k: v for k, v in raw.items() if k not in ("messages", "emails")}
        mongo_store.demo_inbox_upsert_packaged(
            emails,
            student,
            demo_gmail_email=gmail_addr.strip(),
            history_id=hid.strip(),
            raw_manifest=manifest if isinstance(manifest, dict) else {},
        )
    except Exception:
        logger.exception("ensure_demo_inbox_mongo_from_files failed")
