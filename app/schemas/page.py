from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime


class PageContributorBase(BaseModel):
    name: str
    role: str


class PageContributorCreate(PageContributorBase):
    pass


class PageContributorResponse(PageContributorBase):
    id: UUID
    page_id: UUID
    created_at: datetime

    model_config = {"from_attributes": True}


class PageRevisionResponse(BaseModel):
    id: UUID
    page_id: UUID
    title: Optional[str] = None
    slug: Optional[str] = None
    content: Optional[Dict[str, Any]] = None
    content_text: Optional[str] = None
    group_id: Optional[UUID] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class PageBase(BaseModel):
    title: str
    slug: str
    group_id: UUID
    lang: str = "en"
    content: Dict[str, Any] = Field(default_factory=dict)
    excerpt: Optional[str] = None
    is_homepage: bool = False
    featured: bool = False
    position: int = 0
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    meta_keywords: Optional[List[str]] = None


class PageCreate(PageBase):
    status: str = "draft"


class PageUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    group_id: Optional[UUID] = None
    lang: Optional[str] = None
    content: Optional[Dict[str, Any]] = None
    excerpt: Optional[str] = None
    reviewer: Optional[str] = None
    position: Optional[int] = None
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    meta_keywords: Optional[List[str]] = None


class PageInDB(PageBase):
    id: UUID
    status: str
    content_text: Optional[str] = None
    reject_note: Optional[str] = None
    live_title: Optional[str] = None
    live_slug: Optional[str] = None
    live_content: Optional[Dict[str, Any]] = None
    live_content_text: Optional[str] = None
    live_group_id: Optional[UUID] = None
    translation_of_id: Optional[UUID] = None
    reviewer: Optional[str] = None
    author_id: Optional[UUID] = None
    last_edited_by_id: Optional[UUID] = None
    submitted_by_id: Optional[UUID] = None
    approved_by_id: Optional[UUID] = None
    published_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PageResponse(PageInDB):
    contributors: List[PageContributorResponse] = []
    revisions: List[PageRevisionResponse] = []


class PagePublic(BaseModel):
    id: UUID
    title: str
    slug: str
    lang: str
    content: Optional[Dict[str, Any]] = None
    content_text: Optional[str] = None
    excerpt: Optional[str] = None
    group_id: UUID
    contributors: List[PageContributorResponse] = []
    published_at: Optional[datetime] = None
    updated_at: datetime
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None

    model_config = {"from_attributes": True}


class TranslationCreate(BaseModel):
    lang: str  # hr, tr, ar


class RejectRequest(BaseModel):
    reject_note: str = "No reason given"


class ReorderRequest(BaseModel):
    page_id: UUID
    new_group_id: UUID
    position: Optional[int] = None
