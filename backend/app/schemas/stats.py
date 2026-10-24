from pydantic import BaseModel
from typing import List, Optional
from uuid import UUID


class SectionStat(BaseModel):
    name: str
    total: int
    with_text: int


class LangStat(BaseModel):
    lang: str
    published: int = 0
    pending: int = 0
    draft: int = 0
    rejected: int = 0
    total: int = 0


class CountStat(BaseModel):
    label: str
    count: int


class GroupStat(BaseModel):
    id: UUID
    name: str
    count: int


class PendingItem(BaseModel):
    id: UUID
    title: str
    submitted_by: Optional[str] = None
    waiting_days: int
    group: Optional[str] = None


class StatsResponse(BaseModel):
    total_pages: int
    published: int
    pending: int
    draft: int
    rejected: int
    oldest_pending_days: int
    pages_with_text: int
    coverage_pct: int
    groups: int
    max_depth: int
    volunteers: int
    admins: int
    by_section: List[SectionStat]
    translations: List[LangStat]
    contributors: List[CountStat]
    activity_by_action: List[CountStat]
    activity_by_user: List[CountStat]
    largest_groups: List[GroupStat]
    approval_queue: List[PendingItem]
