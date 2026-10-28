from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class VolunteerApplicationCreate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=30)
    first_name: str = Field(min_length=1, max_length=100)
    middle_name: Optional[str] = Field(default=None, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    preferred_name: str = Field(min_length=1, max_length=120)

    email: EmailStr
    phone: str = Field(min_length=5, max_length=30)
    country: str = Field(min_length=2, max_length=100)

    languages_spoken: list[str] = Field(min_length=1, max_length=30)
    other_languages: Optional[str] = None
    translation_languages: Optional[str] = None
    help_areas: list[str] = Field(default_factory=list, max_length=30)

    field_of_study: Optional[str] = None
    university_year: Optional[str] = None
    student_tasks: list[str] = Field(default_factory=list, max_length=20)

    psychology_services: list[str] = Field(
        default_factory=list, max_length=20
    )
    licensed_countries: Optional[str] = None

    other_details: Optional[str] = Field(default=None, max_length=5000)
    consent: bool

    @field_validator(
        "first_name", "last_name", "preferred_name", "phone", "country"
    )
    @classmethod
    def strip_required_strings(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field cannot be blank")
        return value

    @field_validator("consent")
    @classmethod
    def consent_must_be_true(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("Consent is required to submit the application")
        return value


class VolunteerApplicationResponse(BaseModel):
    id: UUID
    title: Optional[str]
    first_name: str
    middle_name: Optional[str]
    last_name: str
    preferred_name: str
    email: EmailStr
    phone: str
    country: str

    languages_spoken: list[str]
    other_languages: Optional[str]
    translation_languages: Optional[str]
    help_areas: list[str]

    field_of_study: Optional[str]
    university_year: Optional[str]
    student_tasks: list[str]
    psychology_services: list[str]
    licensed_countries: Optional[str]

    other_details: Optional[str]
    consent: bool
    status: Literal["pending", "approved", "rejected"]
    rejection_reason: Optional[str]
    reviewed_by: Optional[UUID]
    reviewed_at: Optional[datetime]
    created_user_id: Optional[UUID]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class VolunteerApplicationReject(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)