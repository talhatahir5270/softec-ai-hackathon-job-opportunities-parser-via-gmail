import random as _random
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.student import StudentProfileCreate


class ScoringWeights(BaseModel):
    """Fixed rubric weights (must sum to 1.0)."""

    profile_fit: float = 0.5
    urgency: float = 0.3
    completeness: float = 0.2


class ScoringBreakdown(BaseModel):
    """Deterministic sub-scores attached after LLM extraction (see `ranking_engine`)."""

    profile_fit_score: float = Field(ge=0.0, le=1.0)
    urgency_score: float = Field(ge=0.0, le=1.0)
    completeness_score: float = Field(ge=0.0, le=1.0)
    final_score: float = Field(ge=0.0, le=1.0)
    days_until_deadline: int | None = None
    nearest_deadline: str | None = None
    weights: ScoringWeights = Field(default_factory=ScoringWeights)
    notes: list[str] = Field(default_factory=list)


class EmailRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    from_: str = Field(alias="from")
    subject: str
    date: str
    body: str


class EmailCategorizationItem(BaseModel):
    email_id: str
    is_opportunity: bool
    opportunity_type: str
    relevance_score: float = Field(ge=0.0, le=1.0)
    profile_fit_label: str
    rationale: str
    deadlines: list[str] = Field(
        default_factory=list,
        description="Application/event dates as YYYY-MM-DD extracted from the email.",
    )
    eligibility: list[str] = Field(
        default_factory=list,
        description="Short bullet points of eligibility criteria (e.g. 'Min CGPA 3.0', 'BS CS final-year').",
    )
    required_documents: list[str] = Field(
        default_factory=list,
        description="Documents the application asks for (e.g. 'Transcripts', 'SOP', 'CV').",
    )
    application_url: str | None = Field(
        default=None,
        description="Primary application / registration URL extracted from the email, if any.",
    )
    contact_email: str | None = Field(
        default=None,
        description="Primary point-of-contact email address extracted from the message, if any.",
    )
    priority_rank: int = Field(
        default=0,
        ge=0,
        le=99,
        description="Among opportunities in this batch: 1 = highest priority, 0 = not ranked.",
    )
    action_suggestions: list[str] = Field(
        default_factory=list,
        description="Short next-step hints for this email (e.g. take IELTS, add a course).",
    )
    evidence_quotes: list[str] = Field(
        default_factory=list,
        description="Verbatim substrings from the email body that support the rationale (for UI highlights).",
    )
    scoring: ScoringBreakdown | None = Field(
        default=None,
        description="Team deterministic score; set by apply_ranking after LLM output.",
    )

    @field_validator("opportunity_type", mode="before")
    @classmethod
    def _opportunity_type_non_null(cls, v: object) -> str:
        if v is None or (isinstance(v, str) and not v.strip()):
            return "none"
        return str(v)

    @field_validator("profile_fit_label", "rationale", mode="before")
    @classmethod
    def _string_fields_non_null(cls, v: object) -> str:
        if v is None:
            return ""
        return str(v)

    @field_validator("deadlines", mode="before")
    @classmethod
    def _deadlines_iso(cls, v: object) -> list[str]:
        if v is None:
            return []
        if not isinstance(v, list):
            return []
        out: list[str] = []
        for x in v[:12]:
            s = str(x).strip().replace("/", "-")[:32]
            parts = [p for p in s.split("-") if p.strip().isdigit()]
            if len(parts) < 3:
                continue
            try:
                y, mo, da = int(parts[0]), int(parts[1]), int(parts[2])
                date(y, mo, da)
            except (ValueError, IndexError):
                continue
            out.append(f"{y:04d}-{mo:02d}-{da:02d}")
        return out

    @field_validator("eligibility", "required_documents", mode="before")
    @classmethod
    def _short_string_list(cls, v: object) -> list[str]:
        if v is None or not isinstance(v, list):
            return []
        out: list[str] = []
        for x in v[:10]:
            s = str(x).strip()
            if len(s) > 200:
                s = s[:200]
            if s:
                out.append(s)
        return out

    @field_validator("application_url", mode="before")
    @classmethod
    def _application_url_str(cls, v: object) -> str | None:
        if v is None:
            return None
        s = str(v).strip()
        if not s or s.lower() in ("none", "null", "n/a"):
            return None
        if not (s.startswith("http://") or s.startswith("https://")):
            return None
        return s[:500]

    @field_validator("contact_email", mode="before")
    @classmethod
    def _contact_email_str(cls, v: object) -> str | None:
        if v is None:
            return None
        s = str(v).strip()
        if not s or "@" not in s or " " in s:
            return None
        return s[:200]

    @field_validator("priority_rank", mode="before")
    @classmethod
    def _priority_rank_bounds(cls, v: object) -> int:
        if v is None:
            return 0
        try:
            i = int(v)
        except (TypeError, ValueError):
            return 0
        return max(0, min(99, i))

    @field_validator("action_suggestions", mode="before")
    @classmethod
    def _action_suggestions_list(cls, v: object) -> list[str]:
        if v is None:
            return []
        if not isinstance(v, list):
            return []
        out: list[str] = []
        for x in v[:8]:
            s = str(x).strip()
            if len(s) > 400:
                s = s[:400]
            if s:
                out.append(s)
        return out

    @field_validator("evidence_quotes", mode="before")
    @classmethod
    def _evidence_quotes_list(cls, v: object) -> list[str]:
        if v is None:
            return []
        if not isinstance(v, list):
            return []
        out: list[str] = []
        for x in v[:8]:
            s = str(x).strip()
            if len(s) > 500:
                s = s[:500]
            if s:
                out.append(s)
        return out

    @field_validator("scoring", mode="before")
    @classmethod
    def _scoring_optional(cls, v: object) -> object:
        if v is None or v == {}:
            return None
        return v


class BatchCategorizeRequest(BaseModel):
    student: StudentProfileCreate
    emails: list[EmailRecord]
    llm_provider: Literal["groq", "gemini"] = "groq"
    force_refresh: bool = Field(
        default=False,
        description="When true, skip per-email Mongo cache for this request and re-run the LLM.",
    )

    @field_validator("llm_provider", mode="before")
    @classmethod
    def _normalize_llm_provider(cls, v: object) -> str:
        if v in (None, ""):
            return "groq"
        s = str(v)
        if s in ("openai", "grok"):
            return "groq"
        return s


class BatchCategorizeResponse(BaseModel):
    items: list[EmailCategorizationItem]
    model: str
    batch_suggestions: list[str] = Field(
        default_factory=list,
        description="Cross-email next steps for the student (profile gaps, prep, deadlines).",
    )
    random: float = Field(
        default_factory=_random.random,
        description="Nonce that changes on every HTTP response, including cache hits.",
    )
