"""Group name translations (hr/tr/ar): schema, persistence, public navigation.

The DB tests mirror ``test_designer_roundtrip.py``: they skip cleanly when the
local PostgreSQL instance is unavailable.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.routes.groups import get_group, update_group
from app.api.v1.routes.public import get_navigation
from app.core.config import settings
from app.crud.crud_group import crud_group
from app.crud.crud_user import crud_user
from app.schemas.group import GroupCreate, GroupUpdate
from app.services.group_names import localized_group_name


# --------------------------------------------------------------------------- #
# Schema-level validation (no DB required).
# --------------------------------------------------------------------------- #

def test_valid_translations_kept():
    group = GroupCreate(
        name="Cardiology",
        name_translations={"hr": "Kardiologija", "tr": "Kardiyoloji", "ar": "أمراض القلب"},
    )
    assert group.name_translations == {
        "hr": "Kardiologija",
        "tr": "Kardiyoloji",
        "ar": "أمراض القلب",
    }


def test_unknown_language_dropped():
    group = GroupCreate(
        name="Cardiology",
        name_translations={"hr": "Kardiologija", "de": "Kardiologie", "en": "Cardiology"},
    )
    assert group.name_translations == {"hr": "Kardiologija"}


def test_empty_values_dropped_and_html_stripped():
    group = GroupCreate(
        name="Cardiology",
        name_translations={
            "hr": "   ",
            "tr": "<b>Kardiyoloji</b>",
            "ar": "",
        },
    )
    assert group.name_translations == {"tr": "Kardiyoloji"}


def test_long_values_truncated_to_200():
    group = GroupCreate(name="Long", name_translations={"hr": "x" * 250})
    assert group.name_translations == {"hr": "x" * 200}


def test_update_allows_omitting_translations():
    update = GroupUpdate(name="Renamed")
    assert update.name_translations is None


# --------------------------------------------------------------------------- #
# DB-backed tests.
# --------------------------------------------------------------------------- #

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
async def groups(db):
    created = []

    async def make(name, translations=None):
        group = await crud_group.create(
            db,
            obj_in=GroupCreate(name=name, name_translations=translations or {}),
        )
        created.append(group.id)
        return group

    yield make

    # A failed assertion may leave the session in a failed transaction.
    await db.rollback()
    for group_id in reversed(created):
        group = await crud_group.get(db, id=group_id)
        if group is not None:
            await db.delete(group)
            await db.commit()


async def _admin(db):
    admin = await crud_user.get_by_email(db, email="admin@example.com")
    if admin is None:
        pytest.skip("seeded admin user not available")
    return admin


def _flatten(nodes):
    out = []
    for node in nodes:
        out.append(node)
        out.extend(_flatten(node.children))
    return out


@pytest.mark.asyncio
async def test_create_get_and_patch_replace_translations(db, groups):
    admin = await _admin(db)
    group = await groups(
        f"spec-{uuid.uuid4().hex[:8]}",
        {"hr": "Kardiologija", "tr": "Kardiyoloji", "ar": "أمراض القلب"},
    )

    fetched = await get_group(group_id=group.id, db=db, user=admin)
    assert fetched.name_translations == {
        "hr": "Kardiologija",
        "tr": "Kardiyoloji",
        "ar": "أمراض القلب",
    }

    updated = await update_group(
        group_id=group.id,
        group_in=GroupUpdate(
            name_translations={"hr": "Novo ime", "de": "ignored", "tr": "  "}
        ),
        request=None,
        db=db,
        admin=admin,
    )
    assert updated.name_translations == {"hr": "Novo ime"}

    fetched_again = await get_group(group_id=group.id, db=db, user=admin)
    assert fetched_again.name_translations == {"hr": "Novo ime"}


@pytest.mark.asyncio
async def test_navigation_uses_localized_name_and_falls_back(db, groups):
    hr_name = f"Cardiology-{uuid.uuid4().hex[:8]}"
    fallback_name = f"Neurology-{uuid.uuid4().hex[:8]}"
    with_hr = await groups(hr_name, {"hr": "Kardiologija", "tr": "Kardiyoloji"})
    without_hr = await groups(fallback_name, {"tr": "Nöroloji"})

    nav = await get_navigation(lang="hr", db=db)
    nodes = {node.id: node for node in _flatten(nav.groups)}

    assert nodes[with_hr.id].name == "Kardiologija"
    assert nodes[with_hr.id].name_translations["hr"] == "Kardiologija"
    # No Croatian translation -> English base name.
    assert nodes[without_hr.id].name == fallback_name

    # Unknown/unsupported language -> English for everyone.
    nav_unknown = await get_navigation(lang="de", db=db)
    unknown_nodes = {node.id: node for node in _flatten(nav_unknown.groups)}
    assert unknown_nodes[with_hr.id].name == hr_name
    assert unknown_nodes[without_hr.id].name == fallback_name


def test_localized_group_name_helper_falls_back():
    class FakeGroup:
        name = "Cardiology"
        name_translations = {"hr": "Kardiologija"}

    group = FakeGroup()
    assert localized_group_name(group, "hr") == "Kardiologija"
    assert localized_group_name(group, "tr") == "Cardiology"
    assert localized_group_name(group, "de") == "Cardiology"
    assert localized_group_name(group, None) == "Cardiology"
