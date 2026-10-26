
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class FormSubmissionCreate(BaseModel):
    responses: dict[str, Any] = Field(max_length=100)


class FormSubmissionReview(BaseModel):
    status: Literal[
        "new",
        "reviewing",
        "approved",
        "rejected",
        "resolved",
        "spam",
    ]
    review_data: dict[str, Any] = Field(default_factory=dict, max_length=100)


class FormSubmissionReceipt(BaseModel):
    id: UUID
    status: str
    message: str = "Form submitted successfully"


class FormSubmissionResponse(BaseModel):
    id: UUID
    page_id: UUID
    form_slug: str
    lang: str
    responses: dict[str, Any]
    review_fields: list[dict[str, Any]]
    review_data: dict[str, Any]
    status: str
    reviewed_by_id: UUID | None
    reviewed_at: datetime | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
