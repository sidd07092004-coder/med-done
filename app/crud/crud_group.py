from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from app.crud.base import CRUDBase
from app.models.group import Group


class CRUDGroup(CRUDBase[Group]):
    async def get_multi_ordered(self, db: AsyncSession) -> List[Group]:
        result = await db.execute(select(Group).order_by(Group.position, Group.name))
        return result.scalars().all()

    async def get_children(self, db: AsyncSession, parent_id: UUID) -> List[Group]:
        result = await db.execute(select(Group).where(Group.parent_id == parent_id).order_by(Group.position))
        return result.scalars().all()


crud_group = CRUDGroup(Group)
