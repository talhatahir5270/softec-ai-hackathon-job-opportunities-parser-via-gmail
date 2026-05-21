from typing import Any, Literal

from pydantic import BaseModel, Field


class EmailChatReindexBody(BaseModel):
    """When empty and Gmail session is valid, server loads emails from the stored inbox cache."""

    emails: list[dict[str, Any]] = Field(default_factory=list)


class EmailChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class EmailChatRequest(BaseModel):
    messages: list[EmailChatMessage] = Field(min_length=1)
