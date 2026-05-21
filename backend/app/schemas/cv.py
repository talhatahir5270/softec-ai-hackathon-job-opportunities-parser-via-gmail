from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import (
    Availability,
    Degree,
    ExperienceLevel,
    FinancialNeed,
    Interest,
    LocationPreference,
    OpportunityType,
    Semester,
    Skill,
)


class CvSuggestedProfile(BaseModel):
    """Partial profile inferred from CV text; omit unknown fields."""

    model_config = ConfigDict(extra="ignore")

    login_id: str | None = Field(
        default=None,
        min_length=3,
        max_length=64,
        pattern=r"^[A-Za-z0-9._-]+$",
    )
    degree: Degree | None = None
    semester: Semester | None = None
    cgpa: float | None = Field(default=None, ge=0.0, le=4.0)
    skills: list[Skill] | None = None
    interests: list[Interest] | None = None
    preferred_opportunity_types: list[OpportunityType] | None = None
    location_preference: list[LocationPreference] | None = None
    financial_need: FinancialNeed | None = None
    availability: Availability | None = None
    experience_level: ExperienceLevel | None = None


class CvExtractResponse(BaseModel):
    suggested: CvSuggestedProfile
    text_char_count: int
    text_used_chars: int
    text_truncated: bool
    text_preview: str
    model: str
    notes: str = ""
