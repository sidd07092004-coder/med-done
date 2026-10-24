"""DB-backed tests for the page-builder page features (spec §6.1–§6.8).

The tests mirror ``test_designer_roundtrip.py``: they apply the additive schema
patches and **skip** cleanly when the local PostgreSQL instance is unavailable,
so ``pytest -q`` stays green on a bare checkout.

Run from ``backend/`` so ``.env`` is found.
"""
from __future__ import annotations

import uuid
from datetime import datetime

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.routes import pages as pages_routes
from app.api.v1.routes.pages import (
    duplicate_page,
    list_page_templates,
    list_revisions,
    restore_revision,
)
from app.core.config import settings
from app.crud.crud_page import crud_page
from app.crud.crud_user import crud_user
from app.db.base import Base
from app.db.ensure_schema import ensure_schema
from app.models.group import Group
from app.models.page import Page
from app.models.revision import PageRevision
from app.models.user import User
from app.schemas.page import PageCreate, PageUpdate
from app.services.content_text import extract_clean_text
from app.services.sanitize import sanitize_content
from app.services.templates import TEMPLATES_VERSION, get_templates

pytestmark = pytest.mark.asyncio


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #

@pytest_asyncio.fixture
async def db():
    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
            await conn.run_sync(Base.metadata.create_all)
            await ensure_schema(conn)
    except Exception as exc:  # noqa: BLE001
        await engine.dispose()
        pytest.skip(f"PostgreSQL not available: {exc}")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def group(db):
    group_id = uuid.uuid4()
    g = Group(id=group_id, name=f"builder-{uuid.uuid4().hex[:8]}", path=None, position=0)
    db.add(g)
    await db.commit()
    yield g
    await db.rollback()
    pages = (
        await db.execute(select(Page).where(Page.group_id == group_id))
    ).scalars().all()
    for page in pages:
        await db.delete(page)
    stored = await db.get(Group, group_id)
    if stored is not None:
        await db.delete(stored)
    await db.commit()


@pytest_asyncio.fixture
async def admin(db):
    user = await crud_user.get_by_email(db, email="admin@example.com")
    if user is None:
        pytest.skip("seeded admin user not available")
    return user


def _slug() -> str:
    return f"builder-{uuid.uuid4().hex[:12]}"


def _volunteer() -> User:
    return User(
        id=uuid.uuid4(),
        email=f"v-{uuid.uuid4().hex[:8]}@x",
        name="Volunteer",
        role="volunteer",
    )


def _blocks(text_value: str = "Body") -> dict:
    return {
        "format": "blocks-v1",
        "blocks": [{"type": "paragraph", "text": text_value}],
    }


# --------------------------------------------------------------------------- #
# §6.1 — SEO columns and write validators
# --------------------------------------------------------------------------- #

async def test_seo_roundtrip_and_truncation(db, group):
    page = await crud_page.create(
        db,
        PageCreate(
            title="SEO",
            slug=_slug(),
            group_id=group.id,
            content=_blocks(),
            meta_title="  " + "T" * 100,
            meta_description="D" * 200,
            canonical_path="https://example.com/guide",
            robots="NOINDEX",
            og_image="/uploads/hero.webp",
        ),
    )
    assert page.meta_title == "T" * 70
    assert page.meta_description == "D" * 160
    assert page.canonical_path == "https://example.com/guide"
    assert page.robots == "noindex"
    assert page.og_image == "/uploads/hero.webp"

    reloaded = await crud_page.get(db, id=page.id)
    assert reloaded.canonical_path == "https://example.com/guide"
    assert reloaded.robots == "noindex"
    assert reloaded.og_image == "/uploads/hero.webp"

    await crud_page.update(
        db,
        db_obj=reloaded,
        obj_in=PageUpdate(
            meta_title="M" * 90,
            meta_description="E" * 220,
            canonical_path="javascript:alert(1)",
            robots="follow",
            og_image="data:image/svg+xml;base64,PHN2Zz4=",
        ),
    )
    await db.refresh(reloaded)
    assert reloaded.meta_title == "M" * 70
    assert reloaded.meta_description == "E" * 160
    assert reloaded.canonical_path is None
    assert reloaded.robots is None
    assert reloaded.og_image is None


async def test_seo_invalid_values_clear_without_rejecting():
    page = PageCreate(
        title="SEO",
        slug="seo",
        group_id=uuid.uuid4(),
        canonical_path="//evil.example/x",
        robots="archive",
        og_image="blob:https://example.com/x",
        meta_title="   ",
        meta_description="   ",
    )
    assert page.canonical_path is None
    assert page.robots is None
    assert page.og_image is None
    assert page.meta_title == ""
    assert page.meta_description == ""

    allowed = PageCreate(
        title="SEO",
        slug="seo",
        group_id=uuid.uuid4(),
        canonical_path="/guides/example",
        robots="index",
        og_image="https://cdn.example.com/x.jpg",
    )
    assert allowed.canonical_path == "/guides/example"
    assert allowed.robots == "index"
    assert allowed.og_image == "https://cdn.example.com/x.jpg"


# --------------------------------------------------------------------------- #
# §6.2 — Templates API
# --------------------------------------------------------------------------- #

async def test_templates_endpoint_shape_and_sanitisation(admin):
    payload = await list_page_templates(user=admin)
    assert payload["version"] == TEMPLATES_VERSION == 1
    assert [t["id"] for t in payload["templates"]] == [
        "blank",
        "article",
        "treatment",
        "condition",
        "faq",
        "practitioner",
    ]
    for template in payload["templates"]:
        assert set(template) == {"id", "label", "description", "content"}
        assert template["content"]["format"] == "blocks-v1"
        assert template["content"] == sanitize_content(template["content"])

    blank = next(t for t in payload["templates"] if t["id"] == "blank")
    assert blank["content"]["blocks"][0]["type"] == "paragraph"


async def test_templates_are_deep_copied_per_call():
    first = get_templates()
    first["templates"][0]["content"]["blocks"].append(
        {"type": "paragraph", "text": "mutated"}
    )
    second = get_templates()
    assert len(second["templates"][0]["content"]["blocks"]) == 1
    assert second["templates"][0]["content"]["blocks"][0]["type"] == "paragraph"


async def test_templates_route_is_registered_before_page_id():
    # A dynamic GET /{page_id} would shadow /templates if declared first.
    get_paths = [
        route.path
        for route in pages_routes.router.routes
        if "GET" in (getattr(route, "methods", None) or set())
    ]
    assert get_paths.index("/templates") < get_paths.index("/{page_id}")


# --------------------------------------------------------------------------- #
# §6.3 — Duplicate
# --------------------------------------------------------------------------- #

async def test_duplicate_semantics(db, group, admin):
    previous_homepage = (
        await db.execute(
            select(Page).where(Page.lang == "en", Page.is_homepage.is_(True))
        )
    ).scalars().first()
    previous_homepage_id = previous_homepage.id if previous_homepage else None

    source = await crud_page.create(
        db,
        PageCreate(
            title="Original",
            slug=_slug(),
            group_id=group.id,
            content=_blocks("Hello <script>alert(1)</script>"),
            excerpt="Excerpt",
            meta_title="Meta title",
            meta_description="Meta description",
            canonical_path="/original",
            robots="noindex",
            og_image="/uploads/og.jpg",
        ),
    )
    source.status = "published"
    source.featured = True
    source.is_homepage = True
    source.live_title = source.title
    source.live_slug = source.slug
    source.live_content = source.content
    source.live_content_text = source.content_text
    source.live_group_id = group.id
    source.published_at = datetime.utcnow()
    source.approved_by_id = admin.id
    source.submitted_by_id = admin.id
    source.reject_note = "old rejection"
    db.add(source)
    await db.commit()

    await crud_page.add_contributor(db, source.id, "Alice", "Writer", admin.id)
    await crud_page.add_contributor(db, source.id, "Bob", "Medical reviewer", admin.id)
    db.add(
        PageRevision(
            page_id=source.id,
            title=source.title,
            slug=source.slug,
            content=source.content,
            content_text=source.content_text,
            group_id=group.id,
            created_by_id=admin.id,
        )
    )
    await db.commit()

    try:
        duplicate = await duplicate_page(
            page_id=source.id, request=None, db=db, user=admin
        )
        assert duplicate.status == "draft"
        assert duplicate.slug == f"{source.slug}-copy"
        assert duplicate.position == 1
        assert duplicate.is_homepage is False
        assert duplicate.featured is False
        assert duplicate.live_title is None
        assert duplicate.live_slug is None
        assert duplicate.live_content is None
        assert duplicate.live_content_text is None
        assert duplicate.live_group_id is None
        assert duplicate.published_at is None
        assert duplicate.approved_by_id is None
        assert duplicate.submitted_by_id is None
        assert duplicate.reject_note is None
        assert duplicate.author_id == admin.id
        assert duplicate.last_edited_by_id == admin.id
        assert duplicate.title == source.title
        assert duplicate.excerpt == source.excerpt
        assert duplicate.canonical_path == source.canonical_path
        assert duplicate.robots == source.robots
        assert duplicate.og_image == source.og_image
        assert duplicate.content == sanitize_content(source.content)
        assert duplicate.content_text == extract_clean_text(sanitize_content(source.content))
        assert "<script>" not in duplicate.content_text
        assert sorted((c.name, c.role) for c in duplicate.contributors) == [
            ("Alice", "Writer"),
            ("Bob", "Medical reviewer"),
        ]
        assert all(c.added_by_id == admin.id for c in duplicate.contributors)
        assert duplicate.revisions == []

        second = await duplicate_page(
            page_id=source.id, request=None, db=db, user=admin
        )
        assert second.slug == f"{source.slug}-copy-2"
    finally:
        if previous_homepage_id is not None:
            previous = await crud_page.get(db, id=previous_homepage_id)
            if previous is not None:
                previous.is_homepage = True
                db.add(previous)
                await db.commit()


# --------------------------------------------------------------------------- #
# §6.4 — Revisions
# --------------------------------------------------------------------------- #

async def test_revisions_list_includes_created_by_name(db, group, admin):
    page = await crud_page.create(
        db, PageCreate(title="History", slug=_slug(), group_id=group.id, content=_blocks())
    )
    authored = PageRevision(
        page_id=page.id,
        title="Old title",
        slug=page.slug,
        content=page.content,
        content_text=page.content_text,
        group_id=group.id,
        created_by_id=admin.id,
    )
    anonymous = PageRevision(
        page_id=page.id,
        title="Anonymous",
        slug=page.slug,
        content=page.content,
        content_text=page.content_text,
        group_id=group.id,
        created_by_id=None,
    )
    db.add_all([authored, anonymous])
    await db.commit()

    rows = await list_revisions(page_id=page.id, db=db, user=admin)
    by_id = {row["id"]: row for row in rows}
    assert by_id[str(authored.id)]["created_by_name"] == admin.name
    assert by_id[str(anonymous.id)]["created_by_name"] is None
    # Existing fields remain present.
    assert by_id[str(authored.id)]["created_by_id"] == str(admin.id)
    assert by_id[str(authored.id)]["title"] == "Old title"


async def test_restore_is_admin_only_and_does_not_mutate(db, group, admin):
    page = await crud_page.create(
        db, PageCreate(title="Current", slug=_slug(), group_id=group.id, content=_blocks("current"))
    )
    revision = PageRevision(
        page_id=page.id,
        title="Older",
        slug=page.slug,
        content=_blocks("older"),
        content_text="older",
        group_id=group.id,
        created_by_id=admin.id,
    )
    db.add(revision)
    await db.commit()

    before = (
        await db.execute(
            select(func.count()).select_from(PageRevision).where(PageRevision.page_id == page.id)
        )
    ).scalar_one()

    with pytest.raises(HTTPException) as exc:
        await restore_revision(
            page_id=page.id,
            rev_id=revision.id,
            request=None,
            db=db,
            admin=_volunteer(),
        )
    assert exc.value.status_code == 403
    await db.refresh(page)
    assert page.title == "Current"
    after = (
        await db.execute(
            select(func.count()).select_from(PageRevision).where(PageRevision.page_id == page.id)
        )
    ).scalar_one()
    assert after == before


async def test_restore_sanitises_and_snapshots_current(db, group, admin):
    page = await crud_page.create(
        db,
        PageCreate(title="Current", slug=_slug(), group_id=group.id, content=_blocks("current")),
    )
    revision = PageRevision(
        page_id=page.id,
        title="Restored title",
        slug=page.slug,
        content=_blocks("Old <script>alert(1)</script>"),
        content_text="unsafe legacy text",
        group_id=group.id,
        created_by_id=admin.id,
    )
    db.add(revision)
    await db.commit()
    before = (
        await db.execute(
            select(func.count()).select_from(PageRevision).where(PageRevision.page_id == page.id)
        )
    ).scalar_one()

    restored = await restore_revision(
        page_id=page.id, rev_id=revision.id, request=None, db=db, admin=admin
    )

    assert restored.title == "Restored title"
    assert restored.content == sanitize_content(revision.content)
    assert restored.content_text == extract_clean_text(sanitize_content(revision.content))
    assert "<script>" not in restored.content_text
    after = (
        await db.execute(
            select(func.count()).select_from(PageRevision).where(PageRevision.page_id == page.id)
        )
    ).scalar_one()
    assert after == before + 1


async def test_restore_rejects_duplicate_slug(db, group, admin):
    page = await crud_page.create(
        db, PageCreate(title="Current", slug=_slug(), group_id=group.id, content=_blocks())
    )
    other = await crud_page.create(
        db, PageCreate(title="Other", slug=_slug(), group_id=group.id, content=_blocks())
    )
    revision = PageRevision(
        page_id=page.id,
        title="Conflicting",
        slug=other.slug,
        content=_blocks("conflict"),
        content_text="conflict",
        group_id=group.id,
        created_by_id=admin.id,
    )
    db.add(revision)
    await db.commit()
    page_id = page.id
    other_slug = other.slug
    before = (
        await db.execute(
            select(func.count()).select_from(PageRevision).where(PageRevision.page_id == page_id)
        )
    ).scalar_one()

    with pytest.raises(HTTPException) as exc:
        await restore_revision(
            page_id=page.id, rev_id=revision.id, request=None, db=db, admin=admin
        )
    assert exc.value.status_code == 409
    await db.rollback()
    after = (
        await db.execute(
            select(func.count()).select_from(PageRevision).where(PageRevision.page_id == page_id)
        )
    ).scalar_one()
    assert after == before
    await db.refresh(page)
    assert page.slug != other_slug
