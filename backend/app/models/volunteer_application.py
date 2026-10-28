import uuid

from sqlalchemy import (
    Column, Text, Boolean, DateTime, ForeignKey, JSON
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.db.base_class import Base


class VolunteerApplication(Base):
    __tablename__ = "volunteer_applications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Personal details
    title = Column(Text, nullable=True)
    first_name = Column(Text, nullable=False)
    middle_name = Column(Text, nullable=True)
    last_name = Column(Text, nullable=False)
    preferred_name = Column(Text, nullable=False)
    email = Column(Text, nullable=False, index=True)
    phone = Column(Text, nullable=False)
    country = Column(Text, nullable=False)

    # Application details
    languages_spoken = Column(JSON, nullable=False, default=list)
    other_languages = Column(Text, nullable=True)
    translation_languages = Column(Text, nullable=True)
    help_areas = Column(JSON, nullable=False, default=list)

    # Student details
    field_of_study = Column(Text, nullable=True)
    university_year = Column(Text, nullable=True)
    student_tasks = Column(JSON, nullable=False, default=list)

    # Professional details
    psychology_services = Column(JSON, nullable=False, default=list)
    licensed_countries = Column(Text, nullable=True)

    other_details = Column(Text, nullable=True)
    consent = Column(Boolean, nullable=False, default=False)

    # pending / approved / rejected
    status = Column(Text, nullable=False, default="pending", index=True)
    rejection_reason = Column(Text, nullable=True)

    reviewed_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at = Column(DateTime(timezone=True), nullable=True)

    created_user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )