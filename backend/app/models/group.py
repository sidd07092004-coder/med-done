from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

from app.db.base_class import Base


class Group(Base):
    __tablename__ = "groups"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    name_translations = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    parent_id = Column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="RESTRICT"), nullable=True)
    position = Column(Integer, default=0)
    path = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    parent = relationship("Group", remote_side=[id], back_populates="children")
    children = relationship("Group", back_populates="parent")
    pages = relationship("Page", back_populates="group", foreign_keys="Page.group_id")

