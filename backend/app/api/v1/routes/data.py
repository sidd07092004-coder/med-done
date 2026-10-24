import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_current_active_admin
from app.crud.crud_page import crud_page
from app.crud.crud_group import crud_group
from app.crud.crud_user import crud_user
from app.models.audit import AuditLog
from app.models.contributor import PageContributor
from app.models.group import Group
from app.models.page import Page
from app.models.revision import PageRevision
from app.models.user import User
from app.services.audit import log_action
from app.services.content_text import extract_clean_text, strip_html
from app.services.sanitize import sanitize_content

router = APIRouter()


class ImportPayload(BaseModel):
    schemaVersion: Optional[int] = None
    users: Optional[List[Dict[str, Any]]] = None
    groups: List[Dict[str, Any]] = []
    pages: List[Dict[str, Any]] = []
    log: Optional[List[Dict[str, Any]]] = None


def _page_to_dict(p: Page) -> Dict[str, Any]:
    return {
        "id": str(p.id),
        "groupId": str(p.group_id),
        "title": p.title,
        "slug": p.slug,
        "lang": p.lang,
        "status": p.status,
        "content": p.content,
        "content_text": p.content_text,
        "excerpt": p.excerpt,
        "is_homepage": p.is_homepage,
        "featured": p.featured,
        "position": p.position,
        "reviewer": p.reviewer,
        "author_id": str(p.author_id) if p.author_id else None,
        "last_edited_by_id": str(p.last_edited_by_id) if p.last_edited_by_id else None,
        "submitted_by_id": str(p.submitted_by_id) if p.submitted_by_id else None,
        "approved_by_id": str(p.approved_by_id) if p.approved_by_id else None,
        "reject_note": p.reject_note,
        "translation_of_id": str(p.translation_of_id) if p.translation_of_id else None,
        "live": None if p.live_content is None else {
            "title": p.live_title, "slug": p.live_slug,
            "content": p.live_content, "content_text": p.live_content_text,
            "group_id": str(p.live_group_id) if p.live_group_id else None,
        },
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "contributors": [
            {"name": c.name, "role": c.role,
             "at": c.created_at.isoformat() if c.created_at else None}
            for c in (p.contributors or [])
        ],
        "revisions": [
            {"id": str(r.id), "title": r.title, "slug": r.slug,
             "content": r.content, "content_text": r.content_text,
             "at": r.created_at.isoformat() if r.created_at else None}
            for r in sorted(p.revisions or [], key=lambda x: x.created_at or datetime.min.replace(tzinfo=timezone.utc))
        ],
    }


@router.get("/export")
async def export_data(db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    users = await crud_user.get_multi(db, limit=10000)
    groups = await crud_group.get_multi_ordered(db)
    pages = await crud_page.get_multi(db, limit=100000)
    logs = (await db.execute(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(5000))).scalars().all()

    return {
        "schemaVersion": 2,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "users": [{"id": str(u.id), "name": u.name, "email": u.email, "role": u.role, "is_active": u.is_active} for u in users],
        "groups": [{"id": str(g.id), "name": g.name, "parentId": str(g.parent_id) if g.parent_id else None,
                    "position": g.position, "path": g.path} for g in groups],
        "pages": [_page_to_dict(p) for p in pages],
        "log": [{"at": l.created_at.isoformat() if l.created_at else None, "user": l.user_name,
                 "action": l.action, "target": l.target} for l in logs],
    }


def _content_from(payload: Dict[str, Any]) -> Dict[str, Any]:
    if isinstance(payload.get("content"), dict):
        return sanitize_content(payload["content"])
    if payload.get("body"):
        return sanitize_content({"format": "blocks-v1",
                                 "blocks": [{"type": "paragraph", "text": strip_html(str(payload["body"]))}]})
    return {"format": "blocks-v1", "blocks": []}


@router.post("/import")
async def import_data(payload: ImportPayload, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    """Destructive replace of structure + content (mirrors the prototype's import).

    Users are upserted by email (never deleted, so you cannot lock yourself out);
    groups and pages are replaced.
    """
    if not payload.groups and not payload.pages:
        raise HTTPException(status_code=400, detail="Import payload is missing groups and pages")

    # 1. Upsert users by email.
    for u in (payload.users or []):
        email = (u.get("email") or "").strip()
        if not email:
            continue
        existing = await crud_user.get_by_email(db, email=email)
        role = u.get("role") if u.get("role") in {"admin", "volunteer"} else "volunteer"
        if not existing:
            await crud_user.create(db, obj_in={
                "email": email, "name": u.get("name") or email, "role": role,
                "is_active": True, "password": u.get("password") or uuid.uuid4().hex,
            })

    # 2. Wipe content (pages cascade to contributors/revisions).
    await db.execute(delete(Page))
    await db.execute(delete(Group))
    await db.commit()

    # 3. Recreate groups (parents first) with id remapping.
    id_map: Dict[str, uuid.UUID] = {}
    remaining = list(payload.groups)
    guard = 0
    while remaining and guard < len(payload.groups) + 5:
        guard += 1
        progressed = False
        for g in list(remaining):
            old_id = str(g.get("id"))
            old_parent = g.get("parentId")
            if old_parent and str(old_parent) not in id_map:
                continue
            new_group = Group(
                id=uuid.uuid4(),
                name=(g.get("name") or "Group")[:500],
                parent_id=id_map.get(str(old_parent)) if old_parent else None,
                position=int(g.get("position") or 0),
                path=g.get("path"),
            )
            db.add(new_group)
            await db.flush()
            await crud_group._assign_path(db, new_group)
            id_map[old_id] = new_group.id
            remaining.remove(g)
            progressed = True
        if not progressed:
            # Orphaned parents — attach the rest at root.
            for g in remaining:
                new_group = Group(id=uuid.uuid4(), name=(g.get("name") or "Group")[:500], parent_id=None,
                                  position=int(g.get("position") or 0))
                db.add(new_group)
                await db.flush()
                await crud_group._assign_path(db, new_group)
                id_map[str(g.get("id"))] = new_group.id
            remaining = []
    await db.commit()

    # Ensure a fallback root group for pages with no group.
    fallback = Group(id=uuid.uuid4(), name="Imported pages", parent_id=None, position=9999)
    db.add(fallback)
    await db.flush()
    fallback_id = fallback.id

    # 4. Recreate pages.
    imported = 0
    for pd in payload.pages:
        group_id = id_map.get(str(pd.get("groupId"))) or fallback_id
        lang = (pd.get("lang") or "en")[:10]
        slug = (pd.get("slug") or "").strip()
        if not slug:
            continue
        content = _content_from(pd)
        db_page = Page(
            id=uuid.uuid4(),
            group_id=group_id,
            title=(pd.get("title") or slug)[:500],
            slug=slug[:500],
            lang=lang,
            status=pd.get("status") if pd.get("status") in {"draft", "pending", "published", "rejected"} else "draft",
            content=content,
            content_text=extract_clean_text(content),
            is_homepage=bool(pd.get("is_homepage")),
            position=int(pd.get("position") or 0),
            author_id=admin.id,
            last_edited_by_id=admin.id,
        )
        db.add(db_page)
        imported += 1
        if imported % 500 == 0:
            await db.flush()
    await db.commit()

    await log_action(db, admin, "Imported data", f"{imported} pages", "data", None,
                     {"groups": len(id_map), "pages": imported}, request)
    return {"message": "Import complete", "groups": len(id_map), "pages": imported}
