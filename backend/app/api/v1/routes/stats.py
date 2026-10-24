from datetime import datetime, timedelta, timezone
from typing import Dict, List

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_current_active_admin
from app.crud.crud_group import crud_group
from app.crud.crud_page import crud_page
from app.crud.crud_user import crud_user
from app.models.audit import AuditLog
from app.models.contributor import PageContributor
from app.models.page import Page
from app.models.user import User
from app.services.sections import SECTIONS, section_of
from app.schemas.stats import (
    StatsResponse, SectionStat, LangStat, CountStat, GroupStat, PendingItem,
)

router = APIRouter()

LANGS = ["hr", "tr", "ar"]
LANG_NAMES = {"hr": "Croatian", "tr": "Turkish", "ar": "Arabic"}
PLACEHOLDER = "placeholder"


def _has_text(page: Page) -> bool:
    text = (page.content_text or "").strip()
    return bool(text) and PLACEHOLDER not in text.lower()


@router.get("", response_model=StatsResponse)
async def get_stats(db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    pages: List[Page] = await crud_page.get_multi(db, limit=100000)
    groups = await crud_group.get_multi_ordered(db)
    users = await crud_user.get_multi(db, limit=10000)

    english = [p for p in pages if (p.lang or "en") == "en"]
    real = [p for p in english if p.slug != "home"]
    total = len(real)

    def cnt(status: str) -> int:
        return len([p for p in english if p.status == status])

    with_text = len([p for p in real if _has_text(p)])
    coverage = round(with_text / total * 100) if total else 0

    now = datetime.now(timezone.utc)
    pending_pages = [p for p in pages if p.status == "pending"]
    oldest = 0
    for p in pending_pages:
        if p.updated_at:
            delta = (now - p.updated_at).total_seconds() / 86400
            oldest = max(oldest, int(delta))

    # Group depth + path helpers.
    group_by_id = {g.id: g for g in groups}
    children: Dict = {}
    for g in groups:
        children.setdefault(g.parent_id, []).append(g)

    def path_of(group_id) -> str:
        parts = []
        seen = set()
        gid = group_id
        while gid and gid in group_by_id and gid not in seen:
            seen.add(gid)
            g = group_by_id[gid]
            parts.insert(0, g.name)
            gid = g.parent_id
        return " / ".join(parts)

    def depth_of(group_id) -> int:
        d = 0
        gid = group_id
        seen = set()
        while gid and gid in group_by_id and gid not in seen:
            seen.add(gid)
            g = group_by_id[gid]
            if g.parent_id is None:
                break
            d += 1
            gid = g.parent_id
        return d

    def subtree_ids(group_id):
        out = {group_id}
        stack = [group_id]
        while stack:
            cur = stack.pop()
            for child in children.get(cur, []):
                if child.id not in out:
                    out.add(child.id)
                    stack.append(child.id)
        return out

    max_depth = max((depth_of(g.id) for g in groups), default=0)

    by_section = []
    for name in SECTIONS:
        ps = [p for p in english if section_of(p.slug) == name]
        by_section.append(SectionStat(name=name, total=len(ps), with_text=len([p for p in ps if _has_text(p)])))

    translations = []
    for lang in LANGS:
        lp = [p for p in pages if (p.lang or "en") == lang]
        translations.append(LangStat(
            lang=lang,
            published=len([p for p in lp if p.status == "published"]),
            pending=len([p for p in lp if p.status == "pending"]),
            draft=len([p for p in lp if p.status == "draft"]),
            rejected=len([p for p in lp if p.status == "rejected"]),
            total=len(lp),
        ))

    # Contributors (top 10 by number of English pages credited).
    contrib_result = await db.execute(
        select(PageContributor.name, func.count(PageContributor.id))
        .join(Page, Page.id == PageContributor.page_id)
        .where(Page.lang == "en")
        .group_by(PageContributor.name)
        .order_by(func.count(PageContributor.id).desc())
        .limit(10)
    )
    contributors = [CountStat(label=row[0], count=row[1]) for row in contrib_result.all()]

    # Activity in the last 7 days.
    week_ago = now - timedelta(days=7)
    logs_result = await db.execute(select(AuditLog).where(AuditLog.created_at >= week_ago))
    logs = logs_result.scalars().all()
    by_action: Dict[str, int] = {}
    by_user: Dict[str, int] = {}
    for entry in logs:
        action = (entry.action or "").split(" ")[0] or "Other"
        by_action[action] = by_action.get(action, 0) + 1
        by_user[entry.user_name] = by_user.get(entry.user_name, 0) + 1
    activity_by_action = [CountStat(label=k, count=v) for k, v in sorted(by_action.items(), key=lambda x: -x[1])]
    activity_by_user = [CountStat(label=k, count=v) for k, v in sorted(by_user.items(), key=lambda x: -x[1])]

    largest = []
    for g in groups:
        ids = subtree_ids(g.id)
        n = len([p for p in english if p.group_id in ids])
        largest.append(GroupStat(id=g.id, name=path_of(g.id), count=n))
    largest = sorted(largest, key=lambda x: -x.count)[:10]

    user_by_id = {u.id: u for u in users}
    approval_queue = []
    for p in sorted(pending_pages, key=lambda x: x.updated_at or now):
        submitted = None
        if p.submitted_by_id and p.submitted_by_id in user_by_id:
            submitted = user_by_id[p.submitted_by_id].name
        elif p.last_edited_by_id and p.last_edited_by_id in user_by_id:
            submitted = user_by_id[p.last_edited_by_id].name
        waiting = int((now - p.updated_at).total_seconds() / 86400) if p.updated_at else 0
        approval_queue.append(PendingItem(id=p.id, title=p.title, submitted_by=submitted, waiting_days=waiting, group=path_of(p.group_id)))

    return StatsResponse(
        total_pages=total,
        published=cnt("published"),
        pending=cnt("pending"),
        draft=cnt("draft"),
        rejected=cnt("rejected"),
        oldest_pending_days=oldest,
        pages_with_text=with_text,
        coverage_pct=coverage,
        groups=len(groups),
        max_depth=max_depth,
        volunteers=len([u for u in users if u.role == "volunteer"]),
        admins=len([u for u in users if u.role == "admin"]),
        by_section=by_section,
        translations=translations,
        contributors=contributors,
        activity_by_action=activity_by_action,
        activity_by_user=activity_by_user,
        largest_groups=largest,
        approval_queue=approval_queue,
    )
