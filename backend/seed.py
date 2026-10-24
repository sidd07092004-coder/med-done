import asyncio
import os
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent))

from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import AsyncSessionLocal
from app.crud.crud_user import crud_user
from app.schemas.user import UserCreate
from app.crud.crud_group import crud_group
from app.schemas.group import GroupCreate
from app.crud.crud_page import crud_page
from app.schemas.page import PageCreate

async def seed():
    async with AsyncSessionLocal() as db:
        # Create admin user if not exists
        admin = await crud_user.get_by_email(db, email="admin@mc.local")
        if not admin:
            admin = await crud_user.create(db, obj_in=UserCreate(
                email="admin@mc.local",
                name="Admin",
                role="admin",
                password="admin123",
                is_active=True
            ))
            print(f"Created admin user: {admin.email}")
        else:
            print(f"Admin user exists: {admin.email}")
        
        # Create root group if none exists
        groups = await crud_group.get_multi_ordered(db)
        if not groups:
            root = await crud_group.create(db, obj_in=GroupCreate(
                name="Site pages",
                parent_id=None,
                position=0
            ))
            print(f"Created root group: {root.name}")

if __name__ == "__main__":
    asyncio.run(seed())
