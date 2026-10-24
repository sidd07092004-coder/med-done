from sqlalchemy import Column, Integer, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

from app.db.base_class import Base


class PageRevision(Base):
    __tablename__ = "page_revisions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    page_id = Column(UUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), nullable=False)
    title = Column(Text, nullable=True)
    slug = Column(Text, nullable=True)
    content = Column(JSONB, nullable=True)
    content_text = Column(Text, nullable=True)
    group_id = Column(UUID(as_uuid=True), ForeignKey("groups.id"), nullable=True)
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    page = relationship("Page", back_populates="revisions")
    created_by = relationship("User")
