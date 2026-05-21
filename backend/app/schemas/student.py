from datetime import datetime
from uuid import UUID

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


class StudentProfileCreate(BaseModel):
    login_id: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    degree: Degree
    semester: Semester
    cgpa: float = Field(ge=0.0, le=4.0)
    skills: list[Skill]
    interests: list[Interest]
    preferred_opportunity_types: list[OpportunityType]
    location_preference: list[LocationPreference]
    financial_need: FinancialNeed
    availability: Availability
    experience_level: ExperienceLevel


class StudentProfileStored(StudentProfileCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
