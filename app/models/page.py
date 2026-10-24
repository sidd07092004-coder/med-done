import enum
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    String,
    Text,
    ForeignKey,
    Integer,
    Boolean,
    Enum,
    DateTime,
    UniqueConstraint,
    Index,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base_class import Base


class PageStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING = "pending"
    PUBLISHED = "published"
    REJECTED = "rejected"


class Page(Base):
    __tablename__ = "pages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("groups.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    slug: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    lang: Mapped[str] = mapped_column(String(10), default="en", nullable=False, index=True)
    status: Mapped[PageStatus] = mapped_column(
        Enum(PageStatus, name="page_status_enum"), default=PageStatus.DRAFT, nullable=False, index=True
    )

    # Primary content storage (JSON structure)
    content: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # Denormalized clean text for search and fast retrieval
    content_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    excerpt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    is_homepage: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    featured: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # User relations
    author_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    last_edited_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    submitted_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    reject_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewer: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Live (published) snapshot
    live_title: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    live_slug: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    live_content: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    live_content_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    live_group_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Translation linking
    translation_of_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pages.id", ondelete="SET NULL"), nullable=True
    )

    meta_title: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    meta_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    meta_keywords: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    group: Mapped["Group"] = relationship("Group", back_populates="pages")
    author: Mapped[Optional["User"]] = relationship("User", foreign_keys=[author_id])
    last_edited_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[last_edited_by_id])
    submitted_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[submitted_by_id])
    approved_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[approved_by_id])
    contributors = relationship(
        "PageContributor", back_populates="page", cascade="all, delete-orphan", lazy="selectin"
    )
    revisions = relationship(
        "PageRevision", back_populates="page", cascade="all, delete-orphan", lazy="selectin"
    )

    __table_args__ = (
        UniqueConstraint("slug", "lang", name="uq_pages_slug_lang"),
        Index("ix_pages_slug_lang_status", "slug", "lang", "status"),
    )
