from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID
from typing import List, Optional

from app.api.deps import get_db, get_current_active_admin, get_current_active_user
from app.crud.crud_group import crud_group
from app.models.page import Page
from app.models.user import User
from app.services.audit import log_action
from app.schemas.group import GroupCreate, GroupUpdate, GroupResponse, GroupTree, GroupMoveRequest

router = APIRouter()


async def _page_counts(db: AsyncSession):
    result = await db.execute(
        select(Page.group_id, func.count(Page.id)).where(Page.lang == "en").group_by(Page.group_id)
    )
    return {row[0]: row[1] for row in result.all()}


def build_tree(groups, counts):
    group_dict = {}
    for g in groups:
        gd = GroupTree.model_validate({
            'id': g.id,
            'name': g.name,
            'name_translations': g.name_translations or {},
            'parent_id': g.parent_id,
            'position': g.position,
            'path': g.path,
            'created_at': g.created_at,
            'updated_at': g.updated_at,
            'children': [],
            'pages_count': counts.get(g.id, 0),
        }, from_attributes=False)
        group_dict[g.id] = gd
    roots = []
    for g in groups:
        if g.parent_id is None:
            roots.append(group_dict[g.id])
        else:
            parent = group_dict.get(g.parent_id)
            if parent:
                parent.children.append(group_dict[g.id])
    return roots


@router.get("/", response_model=List[GroupTree])
async def list_groups(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    groups = await crud_group.get_multi_ordered(db)
    counts = await _page_counts(db)
    return build_tree(groups, counts)


@router.post("/", response_model=GroupResponse)
async def create_group(group_in: GroupCreate, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    group = await crud_group.create(db, obj_in=group_in)
    await log_action(db, admin, "Created group", group.name, "group", group.id, request=request)
    return group


@router.get("/{group_id}", response_model=GroupResponse)
async def get_group(group_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    group = await crud_group.get(db, id=group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


@router.patch("/{group_id}", response_model=GroupResponse)
async def update_group(group_id: UUID, group_in: GroupUpdate, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    group = await crud_group.get(db, id=group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    data = group_in.dict(exclude_unset=True)
    # `null` means "leave translations unchanged" (the column is NOT NULL).
    if data.get("name_translations") is None:
        data.pop("name_translations", None)
    # Re-parenting via PATCH uses the same guarded logic as /move.
    if "parent_id" in data and data["parent_id"] != group.parent_id:
        try:
            group = await crud_group.move(db, group, data.pop("parent_id"), data.pop("position", None))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    if data:
        old_name = group.name
        group = await crud_group.update(db, db_obj=group, obj_in=data)
        if "name" in data:
            await crud_group._assign_path(db, group)
            await db.commit()
            await db.refresh(group)
            await log_action(db, admin, "Renamed group", f"{old_name} to {group.name}", "group", group.id, request=request)
        else:
            await log_action(db, admin, "Updated group", group.name, "group", group.id, request=request)
    return group


@router.patch("/{group_id}/move", response_model=GroupResponse)
async def move_group(group_id: UUID, move_in: GroupMoveRequest, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    group = await crud_group.get(db, id=group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    try:
        group = await crud_group.move(db, group, move_in.parent_id, move_in.position)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await log_action(db, admin, "Moved group", group.name, "group", group.id, request=request)
    return group


@router.delete("/{group_id}")
async def delete_group(group_id: UUID, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    group = await crud_group.get(db, id=group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    children = await crud_group.get_children(db, parent_id=group_id)
    if children:
        raise HTTPException(status_code=400, detail="Cannot delete group with subgroups")
    # Prevent orphaning pages.
    pages = await db.execute(select(func.count(Page.id)).where(Page.group_id == group_id))
    if (pages.scalar() or 0) > 0:
        raise HTTPException(status_code=400, detail="Cannot delete group that still contains pages")
    name = group.name
    await crud_group.delete(db, id=group_id)
    await log_action(db, admin, "Deleted group", name, "group", group_id, request=request)
    return {"message": "Group deleted"}
