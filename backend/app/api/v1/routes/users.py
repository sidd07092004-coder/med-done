from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
from typing import List

from app.api.deps import get_db, get_current_active_admin, get_current_active_user
from app.crud.crud_user import crud_user
from app.models.user import User
from app.services.audit import log_action
from app.schemas.user import UserCreate, UserUpdate, UserResponse, PasswordUpdate
from app.core.security import verify_password, get_password_hash

router = APIRouter()

VALID_ROLES = {"admin", "volunteer"}


async def _admin_count(db: AsyncSession) -> int:
    users = await crud_user.get_multi(db, limit=10000)
    return len([u for u in users if u.role == "admin" and u.is_active])


@router.get("/", response_model=List[UserResponse])
async def list_users(db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    return await crud_user.get_multi(db, limit=10000)


@router.post("/", response_model=UserResponse)
async def create_user(user_in: UserCreate, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    if user_in.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Role must be one of {sorted(VALID_ROLES)}")
    existing = await crud_user.get_by_email(db, email=user_in.email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = await crud_user.create(db, obj_in=user_in)
    await log_action(db, admin, f"Added user {user.name} ({user.role})", user.name, "user", user.id, request=request)
    return user


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(user_id: UUID, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    user = await crud_user.get(db, id=user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(user_id: UUID, user_in: UserUpdate, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    user = await crud_user.get(db, id=user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    data = user_in.dict(exclude_unset=True)
    if "role" in data:
        if data["role"] not in VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Role must be one of {sorted(VALID_ROLES)}")
        # Keep at least one admin.
        if user.role == "admin" and data["role"] != "admin" and await _admin_count(db) <= 1:
            raise HTTPException(status_code=400, detail="Keep at least one other admin before demoting this one")
    old_role = user.role
    user = await crud_user.update(db, db_obj=user, obj_in=data)
    if "role" in data and data["role"] != old_role:
        await log_action(db, admin, f"Changed role of {user.name} to {user.role}", user.name, "user", user.id, request=request)
    else:
        await log_action(db, admin, f"Updated user {user.name}", user.name, "user", user.id, request=request)
    return user


@router.delete("/{user_id}")
async def delete_user(user_id: UUID, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    user = await crud_user.get(db, id=user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "admin" and await _admin_count(db) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last admin")
    name = user.name
    await crud_user.delete(db, id=user_id)
    await log_action(db, admin, f"Removed user {name}", name, "user", user_id, request=request)
    return {"message": "User deleted"}

@router.post("/update-password")
async def update_password(
    payload: PasswordUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if not current_user.password_hash:
        raise HTTPException(
            status_code=400,
            detail="Password is not configured for this account",
        )

    if not verify_password(
        payload.current_password.get_secret_value(),
        current_user.password_hash,
    ):
        raise HTTPException(
            status_code=400,
            detail="Current password is incorrect",
        )

    new_password = payload.new_password.get_secret_value()

    if payload.current_password.get_secret_value() == new_password:
        raise HTTPException(
            status_code=400,
            detail="New password must be different from current password",
        )

    current_user.password_hash = get_password_hash(new_password)

    await db.commit()

    return {"message": "Password updated successfully"}
