from pydantic import BaseModel
from typing import Optional, Dict, Any
from uuid import UUID
from datetime import datetime


class AuditLogResponse(BaseModel):
    id: UUID
    user_id: Optional[UUID] = None
    user_name: str
    action: str
    target: str
    target_type: Optional[str] = None
    target_id: Optional[UUID] = None
    meta: Optional[Dict[str, Any]] = None
    ip_address: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AuditLogPage(BaseModel):
    items: list[AuditLogResponse]
    total: int
