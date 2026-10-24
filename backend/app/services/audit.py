"""Append-only audit logging.

Every write in the admin API records an :class:`AuditLog` row so the
"Change log" view (mirroring the prototype's ``S.log``) is populated and the
production requirement for a server-side audit trail is met.
"""
from __future__ import annotations

from typing import Any, Dict, Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Request

from app.models.audit import AuditLog
from app.models.user import User


async def log_action(
    db: AsyncSession,
    user: Optional[User],
    action: str,
    target: str,
    target_type: Optional[str] = None,
    target_id: Optional[UUID] = None,
    meta: Optional[Dict[str, Any]] = None,
    request: Optional[Request] = None,
    commit: bool = True,
) -> AuditLog:
    """Record an audit entry. Called after the primary operation succeeds."""
    ip_address = None
    user_agent = None
    if request is not None:
        ip_address = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            ip_address = forwarded.split(",")[0].strip()

    entry = AuditLog(
        user_id=user.id if user else None,
        user_name=(user.name if user else "System"),
        action=action,
        target=target,
        target_type=target_type,
        target_id=target_id,
        meta=meta,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(entry)
    if commit:
        await db.commit()
        await db.refresh(entry)
    else:
        await db.flush()
    return entry
