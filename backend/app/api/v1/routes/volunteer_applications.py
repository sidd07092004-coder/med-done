from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_current_active_admin
from app.core.security import get_password_hash
from app.models.user import User
from app.models.volunteer_application import VolunteerApplication
from app.schemas.volunteer_application import (
    VolunteerApplicationCreate,
    VolunteerApplicationResponse,
    VolunteerApplicationReject,
)

public_router = APIRouter()
admin_router = APIRouter()


@public_router.post(
    "/volunteer-applications",
    response_model=VolunteerApplicationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_volunteer_application(
    payload: VolunteerApplicationCreate,
    db: AsyncSession = Depends(get_db),
):
    email = str(payload.email).lower()

    # Don't accept a new application if an account already uses this email.
    existing_user = await db.execute(
        select(User).where(User.email == email)
    )
    if existing_user.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="An account already exists for this email",
        )

    # Avoid repeated pending applications for the same email.
    existing_application = await db.execute(
        select(VolunteerApplication).where(
            VolunteerApplication.email == email,
            VolunteerApplication.status == "pending",
        )
    )
    if existing_application.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="A pending application already exists for this email",
        )

    data = payload.model_dump()
    data["email"] = email

    application = VolunteerApplication(**data)
    db.add(application)
    await db.commit()
    await db.refresh(application)

    return application


@admin_router.get(
    "/",
    response_model=list[VolunteerApplicationResponse],
)
async def list_volunteer_applications(
    application_status: str = "pending",
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_active_admin),
):
    if application_status not in {"pending", "approved", "rejected", "all"}:
        raise HTTPException(
            status_code=400,
            detail="status must be pending, approved, rejected, or all",
        )

    query = select(VolunteerApplication).order_by(
        VolunteerApplication.created_at.desc()
    )

    if application_status != "all":
        query = query.where(
            VolunteerApplication.status == application_status
        )

    result = await db.execute(query)
    return result.scalars().all()


@admin_router.get(
    "/{application_id}",
    response_model=VolunteerApplicationResponse,
)
async def get_volunteer_application(
    application_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_active_admin),
):
    result = await db.execute(
        select(VolunteerApplication).where(
            VolunteerApplication.id == application_id
        )
    )
    application = result.scalar_one_or_none()

    if application is None:
        raise HTTPException(status_code=404, detail="Application not found")

    return application


@admin_router.post(
    "/{application_id}/approve",
    response_model=VolunteerApplicationResponse,
)
async def approve_volunteer_application(
    application_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_active_admin),
):
    # Lock the application so concurrent approvals cannot create two accounts.
    result = await db.execute(
        select(VolunteerApplication)
        .where(VolunteerApplication.id == application_id)
        .with_for_update()
    )
    application = result.scalar_one_or_none()

    if application is None:
        raise HTTPException(status_code=404, detail="Application not found")

    if application.status != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Application is already {application.status}",
        )

    email = application.email.lower()

    user_result = await db.execute(
        select(User).where(User.email == email)
    )
    existing_user = user_result.scalar_one_or_none()

    if existing_user:
        raise HTTPException(
            status_code=409,
            detail="A user with this email already exists; resolve the duplicate before approval",
        )

    full_name = " ".join(
        part for part in [
            application.first_name,
            application.middle_name,
            application.last_name,
        ] if part and part.strip()
    )

    # Requested initial password: applicant's phone number.
    # Only the hash is stored; the plain phone number is never stored as a password.
    volunteer = User(
        email=email,
        name=full_name,
        role="volunteer",
        password_hash=get_password_hash(application.phone),
        is_active=True,
    )
    db.add(volunteer)
    await db.flush()  # obtains volunteer.id without committing

    application.status = "approved"
    application.reviewed_by = admin.id
    application.reviewed_at = datetime.now(timezone.utc)
    application.created_user_id = volunteer.id
    application.rejection_reason = None

    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    await db.refresh(application)
    return application


@admin_router.post(
    "/{application_id}/reject",
    response_model=VolunteerApplicationResponse,
)
async def reject_volunteer_application(
    application_id: UUID,
    payload: VolunteerApplicationReject,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_active_admin),
):
    result = await db.execute(
        select(VolunteerApplication)
        .where(VolunteerApplication.id == application_id)
        .with_for_update()
    )
    application = result.scalar_one_or_none()

    if application is None:
        raise HTTPException(status_code=404, detail="Application not found")

    if application.status != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Application is already {application.status}",
        )

    application.status = "rejected"
    application.rejection_reason = payload.reason.strip()
    application.reviewed_by = admin.id
    application.reviewed_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(application)
    return application