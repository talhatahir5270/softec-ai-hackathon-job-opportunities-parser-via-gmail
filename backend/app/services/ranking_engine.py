"""Deterministic opportunity ranking (SOFTEC brief): combines profile fit, deadline urgency, extraction completeness."""

from __future__ import annotations

import math
from datetime import date, datetime, timezone

from app.schemas.email import EmailCategorizationItem, ScoringBreakdown, ScoringWeights

W_PROFILE_FIT = 0.5
W_URGENCY = 0.3
W_COMPLETENESS = 0.2

assert abs(W_PROFILE_FIT + W_URGENCY + W_COMPLETENESS - 1.0) < 1e-9

WEIGHTS = ScoringWeights(profile_fit=W_PROFILE_FIT, urgency=W_URGENCY, completeness=W_COMPLETENESS)

# Weighted extraction completeness (must sum to 1.0). Pairs with LLM + rubric fields.
COMPLETENESS_WEIGHTS: dict[str, float] = {
    "deadline": 0.18,
    "rationale": 0.10,
    "opportunity_type": 0.14,
    "relevance_signal": 0.14,
    "action_suggestions": 0.14,
    "eligibility": 0.10,
    "required_documents": 0.10,
    "application_url": 0.05,
    "contact_email": 0.05,
}

assert abs(sum(COMPLETENESS_WEIGHTS.values()) - 1.0) < 1e-9

PROFILE_FIT_MAP: dict[str, float] = {
    "strong_match": 1.0,
    "moderate_match": 0.7,
    "weak_match": 0.4,
    "not_an_opportunity": 0.0,
    "irrelevant": 0.0,
}


def _normalize_fit_label(label: str) -> str:
    return (label or "").strip().lower().replace(" ", "_").replace("-", "_")


def profile_fit_numeric(profile_fit_label: str) -> float:
    key = _normalize_fit_label(profile_fit_label)
    if key in PROFILE_FIT_MAP:
        return PROFILE_FIT_MAP[key]
    if "strong" in key:
        return 1.0
    if "moderate" in key:
        return 0.7
    if "weak" in key:
        return 0.4
    if "not" in key and "opport" in key:
        return 0.0
    return 0.35


def _today_utc() -> date:
    return datetime.now(timezone.utc).date()


def _nearest_deadline_info(
    deadlines: list[str],
    today: date,
) -> tuple[str | None, int | None]:
    """Pick nearest calendar deadline; return (iso, days_until) using days >= 0 for urgency (overdue → 0)."""
    best_future: tuple[date, str] | None = None
    best_any: tuple[date, str] | None = None
    for raw in deadlines:
        s = (raw or "").strip()[:10]
        parts = s.split("-")
        if len(parts) < 3:
            continue
        try:
            y, mo, d = int(parts[0]), int(parts[1]), int(parts[2])
            dt = date(y, mo, d)
        except (ValueError, TypeError):
            continue
        iso = f"{y:04d}-{mo:02d}-{d:02d}"
        if best_any is None or dt < best_any[0]:
            best_any = (dt, iso)
        if dt >= today and (best_future is None or dt < best_future[0]):
            best_future = (dt, iso)

    if best_future is not None:
        days = (best_future[0] - today).days
        return best_future[1], max(0, days)
    if best_any is not None:
        days = (best_any[0] - today).days
        return best_any[1], max(0, days)
    return None, None


def urgency_from_days(days: int | None) -> float:
    if days is None:
        return 0.0
    return float(math.exp(-days / 14.0))


def compute_completeness_score(item: EmailCategorizationItem) -> tuple[float, list[str]]:
    """Weighted sum of nine extraction signals (see COMPLETENESS_WEIGHTS)."""
    present: dict[str, bool] = {
        "deadline": len(item.deadlines) > 0,
        "rationale": len((item.rationale or "").strip()) >= 24,
        "opportunity_type": bool((item.opportunity_type or "").strip())
        and (item.opportunity_type or "").strip().lower() != "none",
        "relevance_signal": float(item.relevance_score) >= 0.40,
        "action_suggestions": len(item.action_suggestions) > 0,
        "eligibility": len(item.eligibility) > 0,
        "required_documents": len(item.required_documents) > 0,
        "application_url": bool(item.application_url),
        "contact_email": bool(item.contact_email),
    }
    total = sum(COMPLETENESS_WEIGHTS[k] for k, ok in present.items() if ok)
    notes = [
        f"Weighted completeness (sum of hit weights): {total:.3f}",
        *[
            f"  {k}: +{COMPLETENESS_WEIGHTS[k]:.2f}" if present[k] else f"  {k}: +0.00 (missing)"
            for k in COMPLETENESS_WEIGHTS
        ],
    ]
    return total, notes


def score_item(item: EmailCategorizationItem, *, today: date | None = None) -> EmailCategorizationItem:
    today_d = today or _today_utc()
    pf = profile_fit_numeric(item.profile_fit_label)
    nearest, days_until = _nearest_deadline_info(list(item.deadlines), today_d)
    urg = urgency_from_days(days_until)
    comp, comp_notes = compute_completeness_score(item)

    notes: list[str] = [
        f"Profile fit ({item.profile_fit_label}): {pf:.2f}",
        f"Urgency exp(-days/14), days={days_until}: {urg:.3f}",
        f"Completeness (9 weighted signals, see tooltip notes): {comp:.3f}",
    ]
    notes.extend(comp_notes)

    if not item.is_opportunity:
        breakdown = ScoringBreakdown(
            profile_fit_score=round(pf, 4),
            urgency_score=round(urg, 4),
            completeness_score=round(comp, 4),
            final_score=0.0,
            days_until_deadline=days_until,
            nearest_deadline=nearest,
            weights=WEIGHTS,
            notes=notes + ["Not an opportunity — final score clamped to 0.0"],
        )
        return item.model_copy(update={"scoring": breakdown, "priority_rank": 0})

    final = W_PROFILE_FIT * pf + W_URGENCY * urg + W_COMPLETENESS * comp
    final = max(0.0, min(1.0, final))
    breakdown = ScoringBreakdown(
        profile_fit_score=round(pf, 4),
        urgency_score=round(urg, 4),
        completeness_score=round(comp, 4),
        final_score=round(final, 4),
        days_until_deadline=days_until,
        nearest_deadline=nearest,
        weights=WEIGHTS,
        notes=notes,
    )
    return item.model_copy(update={"scoring": breakdown, "priority_rank": 0})


def apply_ranking(items: list[EmailCategorizationItem]) -> list[EmailCategorizationItem]:
    """Attach deterministic scores and overwrite `priority_rank` (1..N for opportunities, 0 otherwise)."""
    if not items:
        return []
    today_d = _today_utc()
    scored = [score_item(it, today=today_d) for it in items]

    opp_indices: list[int] = []
    for i, it in enumerate(scored):
        if it.is_opportunity and it.scoring is not None and it.scoring.final_score > 0:
            opp_indices.append(i)

    def sort_key(idx: int) -> tuple[float, float, float]:
        it = scored[idx]
        s = it.scoring
        assert s is not None
        days = s.days_until_deadline if s.days_until_deadline is not None else 10_000
        return (-s.final_score, float(days), -float(it.relevance_score))

    opp_indices.sort(key=sort_key)

    rank_by_index: dict[int, int] = {}
    for r, idx in enumerate(opp_indices, start=1):
        rank_by_index[idx] = min(r, 99)

    return [it.model_copy(update={"priority_rank": rank_by_index.get(i, 0)}) for i, it in enumerate(scored)]
