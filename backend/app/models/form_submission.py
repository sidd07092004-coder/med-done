
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import String, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class FormSubmission(Base):
    __tablename__ = "form_submissions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    page_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("pages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Snapshot of the form slug at submission time.
    form_slug: Mapped[str] = mapped_column(String(512), nullable=False)

    lang: Mapped[str] = mapped_column(String(10), default="en", nullable=False)

    # Only validated user answers are stored here.
    responses: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False
    )

    # Snapshot the admin review fields so existing submissions remain
    # reviewable even if the page's form configuration changes later.
    review_fields: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list
    )

    review_data: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict
    )

    status: Mapped[str] = mapped_column(
        String(30), default="new", nullable=False, index=True
    )

    reviewed_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
