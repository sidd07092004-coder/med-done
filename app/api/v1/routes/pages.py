from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
from typing import List, Optional
from datetime import datetime

from app.api.deps import get_db, get_current_active_admin, get_current_active_user
from app.crud.crud_page import crud_page
from app.models.user import User
from app.models.page import Page
from app.models.revision import PageRevision
from app.schemas.page import (
    PageCreate, PageUpdate, PageResponse, PagePublic,
    TranslationCreate, RejectRequest, ReorderRequest
)

router = APIRouter()


async def create_revision(db: AsyncSession, page: Page, created_by_id: UUID):
    rev = PageRevision(
        page_id=page.id,
        title=page.title,
        slug=page.slug,
        content=page.content,
        content_text=page.content_text,
        group_id=page.group_id,
        created_by_id=created_by_id,
    )
    db.add(rev)
    await db.commit()


@router.get("/", response_model=List[PageResponse])
async def list_pages(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    return await crud_page.get_multi(db, limit=10000)


@router.post("/", response_model=PageResponse)
async def create_page(page_in: PageCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    db_page = await crud_page.create(db, obj_in={
        **page_in.dict(),
        "author_id": user.id,
        "last_edited_by_id": user.id
    })
    return db_page


@router.get("/queue", response_model=List[PageResponse])
async def get_queue(db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    return await crud_page.get_pending(db)


@router.get("/{page_id}", response_model=PageResponse)
async def get_page(page_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return page


@router.patch("/{page_id}", response_model=PageResponse)
async def update_page(page_id: UUID, page_in: PageUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    if page.status == "pending" and user.role != "admin":
        raise HTTPException(status_code=403, detail="Page is pending approval and locked")
    # Create revision before update if content changed
    await create_revision(db, page, user.id)
    update_data = page_in.dict(exclude_unset=True)
    update_data["last_edited_by_id"] = user.id
    return await crud_page.update(db, db_obj=page, obj_in=update_data)


@router.post("/{page_id}/submit", response_model=PageResponse)
async def submit_page(page_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    if page.status not in ["draft", "rejected"]:
        raise HTTPException(status_code=400, detail="Page not in draft/rejected state")
    page.status = "pending"
    page.submitted_by_id = user.id
    page.reject_note = None
    await db.commit()
    await db.refresh(page)
    return page


@router.post("/{page_id}/approve", response_model=PageResponse)
async def approve_page(page_id: UUID, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    if page.status != "pending":
        raise HTTPException(status_code=400, detail="Page not pending approval")
    page.live_title = page.title
    page.live_slug = page.slug
    page.live_content = page.content
    page.live_content_text = page.content_text
    page.live_group_id = page.group_id
    page.status = "published"
    page.approved_by_id = admin.id
    page.reject_note = None
    page.published_at = datetime.utcnow()
    await db.commit()
    await db.refresh(page)
    return page


@router.post("/{page_id}/reject", response_model=PageResponse)
async def reject_page(page_id: UUID, req: RejectRequest, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    if page.status != "pending":
        raise HTTPException(status_code=400, detail="Page not pending approval")
    page.status = "rejected"
    page.reject_note = req.reject_note
    await db.commit()
    await db.refresh(page)
    return page


@router.post("/{page_id}/unpublish", response_model=PageResponse)
async def unpublish_page(page_id: UUID, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    if page.status != "published":
        raise HTTPException(status_code=400, detail="Page not published")
    page.status = "draft"
    page.live_title = None
    page.live_slug = None
    page.live_content = None
    page.live_content_text = None
    page.live_group_id = None
    await db.commit()
    await db.refresh(page)
    return page


@router.post("/{page_id}/revisions/{rev_id}/restore", response_model=PageResponse)
async def restore_revision(page_id: UUID, rev_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    if page.status == "pending" and user.role != "admin":
        raise HTTPException(status_code=403, detail="Page is pending approval and locked")
    # find revision
    from app.models.revision import PageRevision
    from sqlalchemy import select
    result = await db.execute(select(PageRevision).where(PageRevision.id == rev_id, PageRevision.page_id == page_id))
    rev = result.scalar_one_or_none()
    if not rev:
        raise HTTPException(status_code=404, detail="Revision not found")
    # create revision of current
    await create_revision(db, page, user.id)
    page.title = rev.title or page.title
    page.slug = rev.slug or page.slug
    if rev.content is not None:
        page.content = rev.content
        page.content_text = rev.content_text
    if rev.group_id:
        page.group_id = rev.group_id
    page.last_edited_by_id = user.id
    await db.commit()
    await db.refresh(page)
    return page


@router.post("/{page_id}/translations", response_model=PageResponse)
async def create_translation(page_id: UUID, req: TranslationCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    trans = Page(
        group_id=page.group_id,
        title=page.title,
        slug=page.slug,
        lang=req.lang,
        status="draft",
        content=page.content,
        content_text=page.content_text,
        excerpt=page.excerpt,
        translation_of_id=page.id,
        author_id=user.id,
        last_edited_by_id=user.id,
        meta_title=page.meta_title,
        meta_description=page.meta_description,
        meta_keywords=page.meta_keywords,
    )
    db.add(trans)
    await db.commit()
    await db.refresh(trans)
    return trans


@router.delete("/{page_id}")
async def delete_page(page_id: UUID, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    await crud_page.delete(db, id=page_id)
    return {"message": "Page deleted"}
