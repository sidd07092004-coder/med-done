from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
from typing import List

from app.api.deps import get_db, get_current_active_admin, get_current_active_user
from app.crud.crud_group import crud_group
from app.schemas.group import GroupCreate, GroupUpdate, GroupResponse, GroupTree

router = APIRouter()


def build_tree(groups):
    # Build tree without triggering lazy loading during validation
    group_dict = {}
    for g in groups:
        gd = GroupTree.model_validate({
            'id': g.id,
            'name': g.name,
            'parent_id': g.parent_id,
            'position': g.position,
            'path': g.path,
            'created_at': g.created_at,
            'updated_at': g.updated_at,
            'children': [],
            'pages_count': 0
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
async def list_groups(db: AsyncSession = Depends(get_db), user=Depends(get_current_active_user)):
    groups = await crud_group.get_multi_ordered(db)
    return build_tree(groups)


@router.post("/", response_model=GroupResponse)
async def create_group(group_in: GroupCreate, db: AsyncSession = Depends(get_db), admin=Depends(get_current_active_admin)):
    return await crud_group.create(db, obj_in=group_in)


@router.get("/{group_id}", response_model=GroupResponse)
async def get_group(group_id: UUID, db: AsyncSession = Depends(get_db), user=Depends(get_current_active_user)):
    group = await crud_group.get(db, id=group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


@router.patch("/{group_id}", response_model=GroupResponse)
async def update_group(group_id: UUID, group_in: GroupUpdate, db: AsyncSession = Depends(get_db), admin=Depends(get_current_active_admin)):
    group = await crud_group.get(db, id=group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return await crud_group.update(db, db_obj=group, obj_in=group_in)


@router.delete("/{group_id}")
async def delete_group(group_id: UUID, db: AsyncSession = Depends(get_db), admin=Depends(get_current_active_admin)):
    group = await crud_group.get(db, id=group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    # Check children
    children = await crud_group.get_children(db, parent_id=group_id)
    if children:
        raise HTTPException(status_code=400, detail="Cannot delete group with subgroups")
    await crud_group.delete(db, id=group_id)
    return {"message": "Group deleted"}
