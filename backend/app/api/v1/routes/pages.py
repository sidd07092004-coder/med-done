from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from typing import List, Optional
from datetime import datetime

from app.api.deps import get_db, get_current_active_admin, get_current_active_user
from app.crud.crud_page import crud_page
from app.models.user import User
from app.models.page import Page
from app.models.contributor import PageContributor  # needed by duplicate_page
from app.models.revision import PageRevision
from app.services.audit import log_action
from app.services.sanitize import sanitize_content
from app.services.content_text import extract_clean_text
from app.services.templates import get_templates  # starter page templates
from app.services.dynamic_forms import validate_form_config  # form-config validation
from app.schemas.page import (
    PageCreate, PageUpdate, PageResponse, PagePublic,
    TranslationCreate, RejectRequest, PageMoveRequest,
    TranslationInfo, TranslationListResponse, PageContributorCreate, PageContributorResponse,
)

router = APIRouter()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Languages that translations can be created for (English is the source language).
LANGS = ["hr", "tr", "ar"]
LANG_NAMES = {"en": "English", "hr": "Croatian", "tr": "Turkish", "ar": "Arabic"}

# Maximum number of revisions kept per page; older ones are trimmed.
REVISION_CAP = 20

# Limits used when generating "-copy" slugs for duplicated pages.
COPY_SLUG_CAP = 999
SLUG_MAX_LENGTH = 512


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def create_revision(db: AsyncSession, page: Page, created_by_id: UUID, commit: bool = False):
    """Snapshot the page's current state into a PageRevision row."""
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
    await db.flush()
    if commit:
        await db.commit()
    return rev


async def _trim_revisions(db: AsyncSession, page_id: UUID):
    """Delete revisions beyond REVISION_CAP (list is ordered newest first)."""
    revs = await crud_page.list_revisions(db, page_id, limit=1000)
    for stale in revs[REVISION_CAP:]:
        await db.delete(stale)


def _changed(page: Page, update_data: dict) -> bool:
    """Return True if the update changes any field that is tracked in revisions."""
    for field in ("title", "slug", "group_id", "content"):
        if field in update_data and update_data[field] != getattr(page, field):
            return True
    return False


async def _ensure_unique_slug(db: AsyncSession, slug: str, lang: str, exclude_id: Optional[UUID] = None):
    """Raise 409 if another page already uses this slug in the same language."""
    existing = await crud_page.get_by_slug(db, slug=slug, lang=lang)
    if existing and existing.id != exclude_id:
        raise HTTPException(status_code=409, detail=f"A page with slug '{slug}' ({lang}) already exists")


async def _next_copy_slug(db: AsyncSession, page: Page) -> str:
    """First free ``${slug}-copy`` / ``-copy-N`` slug in the page's language."""
    base = page.slug or "page"
    for index in range(1, COPY_SLUG_CAP + 1):
        suffix = "-copy" if index == 1 else f"-copy-{index}"
        # Truncate the base so the final slug never exceeds SLUG_MAX_LENGTH.
        candidate = f"{base[: SLUG_MAX_LENGTH - len(suffix)]}{suffix}"
        existing = await crud_page.get_by_slug(db, slug=candidate, lang=page.lang)
        if existing is None:
            return candidate
    raise HTTPException(status_code=409, detail="No free copy slug available")


# ---------------------------------------------------------------------------
# List / create / read
# ---------------------------------------------------------------------------

@router.get("/", response_model=List[PageResponse])
async def list_pages(
    group_id: Optional[UUID] = Query(default=None),
    lang: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    include_homepage: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    return await crud_page.get_multi_filtered(
        db, group_id=group_id, lang=lang, status=status, q=q, include_homepage=include_homepage
    )


@router.post("/", response_model=PageResponse)
async def create_page(
    page_in: PageCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    # Only admins may mark a page as the homepage or as featured.
    if user.role != "admin" and (page_in.is_homepage or page_in.featured):
        raise HTTPException(
            status_code=403,
            detail="Only admins can set is_homepage or featured",
        )

    # Prevent two pages in the same language from using the same slug.
    await _ensure_unique_slug(db, page_in.slug, page_in.lang)

    # Convert the incoming Pydantic schema to a dictionary.
    data = page_in.dict()

    # Only admins may directly choose a non-draft workflow status
    # (prevents the approval-workflow bypass).
    # Non-admin users must submit their page for approval.
    allowed_statuses = {"draft", "pending", "published", "rejected"}
    if user.role != "admin" or data.get("status") not in allowed_statuses:
        data["status"] = "draft"

    # Draft forms can be configured incrementally; published forms need fields.
    validate_form_config(
        data.get("content"),
        require_fields=data.get("status") == "published",
    )

    # Track who created and last edited the page.
    data["author_id"] = user.id
    data["last_edited_by_id"] = user.id

    # Use the existing CRUD layer so the established page workflow is retained.
    db_page = await crud_page.create(db, obj_in=data)

    # If an admin creates a page directly as published, update its live snapshot.
    # Public APIs should serve the published snapshot, not unpublished edits.
    if db_page.status == "published":
        db_page.live_title = db_page.title
        db_page.live_slug = db_page.slug
        db_page.live_content = db_page.content
        db_page.live_content_text = db_page.content_text
        db_page.live_group_id = db_page.group_id
        db_page.approved_by_id = user.id
        db_page.published_at = datetime.utcnow()

        await db.commit()
        await db.refresh(db_page)

    # Record the action in the existing audit log.
    await log_action(
        db,
        user,
        "Created page",
        db_page.title,
        "page",
        db_page.id,
        {"slug": db_page.slug, "lang": db_page.lang},
        request,
    )

    return db_page


# NOTE: static routes (/queue, /templates) must be registered BEFORE
# "/{page_id}", otherwise FastAPI would try to parse them as a UUID.
@router.get("/queue", response_model=List[PageResponse])
async def get_queue(db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    """Pages waiting for admin approval."""
    return await crud_page.get_pending(db)


@router.get("/templates")
async def list_page_templates(user: User = Depends(get_current_active_user)):
    """Return the sanitised starter recipes (registered before ``/{page_id}``)."""
    return get_templates()


@router.get("/{page_id}", response_model=PageResponse)
async def get_page(
    page_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return page


# ---------------------------------------------------------------------------
# Duplicate / update
# ---------------------------------------------------------------------------

@router.post("/{page_id}/duplicate", response_model=PageResponse)
async def duplicate_page(
    page_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    """Copy a page into a new draft (spec §6.3). Never copies approval/live state."""
    source = await crud_page.get(db, id=page_id)
    if not source:
        raise HTTPException(status_code=404, detail="Page not found")

    # Capture values now; the source instance may be refreshed/expired later.
    source_title = source.title
    source_id = source.id
    slug = await _next_copy_slug(db, source)
    contributors = await crud_page.list_contributors(db, source.id)
    position = await crud_page.next_position(db, source.group_id)

    # A fresh copy always starts as an unapproved draft. Content is sanitised
    # and content_text re-derived by CRUDPage.create (never trusted from input).
    data = {
        "title": source.title,
        "slug": slug,
        "group_id": source.group_id,
        "lang": source.lang,
        "content": sanitize_content(source.content),
        "excerpt": source.excerpt,
        "status": "draft",
        "position": position,
        "is_homepage": False,   # a copy can never be the homepage
        "featured": False,
        "author_id": user.id,
        "last_edited_by_id": user.id,
        # Reset all approval / publishing state.
        "submitted_by_id": None,
        "approved_by_id": None,
        "reject_note": None,
        "published_at": None,
        "live_title": None,
        "live_slug": None,
        # ``live_content`` is JSONB: leave it out so the column is SQL NULL,
        # not the JSON value ``null``.
        "live_content_text": None,
        "live_group_id": None,
        "translation_of_id": source.translation_of_id,
        "meta_title": source.meta_title,
        "meta_description": source.meta_description,
        "canonical_path": source.canonical_path,
        "robots": source.robots,
        "og_image": source.og_image,
    }
    if source.meta_keywords is not None:
        data["meta_keywords"] = source.meta_keywords
    duplicate = await crud_page.create(db, obj_in=data)

    # Copy the contributor credits, attributed to the user who duplicated.
    for contributor in contributors:
        db.add(
            PageContributor(
                page_id=duplicate.id,
                name=contributor.name,
                role=contributor.role,
                added_by_id=user.id,
            )
        )
    await db.commit()

    await log_action(
        db,
        user,
        "Duplicated page",
        source_title,
        "page",
        duplicate.id,
        {"source_page_id": str(source_id), "slug": slug},
        request,
    )
    # The instance in the identity map was refreshed by CRUDPage.create before
    # the contributors existed; reload the collections explicitly.
    await db.refresh(duplicate, attribute_names=["contributors", "revisions"])
    return duplicate


@router.patch("/{page_id}", response_model=PageResponse)
async def update_page(
    page_id: UUID,
    page_in: PageUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    # Find the existing page.
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    # Keep the existing approval lock for non-admin users.
    if page.status == "pending" and user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Page is pending approval and locked",
        )

    print("RAW REQUEST BODY:", await request.json())
    print("PAGE IN DICT:", page_in.dict())
    print("PAGE IN FIELDS SET:", page_in.__fields_set__)

    # Include only the fields provided in the PATCH request.
    update_data = page_in.dict(exclude_unset=True)

    print("PATCH FIELDS:", update_data.keys())
    print("PATCH THEME:", (update_data.get("content") or {}).get("theme"))
    print("DB THEME BEFORE:", (page.content or {}).get("theme"))

    print("INCOMING BLOCKS:", (update_data.get("content") or {}).get("blocks"))
    print("DB BLOCKS BEFORE:", (page.content or {}).get("blocks"))

    # Preserve existing theme when the incoming content omits it.
    if "content" in update_data and update_data["content"] is not None:
        incoming_content = update_data["content"]
        existing_content = page.content or {}

        if (
            "theme" not in incoming_content
            and "theme" in existing_content
        ):
            incoming_content["theme"] = existing_content["theme"]

        update_data["content"] = incoming_content

    # Only admins may change is_homepage or featured.
    if user.role != "admin" and (
        "is_homepage" in update_data or "featured" in update_data
    ):
        raise HTTPException(
            status_code=403,
            detail="Only admins can change is_homepage or featured",
        )

    # Validate the new form configuration only when content is being changed.
    # A title-only update does not need to revalidate the form.
    if "content" in update_data:
        validate_form_config(update_data["content"])

    # If the slug or language changes, ensure the combination remains unique.
    new_slug = update_data.get("slug", page.slug)
    new_lang = update_data.get("lang", page.lang)
    if new_slug != page.slug or new_lang != page.lang:
        await _ensure_unique_slug(db, new_slug, new_lang, exclude_id=page.id)

    # Snapshot the previous state before applying meaningful changes.
    # This preserves the existing revision history.
    if _changed(page, update_data):
        await create_revision(db, page, user.id)
        await _trim_revisions(db, page.id)

    # Record the user who made the latest edit.
    update_data["last_edited_by_id"] = user.id

    # Update using the existing CRUD layer.
    result = await crud_page.update(db, db_obj=page, obj_in=update_data)

    print("DB THEME AFTER:", (result.content or {}).get("theme"))
    print("DB BLOCKS AFTER:", (result.content or {}).get("blocks"))

    # Keep the existing audit trail.
    await log_action(db, user, "Saved changes", result.title, "page", result.id, request=request)

    return result


# ---------------------------------------------------------------------------
# Approval workflow: submit -> approve / reject -> unpublish
# ---------------------------------------------------------------------------

@router.post("/{page_id}/submit", response_model=PageResponse)
async def submit_page(page_id: UUID, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    # Only drafts and previously rejected pages can be (re)submitted.
    if page.status not in ["draft", "rejected"]:
        raise HTTPException(status_code=400, detail="Page not in draft/rejected state")
    # A form must have fields before it can go for approval.
    validate_form_config(page.content, require_fields=True)
    page.status = "pending"
    page.submitted_by_id = user.id
    page.reject_note = None
    await db.commit()
    await db.refresh(page)
    await log_action(db, user, "Submitted for approval", page.title, "page", page.id, request=request)
    return page


@router.post("/{page_id}/approve", response_model=PageResponse)
async def approve_page(page_id: UUID, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    if page.status != "pending":
        raise HTTPException(status_code=400, detail="Page not pending approval")
    # Re-validate: the form must have fields before it goes live.
    validate_form_config(page.content, require_fields=True)
    # Copy the working version into the live snapshot served by public APIs.
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
    await log_action(db, admin, "Approved and published", page.title, "page", page.id, request=request)
    return page


@router.post("/{page_id}/reject", response_model=PageResponse)
async def reject_page(page_id: UUID, req: RejectRequest, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    if page.status != "pending":
        raise HTTPException(status_code=400, detail="Page not pending approval")
    page.status = "rejected"
    page.reject_note = req.reject_note  # reason shown to the author
    await db.commit()
    await db.refresh(page)
    await log_action(db, admin, "Rejected", page.title, "page", page.id, {"note": req.reject_note}, request)
    return page


@router.post("/{page_id}/unpublish", response_model=PageResponse)
async def unpublish_page(page_id: UUID, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    if page.status != "published":
        raise HTTPException(status_code=400, detail="Page not published")
    # Back to draft and clear the live snapshot so it is no longer served publicly.
    page.status = "draft"
    page.live_title = None
    page.live_slug = None
    page.live_content = None
    page.live_content_text = None
    page.live_group_id = None
    await db.commit()
    await db.refresh(page)
    await log_action(db, admin, "Unpublished", page.title, "page", page.id, request=request)
    return page


# ---------------------------------------------------------------------------
# Revisions
# ---------------------------------------------------------------------------

@router.get("/{page_id}/revisions", response_model=List[dict])
async def list_revisions(page_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    # Outer join so revisions still appear if the author account was deleted;
    # also returns the author's display name for the UI.
    result = await db.execute(
        select(PageRevision, User.name)
        .outerjoin(User, PageRevision.created_by_id == User.id)
        .where(PageRevision.page_id == page_id)
        .order_by(PageRevision.created_at.desc())
        .limit(50)
    )
    return [
        {
            "id": str(r.id),
            "title": r.title,
            "slug": r.slug,
            "content": r.content,
            "content_text": r.content_text,
            "group_id": str(r.group_id) if r.group_id else None,
            "created_by_id": str(r.created_by_id) if r.created_by_id else None,
            "created_by_name": created_by_name,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r, created_by_name in result.all()
    ]


@router.post("/{page_id}/revisions/{rev_id}/restore", response_model=PageResponse)
async def restore_revision(page_id: UUID, rev_id: UUID, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    # Restoring is admin-only.
    if admin.role != "admin":  # defence in depth (the dependency already enforces it)
        raise HTTPException(status_code=403, detail="Not enough permissions")
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    result = await db.execute(select(PageRevision).where(PageRevision.id == rev_id, PageRevision.page_id == page_id))
    rev = result.scalar_one_or_none()
    if not rev:
        raise HTTPException(status_code=404, detail="Revision not found")

    # Snapshot the current state first so a restore is itself undoable.
    await create_revision(db, page, admin.id)

    # The restored slug might now collide with another page; check before applying.
    restored_slug = rev.slug or page.slug
    try:
        await _ensure_unique_slug(db, restored_slug, page.lang, exclude_id=page.id)
    except HTTPException:
        # Drop the just-created snapshot: the restore never happened.
        await db.rollback()
        raise

    # Re-sanitise old content and re-derive the searchable text from it.
    content = sanitize_content(rev.content)
    page.title = rev.title or page.title
    page.slug = restored_slug
    page.content = content
    page.content_text = extract_clean_text(content)
    if rev.group_id:
        page.group_id = rev.group_id
    page.last_edited_by_id = admin.id
    await _trim_revisions(db, page.id)
    await db.commit()
    await db.refresh(page)
    await log_action(db, admin, "Restored earlier version", page.title, "page", page.id, request=request)
    return page


# ---------------------------------------------------------------------------
# Translations
# ---------------------------------------------------------------------------

@router.get("/{page_id}/translations", response_model=TranslationListResponse)
async def list_translations(page_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    translations = await crud_page.list_translations(db, page_id)
    # Build a response keyed by language code (hr / tr / ar).
    out = TranslationListResponse()
    for t in translations:
        info = TranslationInfo.model_validate(t)
        if t.lang in LANGS:
            setattr(out, t.lang, info)
    return out


@router.post("/{page_id}/translations", response_model=PageResponse)
async def create_translation(page_id: UUID, req: TranslationCreate, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    if req.lang not in LANGS:
        raise HTTPException(status_code=400, detail=f"Unsupported language '{req.lang}'. Use one of {LANGS}")
    # English is the source language; translations are never chained.
    if page.lang != "en":
        raise HTTPException(status_code=400, detail="Translations can only be created from the English page")
    if page.slug == "home":
        raise HTTPException(status_code=400, detail="The homepage cannot be translated")
    existing = await crud_page.get_by_slug(db, slug=page.slug, lang=req.lang)
    if existing:
        raise HTTPException(status_code=409, detail=f"Translation already exists for {req.lang}")

    # The translation starts as a draft copy of the English page.
    trans = Page(
        group_id=page.group_id,
        title=page.title,
        slug=page.slug,
        lang=req.lang,
        status="draft",
        content=sanitize_content(page.content),
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
    await log_action(db, user, f"Created {LANG_NAMES.get(req.lang, req.lang)} translation", page.title, "page", trans.id, request=request)
    return trans


# ---------------------------------------------------------------------------
# Contributors (credits)
# ---------------------------------------------------------------------------

@router.get("/{page_id}/contributors", response_model=List[PageContributorResponse])
async def list_contributors(page_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return await crud_page.list_contributors(db, page_id)


@router.post("/{page_id}/contributors", response_model=PageContributorResponse)
async def add_contributor(page_id: UUID, contrib_in: PageContributorCreate, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    # Reject empty / whitespace-only names.
    if not contrib_in.name.strip():
        raise HTTPException(status_code=400, detail="Contributor name is required")
    contributor = await crud_page.add_contributor(db, page_id, contrib_in.name.strip(), contrib_in.role, user.id)
    await log_action(db, user, f"Credited {contributor.name} as {contributor.role}", page.title, "page", page.id, request=request)
    return contributor


@router.delete("/{page_id}/contributors/{contributor_id}")
async def remove_contributor(page_id: UUID, contributor_id: UUID, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    removed = await crud_page.remove_contributor(db, contributor_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Contributor not found")
    await log_action(db, user, "Removed a credit", page.title, "page", page.id, request=request)
    return {"message": "Contributor removed"}


# ---------------------------------------------------------------------------
# Move / delete
# ---------------------------------------------------------------------------

@router.patch("/{page_id}/move", response_model=PageResponse)
async def move_page(page_id: UUID, move_in: PageMoveRequest, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    # Move the page to another group and/or position.
    result = await crud_page.move(db, page, move_in.group_id, move_in.position)
    await log_action(db, user, "Moved page", result.title, "page", result.id, request=request)
    return result


@router.delete("/{page_id}")
async def delete_page(page_id: UUID, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    page = await crud_page.get(db, id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    # Keep the title: the page object is gone after deletion but the audit log needs it.
    title = page.title
    await crud_page.delete(db, id=page_id)
    await log_action(db, admin, "Deleted page", title, "page", page_id, request=request)
    return {"message": "Page deleted"}