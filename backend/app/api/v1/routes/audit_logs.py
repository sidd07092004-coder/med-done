from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_current_active_admin
from app.models.audit import AuditLog
from app.models.user import User
from app.schemas.audit import AuditLogPage, AuditLogResponse

router = APIRouter()


@router.get("", response_model=AuditLogPage)
async def list_audit_logs(
    limit: int = Query(default=300, le=1000),
    skip: int = Query(default=0, ge=0),
    user_id: Optional[UUID] = Query(default=None),
    action: Optional[str] = Query(default=None),
    target_type: Optional[str] = Query(default=None),
    since: Optional[datetime] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_active_admin),
):
    stmt = select(AuditLog)
    count_stmt = select(func.count(AuditLog.id))
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id)
        count_stmt = count_stmt.where(AuditLog.user_id == user_id)
    if action:
        stmt = stmt.where(AuditLog.action.ilike(f"%{action}%"))
        count_stmt = count_stmt.where(AuditLog.action.ilike(f"%{action}%"))
    if target_type:
        stmt = stmt.where(AuditLog.target_type == target_type)
        count_stmt = count_stmt.where(AuditLog.target_type == target_type)
    if since:
        stmt = stmt.where(AuditLog.created_at >= since)
        count_stmt = count_stmt.where(AuditLog.created_at >= since)

    stmt = stmt.order_by(AuditLog.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(stmt)
    items = result.scalars().all()
    total = (await db.execute(count_stmt)).scalar() or 0
    return AuditLogPage(items=[AuditLogResponse.model_validate(i) for i in items], total=total)
