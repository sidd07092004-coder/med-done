"""align_pages_with_models

Revision ID: 7f3d9c1a2b45
Revises: 59ffa011009b
Create Date: 2026-10-17 00:00:00.000000

Brings the ``pages`` table created by ``245a985bfcad`` (and re-shaped by
``59ffa011009b``) fully in line with ``app.models.page.Page``:

* status TEXT -> native ``page_status_enum``
* title/slug/live_title/live_slug -> VARCHAR(512), lang -> VARCHAR(10),
  reviewer -> VARCHAR(255)
* content NOT NULL; created_at/updated_at NOT NULL
* is_homepage NOT NULL; add featured, position, excerpt, meta_*, published_at
* user-facing FKs -> ON DELETE SET NULL; drop the FK on live_group_id
  (the model keeps it as a plain UUID)
* add indexes ix_pages_group_id, ix_pages_is_homepage,
  ix_pages_slug_lang_status and unique constraint uq_pages_slug_lang
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '7f3d9c1a2b45'
down_revision: Union[str, None] = '59ffa011009b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ENUM_LABELS = ('DRAFT', 'PENDING', 'PUBLISHED', 'REJECTED')
_JSONB = postgresql.JSONB(astext_type=sa.Text())
_TS = postgresql.TIMESTAMP(timezone=True)

# (column, referenced_table) for the user/parent FKs that become SET NULL.
_SET_NULL_FKS = (
    ('author_id', 'users'),
    ('last_edited_by_id', 'users'),
    ('submitted_by_id', 'users'),
    ('approved_by_id', 'users'),
    ('translation_of_id', 'pages'),
)


def upgrade() -> None:
    bind = op.get_bind()

    # Make existing rows safe before tightening NOT NULL constraints.
    op.execute("UPDATE pages SET content = '{}'::jsonb WHERE content IS NULL")
    op.execute("UPDATE pages SET created_at = now() WHERE created_at IS NULL")
    op.execute("UPDATE pages SET updated_at = now() WHERE updated_at IS NULL")
    op.execute("UPDATE pages SET is_homepage = false WHERE is_homepage IS NULL")

    # --- status: TEXT -> native enum -----------------------------------------
    # Legacy databases stored lower-case workflow strings; the enum (and current
    # application) uses upper-case labels. Normalise before the cast, otherwise
    # ``ALTER ... USING status::page_status_enum`` fails on existing rows.
    op.execute(
        "UPDATE pages SET status = CASE lower(btrim(status)) "
        "WHEN 'draft' THEN 'DRAFT' "
        "WHEN 'pending' THEN 'PENDING' "
        "WHEN 'published' THEN 'PUBLISHED' "
        "WHEN 'approved' THEN 'PUBLISHED' "
        "WHEN 'rejected' THEN 'REJECTED' "
        "ELSE status END"
    )
    page_status = postgresql.ENUM(*_ENUM_LABELS, name='page_status_enum', create_type=False)
    page_status.create(bind, checkfirst=True)
    op.alter_column(
        'pages', 'status',
        existing_type=sa.Text(),
        type_=page_status,
        existing_nullable=False,
        postgresql_using='status::page_status_enum',
    )

    # --- varchar sizes --------------------------------------------------------
    op.alter_column('pages', 'title', existing_type=sa.Text(), type_=sa.String(512), existing_nullable=False)
    op.alter_column('pages', 'slug', existing_type=sa.Text(), type_=sa.String(512), existing_nullable=False)
    op.alter_column('pages', 'lang', existing_type=sa.Text(), type_=sa.String(10), existing_nullable=False)
    op.alter_column('pages', 'reviewer', existing_type=sa.Text(), type_=sa.String(255), existing_nullable=True)
    op.alter_column('pages', 'live_title', existing_type=sa.Text(), type_=sa.String(512), existing_nullable=True)
    op.alter_column('pages', 'live_slug', existing_type=sa.Text(), type_=sa.String(512), existing_nullable=True)

    # --- NOT NULL tightening (server default applied then removed so the
    #     resulting schema matches the models, which carry no server default).
    op.alter_column('pages', 'content', existing_type=_JSONB, nullable=False, server_default=sa.text("'{}'::jsonb"))
    op.alter_column('pages', 'content', existing_type=_JSONB, server_default=None)
    op.alter_column('pages', 'created_at', existing_type=_TS, nullable=False, existing_server_default=sa.text('now()'))
    op.alter_column('pages', 'updated_at', existing_type=_TS, nullable=False, existing_server_default=sa.text('now()'))
    op.alter_column('pages', 'is_homepage', existing_type=sa.Boolean(), nullable=False, server_default=sa.false())
    op.alter_column('pages', 'is_homepage', existing_type=sa.Boolean(), server_default=None)

    # --- new columns ----------------------------------------------------------
    op.add_column('pages', sa.Column('excerpt', sa.Text(), nullable=True))
    op.add_column('pages', sa.Column('featured', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column('pages', 'featured', existing_type=sa.Boolean(), server_default=None)
    op.add_column('pages', sa.Column('position', sa.Integer(), nullable=False, server_default='0'))
    op.alter_column('pages', 'position', existing_type=sa.Integer(), server_default=None)
    op.add_column('pages', sa.Column('meta_title', sa.String(512), nullable=True))
    op.add_column('pages', sa.Column('meta_description', sa.Text(), nullable=True))
    op.add_column('pages', sa.Column('meta_keywords', _JSONB, nullable=True))
    op.add_column('pages', sa.Column('published_at', _TS, nullable=True))

    # --- foreign keys: SET NULL semantics; drop FK on live_group_id ----------
    op.drop_constraint('pages_live_group_id_fkey', 'pages', type_='foreignkey')
    for column, _ref in _SET_NULL_FKS:
        op.drop_constraint(f'pages_{column}_fkey', 'pages', type_='foreignkey')
    for column, ref_table in _SET_NULL_FKS:
        op.create_foreign_key(
            f'pages_{column}_fkey', 'pages', ref_table, [column], ['id'], ondelete='SET NULL'
        )

    # --- indexes / unique constraint -----------------------------------------
    op.create_index('ix_pages_group_id', 'pages', ['group_id'])
    op.create_index('ix_pages_is_homepage', 'pages', ['is_homepage'])
    op.create_index('ix_pages_slug_lang_status', 'pages', ['slug', 'lang', 'status'])
    op.create_unique_constraint('uq_pages_slug_lang', 'pages', ['slug', 'lang'])


def downgrade() -> None:
    bind = op.get_bind()

    op.drop_constraint('uq_pages_slug_lang', 'pages', type_='unique')
    op.drop_index('ix_pages_slug_lang_status', table_name='pages')
    op.drop_index('ix_pages_is_homepage', table_name='pages')
    op.drop_index('ix_pages_group_id', table_name='pages')

    for column, ref_table in _SET_NULL_FKS:
        op.drop_constraint(f'pages_{column}_fkey', 'pages', type_='foreignkey')
    for column, ref_table in _SET_NULL_FKS:
        op.create_foreign_key(f'pages_{column}_fkey', 'pages', ref_table, [column], ['id'])
    op.create_foreign_key(
        'pages_live_group_id_fkey', 'pages', 'groups', ['live_group_id'], ['id']
    )

    op.drop_column('pages', 'published_at')
    op.drop_column('pages', 'meta_keywords')
    op.drop_column('pages', 'meta_description')
    op.drop_column('pages', 'meta_title')
    op.drop_column('pages', 'position')
    op.drop_column('pages', 'featured')
    op.drop_column('pages', 'excerpt')

    op.alter_column('pages', 'is_homepage', existing_type=sa.Boolean(), nullable=True)
    op.alter_column('pages', 'updated_at', existing_type=_TS, nullable=True, existing_server_default=sa.text('now()'))
    op.alter_column('pages', 'created_at', existing_type=_TS, nullable=True, existing_server_default=sa.text('now()'))
    op.alter_column('pages', 'content', existing_type=_JSONB, nullable=True)

    op.alter_column('pages', 'live_slug', existing_type=sa.String(512), type_=sa.Text(), existing_nullable=True)
    op.alter_column('pages', 'live_title', existing_type=sa.String(512), type_=sa.Text(), existing_nullable=True)
    op.alter_column('pages', 'reviewer', existing_type=sa.String(255), type_=sa.Text(), existing_nullable=True)
    op.alter_column('pages', 'lang', existing_type=sa.String(10), type_=sa.Text(), existing_nullable=False)
    op.alter_column('pages', 'slug', existing_type=sa.String(512), type_=sa.Text(), existing_nullable=False)
    op.alter_column('pages', 'title', existing_type=sa.String(512), type_=sa.Text(), existing_nullable=False)

    op.alter_column(
        'pages', 'status',
        existing_type=postgresql.ENUM(*_ENUM_LABELS, name='page_status_enum'),
        type_=sa.Text(),
        existing_nullable=False,
        postgresql_using='status::text',
    )
    postgresql.ENUM(*_ENUM_LABELS, name='page_status_enum').drop(bind, checkfirst=True)
