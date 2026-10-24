from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB, INET
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

from app.db.base_class import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    user_name = Column(Text, nullable=False)
    action = Column(Text, nullable=False)
    target = Column(Text, nullable=False)
    target_type = Column(Text, nullable=True)
    target_id = Column(UUID(as_uuid=True), nullable=True)
    # NOTE: attribute is `meta` because `metadata` is reserved by SQLAlchemy's
    # declarative Base; the DB column keeps the name `metadata`.
    meta = Column("metadata", JSONB, nullable=True)
    ip_address = Column(Text, nullable=True)  # store as text
    user_agent = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")
