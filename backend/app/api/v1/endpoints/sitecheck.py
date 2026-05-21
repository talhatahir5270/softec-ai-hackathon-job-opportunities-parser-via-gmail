"""Google Safe Browsing v4 (threatMatches:find) with optional Mongo cache per URL."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.config import settings
from app.services import mongo_store

logger = logging.getLogger(__name__)

router = APIRouter()

SAFE_BROWSING_FIND = "https://safebrowsing.googleapis.com/v4/threatMatches:find"
MAX_URLS_PER_REQUEST = 500
MAX_BATCH_BODY_URLS = 24


def _result_payload(*, safe: bool, threat_type: str | None = None) -> dict[str, Any]:
    if safe:
        return {
            "status": "SAFE",
            "threat_type": None,
            "provider": "google_safe_browsing",
        }
    tt = threat_type or "UNKNOWN_THREAT"
    return {
        "status": f"DANGER: {tt}",
        "threat_type": tt,
        "provider": "google_safe_browsing",
    }


def _try_normalize_url(raw: str) -> tuple[str | None, str | None]:
    t = raw.strip()
    if not t:
        return None, "URL is empty."
    if len(t) < 6:
        return None, "URL is too short."
    if len(t) > 2048:
        return None, "URL is too long."
    if not t.startswith(("http://", "https://")):
        t = f"https://{t.lstrip('/')}"
    return t, None


def _normalize_scan_url_query(raw: str) -> str:
    normalized, err = _try_normalize_url(raw)
    if normalized is None:
        raise HTTPException(status_code=400, detail=err or "Invalid URL")
    return normalized


class SitecheckUrlsBody(BaseModel):
    urls: list[str] = Field(default_factory=list, max_length=MAX_BATCH_BODY_URLS)


async def _call_threat_matches_find(client: httpx.AsyncClient, api_key: str, urls: list[str]) -> dict[str, str]:
    """
    Returns mapping url -> 'SAFE' or a threat type string (e.g. MALWARE).
    `urls` must be non-empty and length <= MAX_URLS_PER_REQUEST.
    """
    endpoint = f"{SAFE_BROWSING_FIND}?key={api_key}"
    payload: dict[str, Any] = {
        "client": {
            "clientId": "softec_hackathon_copilot",
            "clientVersion": "1.0.0",
        },
        "threatInfo": {
            "threatTypes": ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"],
            "platformTypes": ["ANY_PLATFORM"],
            "threatEntryTypes": ["URL"],
            "threatEntries": [{"url": u} for u in urls],
        },
    }
    r = await client.post(
        endpoint,
        json=payload,
        headers={"Content-Type": "application/json"},
        timeout=25.0,
    )
    if r.status_code != 200:
        body = (r.text or "")[:800]
        logger.warning("Safe Browsing HTTP %s: %s", r.status_code, body)
        raise HTTPException(
            status_code=502,
            detail=f"Safe Browsing returned HTTP {r.status_code}.",
        )

    try:
        data = r.json() if r.content else {}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="Safe Browsing returned non-JSON body.") from exc

    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="Unexpected Safe Browsing response shape.")

    results: dict[str, str] = {u: "SAFE" for u in urls}
    for match in data.get("matches") or []:
        if not isinstance(match, dict):
            continue
        threat = match.get("threat")
        bad_url = threat.get("url") if isinstance(threat, dict) else None
        threat_type = match.get("threatType")
        if isinstance(bad_url, str) and isinstance(threat_type, str):
            if bad_url in results:
                results[bad_url] = threat_type
            else:
                for u in urls:
                    if bad_url.rstrip("/") == u.rstrip("/") or bad_url == u:
                        results[u] = threat_type
                        break
    return results


async def _resolve_urls(urls_in: list[str]) -> dict[str, Any]:
    """
    Normalize, merge cache hits, call API for misses, write cache, return:
    { "results": { normalized_url: result_payload }, "cached": { url: bool } }
    """
    normalized_list: list[str] = []
    errors: dict[str, dict[str, Any]] = {}
    seen: set[str] = set()
    for raw in urls_in:
        n, err = _try_normalize_url(raw)
        if n is None:
            key = raw.strip()[:256] or "(empty)"
            errors[key] = {
                "status": "INVALID_URL",
                "threat_type": None,
                "provider": "google_safe_browsing",
                "error": err or "Invalid URL",
            }
            continue
        if n in seen:
            continue
        seen.add(n)
        normalized_list.append(n)

    results: dict[str, dict[str, Any]] = dict(errors)
    served_from_cache: dict[str, bool] = {}
    if not normalized_list:
        return {"results": results, "cached": served_from_cache}

    api_key = (settings.GOOGLE_SAFE_BROWSING_API_KEY or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Link safety is not configured. Set GOOGLE_SAFE_BROWSING_API_KEY in the API .env.",
        )

    to_fetch: list[str] = []

    for n in normalized_list:
        if mongo_store.mongo_configured():
            cached = await asyncio.to_thread(mongo_store.safe_browsing_cache_get, n)
            if cached is not None and isinstance(cached.get("status"), str):
                results[n] = cached
                served_from_cache[n] = True
                continue
        to_fetch.append(n)
        served_from_cache[n] = False

    if to_fetch:
        try:
            async with httpx.AsyncClient() as client:
                for i in range(0, len(to_fetch), MAX_URLS_PER_REQUEST):
                    chunk = to_fetch[i : i + MAX_URLS_PER_REQUEST]
                    threat_map = await _call_threat_matches_find(client, api_key, chunk)
                    for u in chunk:
                        threat = threat_map.get(u, "SAFE")
                        payload = _result_payload(
                            safe=(threat == "SAFE"),
                            threat_type=None if threat == "SAFE" else threat,
                        )
                        results[u] = payload
                        served_from_cache[u] = False
                        if mongo_store.mongo_configured():
                            await asyncio.to_thread(mongo_store.safe_browsing_cache_put, u, payload)
        except HTTPException:
            raise
        except httpx.RequestError as exc:
            logger.warning("Safe Browsing request error: %s", exc)
            raise HTTPException(
                status_code=502,
                detail="Could not reach Google Safe Browsing. Try again later.",
            ) from exc

    return {"results": results, "cached": served_from_cache}


@router.get("/sitecheck")
async def sitecheck_get(scan: str = Query(..., min_length=1, max_length=2048)) -> dict[str, Any]:
    """Check a single URL (query `scan=`). Cached in Mongo when configured."""
    normalized = _normalize_scan_url_query(scan)
    out = await _resolve_urls([normalized])
    res = out["results"].get(normalized)
    if res is None:
        raise HTTPException(status_code=500, detail="Unexpected empty result.")
    cached = bool(out["cached"].get(normalized))
    return {"cached": cached, "url": normalized, "result": res}


@router.post("/sitecheck")
async def sitecheck_post(body: SitecheckUrlsBody) -> dict[str, Any]:
    """Check up to 24 URLs in one Safe Browsing round-trip (plus per-URL Mongo cache)."""
    if not body.urls:
        return {"results": {}, "cached": {}}
    out = await _resolve_urls(body.urls)
    return {"results": out["results"], "cached": out["cached"]}
