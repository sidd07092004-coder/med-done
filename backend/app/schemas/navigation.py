from pydantic import BaseModel, Field
from typing import Dict, List, Optional
from uuid import UUID


class NavigationGroup(BaseModel):
    """One node of the public site-menu tree (recursive on `children`)."""

    id: UUID
    name: str
    name_translations: Dict[str, str] = Field(default_factory=dict)
    path: Optional[str] = None
    parent_id: Optional[UUID] = None
    position: int = 0
    children: List["NavigationGroup"] = Field(default_factory=list)


class NavigationPage(BaseModel):
    """Flat summary of a published page for the menu."""

    id: UUID
    title: str
    slug: str
    group_id: UUID
    position: int = 0


class NavigationResponse(BaseModel):
    """Payload for GET /api/v1/navigation."""

    lang: str
    groups: List[NavigationGroup] = Field(default_factory=list)
    pages: List[NavigationPage] = Field(default_factory=list)


NavigationGroup.model_rebuild()
