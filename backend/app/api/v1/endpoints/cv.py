from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.core.config import settings
from app.schemas.cv import CvExtractResponse
from app.services import cv_pdf, groq_cv_extract

router = APIRouter(prefix="/cv", tags=["cv"])

_MAX_BYTES = 5 * 1024 * 1024


@router.post("/extract-profile", response_model=CvExtractResponse)
async def extract_profile_from_cv(file: UploadFile = File(...)) -> CvExtractResponse:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF uploads are supported (.pdf).",
        )

    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"PDF too large (max {_MAX_BYTES // (1024 * 1024)} MB).",
        )

    try:
        text = cv_pdf.extract_pdf_text(data)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Could not read PDF: {exc}",
        ) from exc

    if not text.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No extractable text found in this PDF (it may be scanned images only).",
        )

    max_chars = settings.CV_TEXT_MAX_CHARS
    truncated = len(text) > max_chars
    used = text[:max_chars] if truncated else text

    try:
        suggested, notes = await groq_cv_extract.extract_profile_from_cv_text(used)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return groq_cv_extract.build_cv_response(
        suggested=suggested,
        notes=notes,
        full_text=text,
        used_text=used,
        truncated=truncated,
    )
