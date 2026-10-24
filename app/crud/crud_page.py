from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from app.crud.base import CRUDBase
from app.models.page import Page
from app.services.content_text import extract_clean_text


class CRUDPage(CRUDBase[Page]):
    async def create(self, db: AsyncSession, obj_in) -> Page:
        obj_in_data = obj_in.dict() if hasattr(obj_in, "dict") else obj_in
        if "content" in obj_in_data:
            obj_in_data["content_text"] = extract_clean_text(obj_in_data["content"])
        else:
            obj_in_data["content"] = {}
            obj_in_data["content_text"] = ""
        db_obj = self.model(**obj_in_data)
        db.add(db_obj)
        await db.commit()
        await db.refresh(db_obj)
        return db_obj

    async def update(self, db: AsyncSession, db_obj: Page, obj_in) -> Page:
        update_data = obj_in.dict(exclude_unset=True) if hasattr(obj_in, "dict") else obj_in
        if "content" in update_data and update_data["content"] is not None:
            update_data["content_text"] = extract_clean_text(update_data["content"])
        for field, value in update_data.items():
            setattr(db_obj, field, value)
        db.add(db_obj)
        await db.commit()
        await db.refresh(db_obj)
        return db_obj

    async def get_by_slug(self, db: AsyncSession, slug: str, lang: str = "en") -> Optional[Page]:
        result = await db.execute(select(Page).where(Page.slug == slug, Page.lang == lang))
        return result.scalar_one_or_none()

    async def get_by_slug_and_status(self, db: AsyncSession, slug: str, lang: str = "en", status: str = "published") -> Optional[Page]:
        result = await db.execute(select(Page).where(Page.slug == slug, Page.lang == lang, Page.status == status))
        return result.scalar_one_or_none()

    async def get_by_group(self, db: AsyncSession, group_id: UUID, lang: str = "en") -> List[Page]:
        result = await db.execute(select(Page).where(Page.group_id == group_id, Page.lang == lang).order_by(Page.position, Page.created_at))
        return result.scalars().all()

    async def get_pending(self, db: AsyncSession) -> List[Page]:
        result = await db.execute(select(Page).where(Page.status == "pending"))
        return result.scalars().all()

    async def get_published(self, db: AsyncSession, lang: str = "en") -> List[Page]:
        result = await db.execute(select(Page).where(Page.status == "published", Page.lang == lang))
        return result.scalars().all()


crud_page = CRUDPage(Page)
