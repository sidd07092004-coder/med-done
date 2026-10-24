#!/usr/bin/env python3
import asyncio
import sys
from pathlib import Path

sys.path.append(str(Path('/home/aut007/Downloads/medically_complicated_admin_panel/backend').resolve()))

from app.db.base import Base
from app import models  # noqa
from app.db.session import AsyncSessionLocal, engine
from app.crud.crud_user import crud_user
from app.schemas.user import UserCreate
from app.crud.crud_group import crud_group
from app.schemas.group import GroupCreate


async def init_and_seed():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("✓ Database tables created/verified")
    
    async with AsyncSessionLocal() as db:
        admin = await crud_user.get_by_email(db, email="admin@example.com")
        if not admin:
            admin = await crud_user.create(db, obj_in=UserCreate(
                email="admin@example.com",
                name="Admin",
                role="admin",
                password="admin123",
                is_active=True
            ))
            print(f"✓ Created admin user: {admin.email}")
        else:
            print(f"✓ Admin user exists: {admin.email}")
        
        groups = await crud_group.get_multi_ordered(db)
        if not groups:
            root = await crud_group.create(db, obj_in=GroupCreate(
                name="Site pages",
                parent_id=None,
                position=0
            ))
            print(f"✓ Created root group: {root.name}")
        else:
            print(f"✓ Groups exist: {len(groups)}")


if __name__ == "__main__":
    asyncio.run(init_and_seed())
