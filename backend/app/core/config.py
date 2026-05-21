from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/core/config.py -> parents[2] == backend/ (always load this .env)
_BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(_BACKEND_DIR / ".env"), ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    PROJECT_NAME: str = "KhushPush404 API"
    API_V1_STR: str = "/api/v1"
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]
    # Groq — OpenAI-compatible Chat Completions (https://console.groq.com/). Uses `openai` SDK with base_url.
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.1-8b-instant"
    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"
    GROQ_VERIFY_SSL: bool = True
    GROQ_CA_BUNDLE: str = ""
    # Inbox RAG chat: Groq on-demand tier is often ~6k TPM per request — cap prompt size (chars ≈ conservative token proxy).
    GROQ_RAG_MAX_INPUT_CHARS: int = 9_000
    GROQ_RAG_TOP_K: int = 5
    GROQ_RAG_SNIPPET_BODY_CHARS: int = 650
    GROQ_RAG_MAX_HISTORY_MESSAGES: int = 10
    GROQ_RAG_MAX_MESSAGE_CHARS: int = 700
    GROQ_RAG_MAX_COMPLETION_TOKENS: int = 768

    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.0-flash"
    # Inbox RAG: free local ONNX embedder (fastembed). See https://qdrant.github.io/fastembed/
    FREE_EMBEDDING_MODEL: str = "BAAI/bge-small-en-v1.5"

    # MongoDB — all app persistence (local: mongodb://127.0.0.1:27017, db KhushPush).
    MONGODB_URI: str = "mongodb://127.0.0.1:27017"
    MONGODB_DB_NAME: str = "KhushPush"

    # CV upload: max characters sent to the LLM (full PDF text may be longer).
    CV_TEXT_MAX_CHARS: int = 14_000
    GOOGLE_CLIENT_ID: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_CLIENT_ID", "CLIENT_ID"),
    )
    GOOGLE_CLIENT_SECRET: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_CLIENT_SECRET", "CLIENT_SECRET", "CLIENT_SECRET_KEY"),
    )
    # Google Safe Browsing v4 (https://developers.google.com/safe-browsing) — link checks in inbox.
    GOOGLE_SAFE_BROWSING_API_KEY: str = ""

    # Must match an authorized redirect URI in Google Cloud Console (same host/port as this API).
    GOOGLE_REDIRECT_URI: str = "http://127.0.0.1:8000/auth/callback"
    # After OAuth, user is sent here with ?gmail_session=<public_id> (stored in sessionStorage by the SPA).
    FRONTEND_OAUTH_SUCCESS_URL: str = "http://localhost:3000/inbox"


settings = Settings()
