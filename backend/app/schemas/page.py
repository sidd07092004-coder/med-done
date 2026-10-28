from pydantic import BaseModel, Field, field_validator, AliasChoices
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime

from app.services.sanitize import safe_href, safe_media_url


# --------------------------------------------------------------------------- #
# SEO write validators (spec §6.1).  Invalid values are cleared, never a 422:
# an editorial save must not fail because of metadata.
# --------------------------------------------------------------------------- #

META_TITLE_LIMIT = 70
META_DESCRIPTION_LIMIT = 160


def _clean_meta(value: Any, limit: int) -> Optional[str]:
    if value is None:
        return None
    return str(value).strip()[:limit]


def _clean_canonical(value: Any) -> Optional[str]:
    url = safe_href(value)
    if not url:
        return None
    lower = url.lower()
    if lower.startswith("http://") or lower.startswith("https://") or url.startswith("/"):
        return url
    return None


def _clean_robots(value: Any) -> Optional[str]:
    if value is None:
        return None
    robots = str(value).strip().lower()
    return robots if robots in {"index", "noindex"} else None


def _clean_og_image(value: Any) -> Optional[str]:
    return safe_media_url(value) or None


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
    canonical_path: Optional[str] = None
    robots: Optional[str] = None
    og_image: Optional[str] = None

    @field_validator("meta_title", mode="before")
    @classmethod
    def _validate_meta_title(cls, value):
        return _clean_meta(value, META_TITLE_LIMIT)

    @field_validator("meta_description", mode="before")
    @classmethod
    def _validate_meta_description(cls, value):
        return _clean_meta(value, META_DESCRIPTION_LIMIT)

    @field_validator("canonical_path", mode="before")
    @classmethod
    def _validate_canonical_path(cls, value):
        return _clean_canonical(value)

    @field_validator("robots", mode="before")
    @classmethod
    def _validate_robots(cls, value):
        return _clean_robots(value)

    @field_validator("og_image", mode="before")
    @classmethod
    def _validate_og_image(cls, value):
        return _clean_og_image(value)


class PageCreate(PageBase):
    status: str = "draft"


class PageUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    group_id: Optional[UUID] = None
    lang: Optional[str] = None
    content: Optional[Dict[str, Any]] = None
    excerpt: Optional[str] = None
    is_homepage: Optional[bool] = None
    featured: Optional[bool] = None
    reviewer: Optional[str] = None
    position: Optional[int] = None
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    meta_keywords: Optional[List[str]] = None
    canonical_path: Optional[str] = None
    robots: Optional[str] = None
    og_image: Optional[str] = None

    @field_validator("meta_title", mode="before")
    @classmethod
    def _validate_meta_title(cls, value):
        return _clean_meta(value, META_TITLE_LIMIT)

    @field_validator("meta_description", mode="before")
    @classmethod
    def _validate_meta_description(cls, value):
        return _clean_meta(value, META_DESCRIPTION_LIMIT)

    @field_validator("canonical_path", mode="before")
    @classmethod
    def _validate_canonical_path(cls, value):
        return _clean_canonical(value)

    @field_validator("robots", mode="before")
    @classmethod
    def _validate_robots(cls, value):
        return _clean_robots(value)

    @field_validator("og_image", mode="before")
    @classmethod
    def _validate_og_image(cls, value):
        return _clean_og_image(value)


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

    content: Optional[Dict[str, Any]] = Field(
        default=None,
        validation_alias=AliasChoices("live_content", "content"),
    )
    content_text: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("live_content_text", "content_text"),
    )

    excerpt: Optional[str] = None
    group_id: UUID
    contributors: List[PageContributorResponse] = []
    published_at: Optional[datetime] = None
    updated_at: datetime
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    canonical_path: Optional[str] = None
    robots: Optional[str] = None
    og_image: Optional[str] = None

    model_config = {"from_attributes": True}



class TranslationCreate(BaseModel):
    lang: str  # hr, tr, ar


class RejectRequest(BaseModel):
    reject_note: str = "No reason given"


class ReorderRequest(BaseModel):
    page_id: UUID
    new_group_id: UUID
    position: Optional[int] = None


class PageMoveRequest(BaseModel):
    group_id: UUID
    position: Optional[int] = None


class TranslationInfo(BaseModel):
    """Lightweight summary of a translation of a page (for the editor panel)."""
    id: UUID
    lang: str
    status: str
    reviewer: Optional[str] = None
    title: Optional[str] = None

    model_config = {"from_attributes": True}


class TranslationListResponse(BaseModel):
    """Result for GET /admin/pages/{id}/translations."""

    hr: Optional[TranslationInfo] = None
    tr: Optional[TranslationInfo] = None
    ar: Optional[TranslationInfo] = None
