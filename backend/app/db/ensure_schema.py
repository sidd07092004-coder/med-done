"""Idempotent schema patches for databases created before a model change.

The project builds its schema with ``Base.metadata.create_all`` (see
``init_and_seed.py``), which never alters existing tables.  Keep the small set
of additive patches needed by a running dev database here so they are applied
on every boot.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection


async def ensure_schema(conn: AsyncConnection) -> None:
    """Apply additive, repeatable schema migrations."""
    await conn.execute(
        text(
            "ALTER TABLE groups ADD COLUMN IF NOT EXISTS "
            "name_translations JSONB NOT NULL DEFAULT '{}'::jsonb"
        )
    )
    await conn.execute(
        text("ALTER TABLE pages ADD COLUMN IF NOT EXISTS canonical_path VARCHAR(2048)")
    )
    await conn.execute(
        text("ALTER TABLE pages ADD COLUMN IF NOT EXISTS robots VARCHAR(16)")
    )
    await conn.execute(
        text("ALTER TABLE pages ADD COLUMN IF NOT EXISTS og_image VARCHAR(2048)")
    )
    # Columns introduced by the alignment revision. A database deployed from an
    # older checkout can be stamped at a revision this repository no longer
    # contains; bootstrap re-stamps it as head, so these must be patched here.
    await conn.execute(
        text("ALTER TABLE pages ADD COLUMN IF NOT EXISTS meta_title VARCHAR(512)")
    )
    await conn.execute(
        text("ALTER TABLE pages ADD COLUMN IF NOT EXISTS meta_description TEXT")
    )
    await conn.execute(
        text("ALTER TABLE pages ADD COLUMN IF NOT EXISTS meta_keywords JSONB")
    )
    await conn.execute(
        text(
            "ALTER TABLE pages ADD COLUMN IF NOT EXISTS "
            "published_at TIMESTAMP WITH TIME ZONE"
        )
    )
