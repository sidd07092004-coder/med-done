from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from app.api.deps import get_db
from app.crud.crud_page import crud_page
from app.schemas.page import PagePublic

router = APIRouter()


@router.get("/pages/{slug}", response_model=PagePublic)
async def get_public_page(
    slug: str,
    lang: str = Query(default="en"),
    db: AsyncSession = Depends(get_db),
):
    page = await crud_page.get_by_slug_and_status(db, slug=slug, lang=lang, status="published")
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return PagePublic.model_validate(page, from_attributes=True)


@router.get("/homepage", response_model=PagePublic)
async def get_homepage(lang: str = Query(default="en"), db: AsyncSession = Depends(get_db)):
    page = await crud_page.get_by_slug_and_status(db, slug="home", lang=lang, status="published")
    if not page:
        # also try is_homepage
        from sqlalchemy import select
        result = await db.execute(select(crud_page.model).where(crud_page.model.is_homepage == True, crud_page.model.status == "published", crud_page.model.lang == lang))
        page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="Homepage not found")
    return PagePublic.model_validate(page, from_attributes=True)


@router.get("/pages", response_model=List[PagePublic])
async def list_public_pages(lang: str = Query(default="en"), db: AsyncSession = Depends(get_db)):
    pages = await crud_page.get_published(db, lang=lang)
    return [PagePublic.model_validate(p, from_attributes=True) for p in pages]
