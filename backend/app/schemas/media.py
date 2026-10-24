from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime


class MediaFileResponse(BaseModel):
    id: UUID
    filename: str
    content_type: str
    size_bytes: int
    public_url: Optional[str] = None
    uploaded_by_id: Optional[UUID] = None
    created_at: datetime

    model_config = {"from_attributes": True}
