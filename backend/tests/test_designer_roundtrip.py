"""DB-backed round-trip tests for the page-designer content schema.

These tests need the local PostgreSQL instance described in AGENTS.md
(``127.0.0.1:5433``, password ``qwerty``) loaded via ``backend/.env``. They
**skip** (never fail) when the database is unreachable, so ``pytest -q`` stays
green on a bare checkout.

Run from ``backend/`` so ``.env`` is found.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.crud.crud_page import crud_page
from app.models.group import Group
from app.models.page import Page
from app.models.user import User
from app.schemas.page import PageCreate, PageUpdate
from app.services.sanitize import sanitize_content

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        await engine.dispose()
        pytest.skip(f"PostgreSQL not available: {exc}")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def group(db):
    g = Group(id=uuid.uuid4(), name=f"spec-{uuid.uuid4().hex[:8]}", path=None, position=0)
    db.add(g)
    await db.commit()
    yield g
    pages = (await db.execute(select(Page).where(Page.group_id == g.id))).scalars().all()
    for p in pages:
        await db.delete(p)
    await db.delete(g)
    await db.commit()


def _slug() -> str:
    return f"spec-{uuid.uuid4().hex[:12]}"


def _admin() -> User:
    return User(id=uuid.uuid4(), email=f"a-{uuid.uuid4().hex[:8]}@x", name="A", role="admin")


def _volunteer() -> User:
    return User(id=uuid.uuid4(), email=f"v-{uuid.uuid4().hex[:8]}@x", name="V", role="volunteer")


RICH_CONTENT = {
    "format": "blocks-v1",
    "blocks": [
        {"type": "heading", "level": 2, "text": "Title"},
        {"type": "paragraph", "text": "Body"},
        {
            "type": "table",
            "table": {
                "header": ["Symptom", "Common"],
                "rows": [["Headache", "Yes"]],
                "bordered": True,
            },
        },
        {
            "type": "callout",
            "variant": "warn",
            "text": "Careful",
            "label": "Warning",
            "shape": "rounded",
            "backgroundColor": "#EEF6FF",
        },
        {
            "type": "image",
            "src": "/uploads/x.jpg",
            "alt": "A photo",
            "width": 60,
            "align": "center",
        },
        {"type": "paragraph", "text": "Styled", "layout": {"width": 70, "textAlign": "center"}},
    ],
}


# --------------------------------------------------------------------------- #
# 1: create keeps every new key (the original bug).
# --------------------------------------------------------------------------- #

async def test_roundtrip_all_new_blocks(db, group):
    page = await crud_page.create(
        db,
        PageCreate(title="T", slug=_slug(), group_id=group.id, content=RICH_CONTENT),
    )
    assert page.content == sanitize_content(RICH_CONTENT)
    assert "Headache" in page.content_text
    assert "Warning" in page.content_text
    assert "A photo" in page.content_text


# --------------------------------------------------------------------------- #
# 2: update refreshes content + text and keeps new fields.
# --------------------------------------------------------------------------- #

async def test_roundtrip_update_keeps_new_fields(db, group):
    page = await crud_page.create(
        db,
        PageCreate(title="T", slug=_slug(), group_id=group.id, content={"format": "blocks-v1", "blocks": []}),
    )
    updated = await crud_page.update(db, db_obj=page, obj_in=PageUpdate(content=RICH_CONTENT))
    assert updated.content == sanitize_content(RICH_CONTENT)
    assert "Warning" in updated.content_text
    assert updated.content["blocks"][2]["table"]["header"] == ["Symptom", "Common"]


# --------------------------------------------------------------------------- #
# 3: homepage exclusivity on create, scoped to language.
# --------------------------------------------------------------------------- #

async def test_homepage_exclusive_on_create(db, group):
    a = await crud_page.create(
        db,
        PageCreate(title="A", slug=_slug(), group_id=group.id, is_homepage=True),
    )
    b = await crud_page.create(
        db,
        PageCreate(title="B", slug=_slug(), group_id=group.id, is_homepage=True),
    )
    await db.refresh(a)
    await db.refresh(b)
    assert a.is_homepage is False
    assert b.is_homepage is True

    # Language-scoped: a Croatian homepage must not unset the English one.
    hr = await crud_page.create(
        db,
        PageCreate(title="HR", slug=_slug(), group_id=group.id, lang="hr", is_homepage=True),
    )
    await db.refresh(b)
    assert b.is_homepage is True
    assert hr.is_homepage is True


# --------------------------------------------------------------------------- #
# 4: update unsets the previous homepage.
# --------------------------------------------------------------------------- #

async def test_homepage_update_unsets_previous(db, group):
    a = await crud_page.create(db, PageCreate(title="A", slug=_slug(), group_id=group.id))
    b = await crud_page.create(db, PageCreate(title="B", slug=_slug(), group_id=group.id))
    a = await crud_page.update(db, db_obj=a, obj_in=PageUpdate(is_homepage=True))
    b = await crud_page.update(db, db_obj=b, obj_in=PageUpdate(is_homepage=True))
    await db.refresh(a)
    await db.refresh(b)
    assert a.is_homepage is False
    assert b.is_homepage is True


# --------------------------------------------------------------------------- #
# 5: explicit False does not unset others.
# --------------------------------------------------------------------------- #

async def test_homepage_explicit_false_does_not_unset_others(db, group):
    a = await crud_page.create(
        db, PageCreate(title="A", slug=_slug(), group_id=group.id, is_homepage=True)
    )
    b = await crud_page.create(db, PageCreate(title="B", slug=_slug(), group_id=group.id))
    b = await crud_page.update(db, db_obj=b, obj_in=PageUpdate(is_homepage=False))
    await db.refresh(a)
    await db.refresh(b)
    assert a.is_homepage is True
    assert b.is_homepage is False


# --------------------------------------------------------------------------- #
# 6: deterministic public homepage fallback.
# --------------------------------------------------------------------------- #

async def test_public_homepage_fallback_deterministic(db, group):
    from app.api.v1.routes.public import get_homepage

    # Use a language with no `home` slug (the seed only creates `en/home`) so
    # the ordered `is_homepage` fallback is genuinely exercised.
    lang = "hr"
    low = await crud_page.create(
        db,
        PageCreate(
            title="Low",
            slug=_slug(),
            group_id=group.id,
            lang=lang,
            status="published",
            position=1,
        ),
    )
    high = await crud_page.create(
        db,
        PageCreate(
            title="High",
            slug=_slug(),
            group_id=group.id,
            lang=lang,
            status="published",
            position=9,
        ),
    )
    # Fabricate the legacy duplicate-homepage state directly, bypassing the
    # CRUD exclusivity helper.
    low.is_homepage = True
    high.is_homepage = True
    db.add_all([low, high])
    await db.commit()

    first = await get_homepage(lang=lang, db=db)
    second = await get_homepage(lang=lang, db=db)
    assert first.id == low.id
    assert second.id == low.id
    assert high.id != first.id


# --------------------------------------------------------------------------- #
# 7: public page serves content, not live_content.
# --------------------------------------------------------------------------- #

async def test_public_page_serves_content_not_live(db, group):
    from app.api.v1.routes.public import get_public_page

    content = {"format": "blocks-v1", "blocks": [{"type": "paragraph", "text": "current"}]}
    live = {"format": "blocks-v1", "blocks": [{"type": "paragraph", "text": "old"}]}
    slug = _slug()
    page = await crud_page.create(
        db,
        PageCreate(title="T", slug=slug, group_id=group.id, status="published", content=content),
    )
    page.live_content = live
    page.live_content_text = "old"
    db.add(page)
    await db.commit()

    response = await get_public_page(slug=slug, lang="en", db=db)
    assert response.content == content


# --------------------------------------------------------------------------- #
# 8: volunteer flag guard (403).
# --------------------------------------------------------------------------- #

async def test_volunteer_flags_forbidden_create(db, group):
    from app.api.v1.routes.pages import create_page

    volunteer = _volunteer()
    page_in = PageCreate(
        title="V", slug=_slug(), group_id=group.id, is_homepage=True
    )
    with pytest.raises(HTTPException) as exc:
        await create_page(page_in=page_in, request=None, db=db, user=volunteer)
    assert exc.value.status_code == 403


async def test_volunteer_flags_forbidden_update(db, group):
    from app.api.v1.routes.pages import update_page

    page = await crud_page.create(
        db, PageCreate(title="T", slug=_slug(), group_id=group.id, is_homepage=True)
    )
    volunteer = _volunteer()
    with pytest.raises(HTTPException) as exc:
        await update_page(
            page_id=page.id,
            page_in=PageUpdate(is_homepage=False),
            request=None,
            db=db,
            user=volunteer,
        )
    assert exc.value.status_code == 403
    await db.refresh(page)
    assert page.is_homepage is True


# --------------------------------------------------------------------------- #
# 9: homepage regression — one per language + stable public response.
# --------------------------------------------------------------------------- #

async def test_homepage_sequential_sets_leave_exactly_one(db, group):
    first = await crud_page.create(
        db,
        PageCreate(title="First", slug=_slug(), group_id=group.id, is_homepage=True),
    )
    second = await crud_page.create(
        db,
        PageCreate(
            title="Second",
            slug=_slug(),
            group_id=group.id,
            status="published",
            is_homepage=True,
        ),
    )
    await db.refresh(first)
    await db.refresh(second)
    assert first.is_homepage is False
    assert second.is_homepage is True
    assert sum([first.is_homepage, second.is_homepage]) == 1


async def test_public_homepage_endpoint_stable_across_calls(db, group):
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    # Ensure a published English homepage exists even on an unseeded database.
    await crud_page.create(
        db,
        PageCreate(
            title="Homepage",
            slug=_slug(),
            group_id=group.id,
            status="published",
            is_homepage=True,
        ),
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.get("/api/v1/homepage", params={"lang": "en"})
        second = await client.get("/api/v1/homepage", params={"lang": "en"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()


async def test_volunteer_patch_homepage_forbidden(db, group):
    from app.api.v1.routes.pages import update_page

    page = await crud_page.create(
        db, PageCreate(title="V", slug=_slug(), group_id=group.id)
    )
    with pytest.raises(HTTPException) as exc:
        await update_page(
            page_id=page.id,
            page_in=PageUpdate(is_homepage=True),
            request=None,
            db=db,
            user=_volunteer(),
        )
    assert exc.value.status_code == 403
    await db.refresh(page)
    assert page.is_homepage is False


# --------------------------------------------------------------------------- #
# 10: the explicit is_homepage flag wins over the legacy `home` slug.
# --------------------------------------------------------------------------- #

async def test_public_homepage_flag_wins_over_home_slug(db, group):
    from app.api.v1.routes.public import get_homepage

    body_slug = {"format": "blocks-v1", "blocks": [{"type": "paragraph", "text": "slug home"}]}
    body_flag = {"format": "blocks-v1", "blocks": [{"type": "paragraph", "text": "flagged home"}]}

    # The seeded site may already own `home`/`en`; temporarily move it aside so
    # this test can create its own slug page without violating the unique
    # (slug, lang) constraint. It is restored in `finally`.
    seeded_home = await crud_page.get_by_slug(db, slug="home", lang="en")
    seeded_id = seeded_slug = seeded_is_homepage = None
    if seeded_home is not None:
        seeded_id = seeded_home.id
        seeded_slug = seeded_home.slug
        seeded_is_homepage = seeded_home.is_homepage
        seeded_home.slug = f"tmp-{uuid.uuid4().hex[:12]}"
        db.add(seeded_home)
        await db.commit()

    slug_page_id = None
    try:
        slug_page = await crud_page.create(
            db,
            PageCreate(
                title="Slug home",
                slug="home",
                group_id=group.id,
                lang="en",
                status="published",
                content=body_slug,
            ),
        )
        slug_page_id = slug_page.id
        flagged_page = await crud_page.create(
            db,
            PageCreate(
                title="Flagged home",
                slug=_slug(),
                group_id=group.id,
                lang="en",
                status="published",
                is_homepage=True,
                content=body_flag,
            ),
        )

        first = await get_homepage(lang="en", db=db)
        second = await get_homepage(lang="en", db=db)
        assert first.id == flagged_page.id
        assert second.id == flagged_page.id
        assert first == second
        assert first.content == flagged_page.content
        assert first.content != slug_page.content

        # PATCH is_homepage=False (CRUD equivalent) -> slug fallback takes over.
        await crud_page.update(
            db, db_obj=flagged_page, obj_in=PageUpdate(is_homepage=False)
        )
        fallback = await get_homepage(lang="en", db=db)
        assert fallback.id == slug_page.id
        assert fallback.content == slug_page.content
    finally:
        # Drop the temporary `home` page before restoring the seeded one.
        if slug_page_id is not None:
            temp = await crud_page.get(db, id=slug_page_id)
            if temp is not None:
                await db.delete(temp)
                await db.commit()
        if seeded_id is not None:
            restored = await crud_page.get(db, id=seeded_id)
            if restored is not None:
                restored.slug = seeded_slug
                restored.is_homepage = seeded_is_homepage
                db.add(restored)
                await db.commit()


# --------------------------------------------------------------------------- #
# 11: flagging a second page keeps exactly one homepage per language.
# --------------------------------------------------------------------------- #

async def test_public_homepage_flag_stays_single_per_language(db, group):
    existing = (
        await db.execute(
            select(Page).where(Page.lang == "en", Page.is_homepage.is_(True))
        )
    ).scalars().first()
    existing_id = existing.id if existing is not None else None

    try:
        first = await crud_page.create(
            db,
            PageCreate(
                title="Flag first",
                slug=_slug(),
                group_id=group.id,
                lang="en",
                status="published",
                is_homepage=True,
            ),
        )
        second = await crud_page.create(
            db,
            PageCreate(
                title="Flag second",
                slug=_slug(),
                group_id=group.id,
                lang="en",
                status="published",
                is_homepage=True,
            ),
        )
        await db.refresh(first)
        await db.refresh(second)

        assert first.is_homepage is False
        assert second.is_homepage is True
        flagged = (
            await db.execute(
                select(Page).where(Page.lang == "en", Page.is_homepage.is_(True))
            )
        ).scalars().all()
        assert len(flagged) == 1
        assert flagged[0].id == second.id
    finally:
        if existing_id is not None:
            restored = await crud_page.get(db, id=existing_id)
            if restored is not None:
                await crud_page.update(
                    db, db_obj=restored, obj_in=PageUpdate(is_homepage=True)
                )
