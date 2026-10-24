from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from app.api.deps import get_db
from app.crud.crud_group import crud_group
from app.crud.crud_page import crud_page
from app.schemas.navigation import NavigationGroup, NavigationPage, NavigationResponse
from app.schemas.page import PagePublic
from app.services.group_names import localized_group_name

router = APIRouter()


# NOTE: `/homepage` and `/pages` are registered before `/pages/{slug:path}`
# so the `:path` converter can never shadow the exact-match routes
# (Starlette matches routes in declaration order).
@router.get("/homepage", response_model=PagePublic)
async def get_homepage(lang: str = Query(default="en"), db: AsyncSession = Depends(get_db)):
    """Return the published homepage for ``lang``.

    The explicit admin flag (``is_homepage``) takes precedence over the legacy
    ``home`` slug. The slug remains as a compatibility fallback for older sites
    where no page has been flagged. Only ``published`` pages are eligible.
    """
    result = await db.execute(
        select(crud_page.model)
        .where(
            crud_page.model.is_homepage.is_(True),
            crud_page.model.status == "published",
            crud_page.model.lang == lang,
        )
        .order_by(
            crud_page.model.position.asc(),
            crud_page.model.created_at.asc(),
            crud_page.model.id.asc(),
        )
        .limit(1)
    )
    page = result.scalars().first()
    if not page:
        page = await crud_page.get_by_slug_and_status(
            db, slug="home", lang=lang, status="published"
        )
    if not page:
        raise HTTPException(status_code=404, detail="Homepage not found")
    return PagePublic.model_validate(page, from_attributes=True)


@router.get("/pages", response_model=List[PagePublic])
async def list_public_pages(lang: str = Query(default="en"), db: AsyncSession = Depends(get_db)):
    pages = await crud_page.get_published(db, lang=lang)
    return [PagePublic.model_validate(p, from_attributes=True) for p in pages]


@router.get("/pages/{slug:path}", response_model=PagePublic)
async def get_public_page(
    slug: str,
    lang: str = Query(default="en"),
    db: AsyncSession = Depends(get_db),
):
    page = await crud_page.get_by_slug_and_status(db, slug=slug, lang=lang, status="published")
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return PagePublic.model_validate(page, from_attributes=True)


@router.get("/navigation", response_model=NavigationResponse)
async def get_navigation(lang: str = Query(default="en"), db: AsyncSession = Depends(get_db)):
    """Site menu in one call: the group tree (language-independent) plus all
    published pages for `lang` (flat, ordered by group then position)."""
    # Groups: one query, then build the parent/child tree in memory.
    groups = await crud_group.get_multi_ordered(db)
    nodes = {
        g.id: NavigationGroup(
            id=g.id,
            name=localized_group_name(g, lang),
            name_translations=g.name_translations or {},
            path=g.path,
            parent_id=g.parent_id,
            position=g.position or 0,
        )
        for g in groups
    }
    roots: List[NavigationGroup] = []
    for g in groups:
        node = nodes[g.id]
        parent = nodes.get(g.parent_id) if g.parent_id is not None else None
        if parent is not None:
            parent.children.append(node)
        else:
            roots.append(node)

    def sort_tree(items: List[NavigationGroup]) -> None:
        items.sort(key=lambda n: (n.position, n.name))
        for item in items:
            sort_tree(item.children)

    sort_tree(roots)

    # Pages: published only, for the requested lang, projected flat.
    pages = await crud_page.get_published(db, lang=lang)
    nav_pages = [
        NavigationPage(
            id=p.id,
            title=p.title,
            slug=p.slug,
            group_id=p.group_id,
            position=p.position or 0,
        )
        for p in pages
    ]
    nav_pages.sort(key=lambda p: (p.group_id, p.position, p.title))

    return NavigationResponse(lang=lang, groups=roots, pages=nav_pages)
