"""Shared system + user messages for email opportunity categorization (Groq & Gemini)."""

from __future__ import annotations

import json
from typing import Any

from app.schemas.email import EmailRecord
from app.schemas.student import StudentProfileCreate
from app.services.email_text_clean import clean_email_for_llm
from app.services.stopword_compact import compact_english_for_llm

SYSTEM_PROMPT = (
    "You categorize inbox messages for a university student. "
    "The student profile JSON uses canonical labels: degree, semester (1-8), cgpa, skills, "
    "interests (e.g. Artificial Intelligence, Web Development), preferred_opportunity_types "
    "(e.g. Internship, Hackathon, Scholarship), location_preference (Pakistan, Remote, International), "
    "financial_need (High, Medium, Low, None), availability (Immediate, Summer, Winter, Flexible), "
    "experience_level (Beginner, Intermediate, Advanced). "
    "Use it to judge relevance, fit, and whether each message is a real opportunity "
    "(scholarship, internship, hackathon, competition, fellowship, admission, exchange program, job) "
    "versus spam, promos, OTP/security, generic newsletters, or unrelated gig/client marketplaces. "
    "Return ONLY valid JSON with shape "
    '{"items":[{"email_id":"string","is_opportunity":bool,"opportunity_type":"string",'
    '"relevance_score":0-1,"profile_fit_label":"strong_match|moderate_match|weak_match|'
    'irrelevant|not_an_opportunity","rationale":"short string",'
    '"deadlines":["YYYY-MM-DD",...],"priority_rank":0,'
    '"action_suggestions":["short actionable hint",...],'
    '"eligibility":["short eligibility bullet",...],'
    '"required_documents":["Transcripts","SOP","CV",...],'
    '"application_url":"https://... or null","contact_email":"person@org.edu or null",'
    '"evidence_quotes":["verbatim substring copied from this email body",...]}],"batch_suggestions":["student-level next step",...]} '
    "action_suggestions: 0–4 short bullets for THIS email only when is_opportunity is true "
    "(e.g. prepare IELTS if English proof required, take an online course if skill gap, update CV, "
    "request transcript); use [] otherwise. "
    "batch_suggestions: 2–6 concise cross-email recommendations for the student using profile+emails "
    "(prioritize gaps vs stated requirements); use [] if nothing useful. "
    "deadlines: extract explicit calendar dates from the message (application deadlines, event dates, "
    "last day to register, interview dates). Use ISO YYYY-MM-DD only; use an empty array [] if none. "
    "eligibility: 0–6 short bullets summarizing hard requirements stated in the email "
    "(degree, CGPA, year of study, citizenship, age, skills). Use [] if absent. "
    "required_documents: 0–8 short document names mentioned as required to apply "
    "(e.g. 'Transcripts', 'SOP', 'CV', 'Recommendation letters', 'IELTS score'). Use [] if absent. "
    "application_url: the single most-relevant application / registration URL from the email body, "
    "or null if none. Must start with http:// or https://. Never invent a URL. "
    "contact_email: the most-relevant point-of-contact email address found in the email body, "
    "or null if none. Never invent an address. "
    "evidence_quotes: 0–8 short strings copied EXACTLY from the corresponding email body in the JSON you were given "
    "(same spelling, spacing, punctuation, line breaks as in the body). Each must be a contiguous substring that "
    "appears verbatim in that email's body when searched with a plain text find. Use [] if none; never paraphrase "
    "or invent quotes. Prefer lines that state deadlines, eligibility, links, or key opportunity facts. "
    "priority_rank: for items where is_opportunity is true, assign 1 = most urgent/important in THIS batch "
    "through N for the least urgent opportunity; use 0 for non-opportunities or when not applicable. "
    "opportunity_type must always be a JSON string, never null: use a real type when "
    "is_opportunity is true (e.g. Scholarship, Internship, Hackathon, Admission), "
    'otherwise use "none". Include one entry per input email id, same ids as provided.'
)


def build_categorization_user_content(student: StudentProfileCreate, emails: list[EmailRecord]) -> str:
    student_json = student.model_dump_json()
    emails_payload = [
        {
            "id": e.id,
            "from": e.from_,
            "subject": compact_english_for_llm(e.subject) or e.subject,
            "date": e.date,
            "body": clean_email_for_llm(e.body),
        }
        for e in emails
    ]
    emails_json = json.dumps(emails_payload, ensure_ascii=False)
    return f"Student profile (JSON):\n{student_json}\n\nEmails (JSON array):\n{emails_json}"


def build_categorization_messages(student: StudentProfileCreate, emails: list[EmailRecord]) -> list[dict[str, str]]:
    user = build_categorization_user_content(student, emails)
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


def build_openai_messages(student: StudentProfileCreate, emails: list[EmailRecord]) -> list[dict[str, str]]:
    """Same user payload as Groq/Gemini categorization (bodies cleaned for the LLM)."""
    return build_categorization_messages(student, emails)


def parse_optional_string_list(
    raw: Any,
    *,
    max_items: int = 12,
    max_len: int = 420,
) -> list[str]:
    """Normalize LLM JSON list of strings (batch_suggestions, etc.)."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for x in raw[:max_items]:
        s = str(x).strip()
        if len(s) > max_len:
            s = s[:max_len]
        if s and s not in out:
            out.append(s)
    return out
