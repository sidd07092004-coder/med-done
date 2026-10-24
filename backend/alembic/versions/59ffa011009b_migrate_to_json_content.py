"""migrate_to_json_content

Revision ID: 59ffa011009b
Revises: 245a985bfcad
Create Date: 2026-10-14 11:34:42.302178

Converts the legacy ``body`` (HTML text) + ``fields`` (JSONB) content storage
on ``pages`` / ``page_revisions`` into the JSON ``content`` model:
``{"format": ..., "fields": {...}, "body": "..."}`` plus the denormalized
``content_text`` column.

Historical note: this revision previously re-created tables that the current
``245a985bfcad`` revision already creates (audit_logs, media_files,
page_contributors, page_revisions) and dropped ``pages.created_at/updated_at``,
so ``alembic upgrade head`` could never run on a fresh database. It has been
rewritten in place to be runnable and to match the current models. No deployed
database could have this revision stamped (the chain was not runnable), so this
is not a breaking change for any existing deployment.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '59ffa011009b'
down_revision: Union[str, None] = '245a985bfcad'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Best-effort conversion of legacy (body, fields) into the JSON content shape.
# Rows that only carried ``body`` are tagged blocks-v1; rows with ``fields``
# are tagged home-v1. ``jsonb_strip_nulls`` drops keys that have no data.
_BACKFILL = """
UPDATE {table}
SET {target} = jsonb_strip_nulls(jsonb_build_object(
        'format', CASE WHEN {fields} IS NOT NULL THEN 'home-v1' ELSE 'blocks-v1' END,
        'fields', COALESCE({fields}, '{{}}'::jsonb),
        'body', {body}
    ))
"""


def upgrade() -> None:
    # --- page_revisions: body/fields -> content/content_text -----------------
    op.add_column('page_revisions', sa.Column('content', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('page_revisions', sa.Column('content_text', sa.Text(), nullable=True))
    op.execute(_BACKFILL.format(table='page_revisions', target='content', fields='fields', body='body'))
    op.drop_column('page_revisions', 'body')
    op.drop_column('page_revisions', 'fields')

    # --- pages: body/fields -> content/content_text --------------------------
    op.add_column('pages', sa.Column('content', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('pages', sa.Column('content_text', sa.Text(), nullable=True))
    op.execute(_BACKFILL.format(table='pages', target='content', fields='fields', body='body'))
    op.drop_column('pages', 'body')
    op.drop_column('pages', 'fields')

    # --- pages: live_body/live_fields -> live_content/live_content_text ------
    op.add_column('pages', sa.Column('live_content', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('pages', sa.Column('live_content_text', sa.Text(), nullable=True))
    op.execute(
        _BACKFILL.format(table='pages', target='live_content', fields='live_fields', body='live_body')
        + "WHERE live_fields IS NOT NULL OR live_body IS NOT NULL"
    )
    op.drop_column('pages', 'live_body')
    op.drop_column('pages', 'live_fields')


def downgrade() -> None:
    # --- pages: restore legacy live_body/live_fields -------------------------
    op.add_column('pages', sa.Column('live_body', sa.Text(), nullable=True))
    op.add_column('pages', sa.Column('live_fields', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.execute("""
        UPDATE pages
        SET live_body = live_content ->> 'body',
            live_fields = live_content -> 'fields'
        WHERE live_content IS NOT NULL
    """)
    op.drop_column('pages', 'live_content_text')
    op.drop_column('pages', 'live_content')

    # --- pages: restore legacy body/fields -----------------------------------
    op.add_column('pages', sa.Column('body', sa.Text(), nullable=True))
    op.add_column('pages', sa.Column('fields', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.execute("""
        UPDATE pages
        SET body = content ->> 'body',
            fields = content -> 'fields'
        WHERE content IS NOT NULL
    """)
    op.drop_column('pages', 'content_text')
    op.drop_column('pages', 'content')

    # --- page_revisions: restore legacy body/fields --------------------------
    op.add_column('page_revisions', sa.Column('body', sa.Text(), nullable=True))
    op.add_column('page_revisions', sa.Column('fields', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.execute("""
        UPDATE page_revisions
        SET body = content ->> 'body',
            fields = content -> 'fields'
        WHERE content IS NOT NULL
    """)
    op.drop_column('page_revisions', 'content_text')
    op.drop_column('page_revisions', 'content')
