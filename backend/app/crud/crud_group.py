from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID

from app.crud.base import CRUDBase
from app.models.group import Group
from app.models.page import Page


class CRUDGroup(CRUDBase[Group]):
    async def get_multi_ordered(self, db: AsyncSession) -> List[Group]:
        result = await db.execute(select(Group).order_by(Group.position, Group.name))
        return result.scalars().all()

    async def get_children(self, db: AsyncSession, parent_id: UUID) -> List[Group]:
        result = await db.execute(select(Group).where(Group.parent_id == parent_id).order_by(Group.position))
        return result.scalars().all()

    async def next_position(self, db: AsyncSession, parent_id: Optional[UUID]) -> int:
        stmt = select(func.coalesce(func.max(Group.position), -1)).where(
            Group.parent_id == parent_id if parent_id is not None else Group.parent_id.is_(None)
        )
        result = await db.execute(stmt)
        return int(result.scalar() or -1) + 1

    async def create(self, db: AsyncSession, obj_in) -> Group:
        obj_in_data = obj_in.dict() if hasattr(obj_in, "dict") else dict(obj_in)
        if obj_in_data.get("position") in (None, 0):
            obj_in_data["position"] = await self.next_position(db, obj_in_data.get("parent_id"))
        db_obj = self.model(**obj_in_data)
        # Compute the materialised path (parent.path/name).
        await self._assign_path(db, db_obj)
        db.add(db_obj)
        await db.commit()
        await db.refresh(db_obj)
        return db_obj

    async def _assign_path(self, db: AsyncSession, group: Group) -> None:
        if group.parent_id:
            parent = await self.get(db, group.parent_id)
            base = (parent.path if parent and parent.path else (parent.name if parent else ""))
            group.path = f"{base}/{group.name}" if base else group.name
        else:
            group.path = group.name

    async def is_descendant(self, db: AsyncSession, candidate_id: UUID, ancestor_id: UUID) -> bool:
        """True if candidate_id is ancestor_id or nested beneath it (prevents cycles)."""
        current_id: Optional[UUID] = candidate_id
        seen = set()
        while current_id and current_id not in seen:
            if current_id == ancestor_id:
                return True
            seen.add(current_id)
            group = await self.get(db, current_id)
            current_id = group.parent_id if group else None
        return False

    async def move(self, db: AsyncSession, group: Group, new_parent_id: Optional[UUID], position: Optional[int] = None) -> Group:
        if new_parent_id is not None:
            if new_parent_id == group.id:
                raise ValueError("A group cannot be its own parent")
            if await self.is_descendant(db, new_parent_id, group.id):
                raise ValueError("Cannot move a group inside one of its own subgroups")
        siblings = await self.get_children(db, new_parent_id)
        ordered = [g for g in siblings if g.id != group.id]
        if position is None:
            position = len(ordered)
        position = max(0, min(int(position), len(ordered)))
        group.parent_id = new_parent_id
        group.position = position
        ordered.insert(position, group)
        for idx, sib in enumerate(ordered):
            sib.position = idx
            if sib.id == group.id:
                sib.parent_id = new_parent_id
        await self._assign_path(db, group)
        db.add(group)
        await db.commit()
        await db.refresh(group)
        return group


crud_group = CRUDGroup(Group)
