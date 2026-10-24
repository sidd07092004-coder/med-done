from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime

from app.services.sanitize import _clean_text

GROUP_TRANSLATION_LANGS = {"hr", "tr", "ar"}
GROUP_TRANSLATION_MAX_CHARS = 200


def _clean_name_translations(value: Any) -> Optional[Dict[str, str]]:
    """Keep hr/tr/ar only, strip HTML/whitespace, cap length and drop empties."""
    if value is None:
        return None
    if not isinstance(value, dict):
        return {}
    cleaned: Dict[str, str] = {}
    for lang, raw in value.items():
        if not isinstance(lang, str) or lang not in GROUP_TRANSLATION_LANGS:
            continue
        text = _clean_text(raw, GROUP_TRANSLATION_MAX_CHARS).strip()[:GROUP_TRANSLATION_MAX_CHARS]
        if text:
            cleaned[lang] = text
    return cleaned


class GroupBase(BaseModel):
    name: str
    name_translations: Dict[str, str] = Field(default_factory=dict)
    parent_id: Optional[UUID] = None
    position: int = 0

    @field_validator("name_translations")
    @classmethod
    def validate_name_translations(cls, value):
        return _clean_name_translations(value) or {}


class GroupCreate(GroupBase):
    pass


class GroupUpdate(BaseModel):
    name: Optional[str] = None
    name_translations: Optional[Dict[str, str]] = None
    parent_id: Optional[UUID] = None
    position: Optional[int] = None

    @field_validator("name_translations")
    @classmethod
    def validate_name_translations(cls, value):
        return _clean_name_translations(value)


class GroupMoveRequest(BaseModel):
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
