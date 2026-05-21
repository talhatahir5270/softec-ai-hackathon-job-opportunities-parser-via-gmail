"""
Seed MongoDB with the packaged demo student + a sample categorization run.

Run from the backend directory:
    python scripts/seed_mongo_demo.py
"""

from __future__ import annotations

import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


def main() -> None:
    from app.schemas.email import BatchCategorizeResponse, EmailCategorizationItem, EmailRecord
    from app.schemas.student import StudentProfileCreate
    from app.services import mongo_store, packaged_data

    if not mongo_store.mongo_configured():
        print("MONGODB_URI is not set; cannot seed.")
        sys.exit(1)

    raw_student = packaged_data.load_packaged_student_profile()
    raw_emails = packaged_data.load_packaged_emails()
    student = StudentProfileCreate.model_validate(raw_student)
    emails = [EmailRecord.model_validate(e) for e in raw_emails]

    mongo_store.student_profile_save(student)

    items = [
        EmailCategorizationItem(
            email_id=str(e.id),
            is_opportunity=False,
            opportunity_type="none",
            relevance_score=0.0,
            profile_fit_label="seed",
            rationale="Seeded by scripts/seed_mongo_demo.py (replace with real Grok/Gemini runs from the API).",
        )
        for e in emails[:3]
    ]
    result = BatchCategorizeResponse(items=items, model="seed")
    mongo_store.sync_categorization_run(student, emails[:3], result)
    print("Seeded student_profiles and categorization_runs in MongoDB.")


if __name__ == "__main__":
    main()
