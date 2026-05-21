"""Chunk inbox emails, embed locally (fastembed), persist vectors in MongoDB for RAG."""

from __future__ import annotations

import logging
import math
import uuid
from datetime import datetime, timezone
from typing import Any

from app.services import local_embeddings, mongo_store
from app.services.stopword_compact import compact_english_for_llm

logger = logging.getLogger(__name__)

CHUNK_CHARS = 2000
CHUNK_OVERLAP = 200
MAX_CHUNKS_PER_EMAIL = 24


def owner_key_from_gmail(session_public_id: str) -> str:
    return f"gmail:{session_public_id.strip()}"


def owner_key_from_login(login_id: str) -> str:
    return f"login:{login_id.strip()}"


def owner_key_from_demo(login_id: str) -> str:
    """RAG / embeddings scope for packaged demo inbox (Mongo-backed)."""
    return f"demo:{login_id.strip()}"


def _chunk_text(body: str) -> list[str]:
    body = (body or "").strip()
    if not body:
        return [""]
    if len(body) <= CHUNK_CHARS:
        return [body]
    parts: list[str] = []
    start = 0
    while start < len(body) and len(parts) < MAX_CHUNKS_PER_EMAIL:
        end = min(start + CHUNK_CHARS, len(body))
        parts.append(body[start:end])
        if end >= len(body):
            break
        start = max(0, end - CHUNK_OVERLAP)
    return parts


def _email_dict_to_rows(email: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """Return list of (text_for_embedding, metadata dict])."""
    eid = str(email.get("id") or "").strip() or str(uuid.uuid4())
    from_ = str(email.get("from") or "")
    subject = str(email.get("subject") or "")
    date = str(email.get("date") or "")
    body = str(email.get("body") or "")
    chunks = _chunk_text(body)
    rows: list[tuple[str, dict[str, Any]]] = []
    for ix, piece in enumerate(chunks):
        subj_c = compact_english_for_llm(subject) or subject
        piece_c = compact_english_for_llm(piece) or piece
        header = f"From: {from_}\nSubject: {subj_c}\nDate: {date}\nEmail id: {eid}\n"
        text = f"{header}\n{piece_c}".strip()
        meta = {
            "email_id": eid,
            "chunk_ix": ix,
            "from": from_,
            "subject": subject,
            "date": date,
        }
        rows.append((text, meta))
    return rows


def sync_email_chunks_for_owner(owner_key: str, emails: list[dict[str, Any]]) -> dict[str, Any]:
    """Replace all stored chunks+embeddings for this owner. Returns stats dict."""
    if not mongo_store.mongo_configured():
        raise RuntimeError("MongoDB is not configured (set MONGODB_URI).")

    flat_texts: list[str] = []
    flat_meta: list[dict[str, Any]] = []
    for email in emails:
        if not isinstance(email, dict):
            continue
        for text, meta in _email_dict_to_rows(email):
            flat_texts.append(text)
            flat_meta.append(meta)

    if not flat_texts:
        mongo_store.email_chunks_delete_for_owner(owner_key)
        return {"owner_key": owner_key, "chunks": 0, "embedding_model": None}

    vectors, emb_model = local_embeddings.embed_texts_sync(flat_texts)
    if len(vectors) != len(flat_texts):
        raise RuntimeError("Embedding count does not match chunk count")

    now = datetime.now(timezone.utc)
    docs: list[dict[str, Any]] = []
    for vec, meta, txt in zip(vectors, flat_meta, flat_texts):
        docs.append(
            {
                "_id": str(uuid.uuid4()),
                "owner_key": owner_key,
                "email_id": meta["email_id"],
                "chunk_ix": meta["chunk_ix"],
                "from": meta["from"],
                "subject": meta["subject"],
                "date": meta["date"],
                "text": txt,
                "embedding": vec,
                "embedding_model": emb_model,
                "updated_at": now,
            }
        )

    mongo_store.email_chunks_replace_owner(owner_key, docs)
    return {"owner_key": owner_key, "chunks": len(docs), "embedding_model": emb_model}


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b, strict=True):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def retrieve_chunks(owner_key: str, query_embedding: list[float], *, top_k: int = 10) -> list[dict[str, Any]]:
    rows = mongo_store.email_chunks_list_for_owner(owner_key)
    scored: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        emb = row.get("embedding")
        if not isinstance(emb, list):
            continue
        try:
            sim = cosine_similarity(query_embedding, [float(x) for x in emb])
        except (TypeError, ValueError):
            continue
        scored.append((sim, row))
    scored.sort(key=lambda t: t[0], reverse=True)
    return [r for _, r in scored[:top_k]]
