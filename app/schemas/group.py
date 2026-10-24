from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from uuid import UUID
from datetime import datetime


class GroupBase(BaseModel):
    name: str
    parent_id: Optional[UUID] = None
    position: int = 0


class GroupCreate(GroupBase):
    pass


class GroupUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[UUID] = None
    position: Optional[int] = None


class GroupInDB(GroupBase):
    id: UUID
    path: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class GroupResponse(GroupInDB):
    pass


class GroupTree(GroupResponse):
    children: List["GroupTree"] = []
    pages_count: Optional[int] = 0

GroupTree.model_rebuild()
