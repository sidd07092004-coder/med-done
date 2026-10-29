from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, cast, String, update
from uuid import UUID

from app.crud.base import CRUDBase
from app.models.page import Page
from app.models.revision import PageRevision
from app.models.contributor import PageContributor
from app.services.content_text import extract_clean_text
from app.services.sanitize import sanitize_content


class CRUDPage(CRUDBase[Page]):
    async def next_position(self, db: AsyncSession, group_id: UUID) -> int:
        result = await db.execute(
            select(func.coalesce(func.max(Page.position), -1)).where(Page.group_id == group_id)
        )
        current = result.scalar()
        return int(current if current is not None else -1) + 1

    async def _unset_other_homepages(self, db: AsyncSession, *, lang: str, keep_id: UUID) -> None:
        """Clear is_homepage on every other page in the same language."""
        await db.execute(
            update(Page)
            .where(
                Page.lang == lang,
                Page.is_homepage.is_(True),
                Page.id != keep_id,
            )
            .values(is_homepage=False)
        )

    async def create(self, db: AsyncSession, obj_in) -> Page:
        obj_in_data = obj_in.dict() if hasattr(obj_in, "dict") else dict(obj_in)
        content = sanitize_content(obj_in_data.get("content"))
        obj_in_data["content"] = content
        obj_in_data["content_text"] = extract_clean_text(content)
        if obj_in_data.get("position") in (None, 0) and obj_in_data.get("group_id"):
            obj_in_data["position"] = await self.next_position(db, obj_in_data["group_id"])
        db_obj = self.model(**obj_in_data)
        db.add(db_obj)
        await db.flush()
        if db_obj.is_homepage is True:
            await self._unset_other_homepages(db, lang=db_obj.lang, keep_id=db_obj.id)
        await db.commit()
        await db.refresh(db_obj)
        return db_obj

    async def update(self, db: AsyncSession, db_obj: Page, obj_in) -> Page:
        update_data = obj_in.dict(exclude_unset=True) if hasattr(obj_in, "dict") else dict(obj_in)
        
        if "content" in update_data and update_data["content"] is not None:
            incoming_content = update_data["content"]

            # Preserve existing content keys, such as form, when omitted in PATCH
            existing_content = db_obj.content or {}
            merged_content = {
                **existing_content,
                **incoming_content,
            }

            # Merge theme separately so partial theme updates preserve other settings
            if "theme" in existing_content and "theme" in incoming_content:
                merged_content["theme"] = {
                    **(existing_content.get("theme") or {}),
                    **(incoming_content.get("theme") or {}),
                }

            content = sanitize_content(merged_content)

            print("SANITIZED BLOCKS:", content.get("blocks"))
            update_data["content"] = content
            update_data["content_text"] = extract_clean_text(content)

        for field, value in update_data.items():
            setattr(db_obj, field, value)
        db.add(db_obj)
        if update_data.get("is_homepage") is True:
            await db.flush()
            await self._unset_other_homepages(db, lang=db_obj.lang, keep_id=db_obj.id)
        await db.commit()
        await db.refresh(db_obj)
        return db_obj

    async def get_multi_filtered(
        self,
        db: AsyncSession,
        group_id: Optional[UUID] = None,
        lang: Optional[str] = None,
        status: Optional[str] = None,
        q: Optional[str] = None,
        include_homepage: bool = False,
        skip: int = 0,
        limit: int = 10000,
    ) -> List[Page]:
        stmt = select(Page)
        if group_id is not None:
            stmt = stmt.where(Page.group_id == group_id)
        if lang and lang != "all":
            stmt = stmt.where(Page.lang == lang)
        if status and status != "all":
            stmt = stmt.where(Page.status == status)
        if not include_homepage:
            stmt = stmt.where(Page.is_homepage == False)  # noqa: E712
            stmt = stmt.where(Page.slug != "home")
        if q:
            like = f"%{q}%"
            stmt = stmt.where(
                or_(Page.title.ilike(like), Page.content_text.ilike(like), Page.slug.ilike(like))
            )
        stmt = stmt.order_by(Page.group_id, Page.position, Page.created_at).offset(skip).limit(limit)
        result = await db.execute(stmt)
        return result.scalars().all()

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
        result = await db.execute(select(Page).where(Page.status == "pending").order_by(Page.updated_at))
        return result.scalars().all()

    async def get_published(self, db: AsyncSession, lang: str = "en") -> List[Page]:
        result = await db.execute(select(Page).where(Page.status == "published", Page.lang == lang))
        return result.scalars().all()

    async def list_revisions(self, db: AsyncSession, page_id: UUID, limit: int = 50) -> List[PageRevision]:
        result = await db.execute(
            select(PageRevision)
            .where(PageRevision.page_id == page_id)
            .order_by(PageRevision.created_at.desc())
            .limit(limit)
        )
        return result.scalars().all()

    async def list_translations(self, db: AsyncSession, page_id: UUID) -> List[Page]:
        result = await db.execute(
            select(Page).where(Page.translation_of_id == page_id).order_by(Page.lang)
        )
        return result.scalars().all()

    async def list_contributors(self, db: AsyncSession, page_id: UUID) -> List[PageContributor]:
        result = await db.execute(
            select(PageContributor)
            .where(PageContributor.page_id == page_id)
            .order_by(PageContributor.created_at)
        )
        return result.scalars().all()

    async def add_contributor(self, db: AsyncSession, page_id: UUID, name: str, role: str, added_by_id: Optional[UUID]) -> PageContributor:
        contributor = PageContributor(page_id=page_id, name=name, role=role, added_by_id=added_by_id)
        db.add(contributor)
        await db.commit()
        await db.refresh(contributor)
        return contributor

    async def remove_contributor(self, db: AsyncSession, contributor_id: UUID) -> bool:
        result = await db.execute(select(PageContributor).where(PageContributor.id == contributor_id))
        contributor = result.scalar_one_or_none()
        if not contributor:
            return False
        await db.delete(contributor)
        await db.commit()
        return True

    async def move(self, db: AsyncSession, page: Page, new_group_id: UUID, position: Optional[int] = None) -> Page:
        """Move a page to a group (and optionally an index), reindexing siblings."""
        old_group_id = page.group_id
        page.group_id = new_group_id
        if position is None:
            position = await self.next_position(db, new_group_id)
        page.position = int(position)
        # Reindex siblings in the destination group so positions stay dense.
        siblings = await self.get_by_group(db, new_group_id, lang=page.lang)
        ordered = [p for p in siblings if p.id != page.id]
        ordered.insert(min(position, len(ordered)), page)
        for idx, sib in enumerate(ordered):
            sib.position = idx
            if sib.id == page.id:
                sib.group_id = new_group_id
        db.add(page)
        await db.commit()
        await db.refresh(page)
        return page


crud_page = CRUDPage(Page)
