from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
from typing import List

from app.api.deps import get_db, get_current_active_admin
from app.crud.crud_user import crud_user
from app.schemas.user import UserCreate, UserUpdate, UserResponse

router = APIRouter()


@router.get("/", response_model=List[UserResponse])
async def list_users(db: AsyncSession = Depends(get_db), admin=Depends(get_current_active_admin)):
    return await crud_user.get_multi(db)


@router.post("/", response_model=UserResponse)
async def create_user(user_in: UserCreate, db: AsyncSession = Depends(get_db), admin=Depends(get_current_active_admin)):
    existing = await crud_user.get_by_email(db, email=user_in.email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    return await crud_user.create(db, obj_in=user_in)


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(user_id: UUID, db: AsyncSession = Depends(get_db), admin=Depends(get_current_active_admin)):
    user = await crud_user.get(db, id=user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(user_id: UUID, user_in: UserUpdate, db: AsyncSession = Depends(get_db), admin=Depends(get_current_active_admin)):
    user = await crud_user.get(db, id=user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return await crud_user.update(db, db_obj=user, obj_in=user_in)


@router.delete("/{user_id}")
async def delete_user(user_id: UUID, db: AsyncSession = Depends(get_db), admin=Depends(get_current_active_admin)):
    user = await crud_user.get(db, id=user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # Prevent deleting last admin
    if user.role == "admin":
        # count admins
        all_users = await crud_user.get_multi(db, limit=1000)
        admins = [u for u in all_users if u.role == "admin" and u.is_active]
        if len(admins) <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last admin")
    await crud_user.delete(db, id=user_id)
    return {"message": "User deleted"}
