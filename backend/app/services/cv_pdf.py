import io

from pypdf import PdfReader


def extract_pdf_text(data: bytes) -> str:
    """Extract plain text from a PDF byte payload."""
    if not data.startswith(b"%PDF"):
        raise ValueError("Not a PDF file (missing %PDF header)")
    reader = PdfReader(io.BytesIO(data))
    parts: list[str] = []
    for page in reader.pages:
        t = page.extract_text()
        if t:
            parts.append(t)
    return "\n".join(parts).strip()
