"""Free local text embeddings (ONNX via fastembed — no API keys, no paid services)."""

from __future__ import annotations

import logging
import threading
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_model: Any = None
_model_name: str | None = None


def _default_model_id() -> str:
    m = (settings.FREE_EMBEDDING_MODEL or "").strip()
    return m or "BAAI/bge-small-en-v1.5"


def _get_model() -> tuple[Any, str]:
    global _model, _model_name
    with _lock:
        if _model is not None and _model_name:
            return _model, _model_name
        try:
            from fastembed import TextEmbedding
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "The `fastembed` package is not installed. Add it to your environment: pip install fastembed"
            ) from exc

        name = _default_model_id()
        logger.info("Loading free local embedding model %s (first run may download ONNX weights)", name)
        _model = TextEmbedding(model_name=name)
        _model_name = name
        return _model, name


def embed_texts_sync(texts: list[str], *, is_query: bool = False) -> tuple[list[list[float]], str]:
    """Embed strings; returns (list of vectors, model id string).

    BGE-style models use asymmetric ``query:`` / ``passage:`` prefixes for better retrieval.
    """
    model_id = _default_model_id()
    if not texts:
        return [], model_id

    cleaned = [(t[:12_000] if t.strip() else " ") for t in texts]
    if "bge" in model_id.lower():
        if is_query:
            cleaned = [f"query: {t}" for t in cleaned]
        else:
            cleaned = [f"passage: {t}" for t in cleaned]
    model, name = _get_model()
    out: list[list[float]] = []
    for emb in model.embed(cleaned, batch_size=32):
        out.append(emb.astype("float64", copy=False).tolist())
    if len(out) != len(cleaned):
        raise RuntimeError("Local embedder returned a different number of vectors than inputs")
    return out, name
