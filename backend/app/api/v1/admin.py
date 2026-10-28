from fastapi import APIRouter
from fastapi.staticfiles import StaticFiles
from app.api.v1.routes import (
    audit_logs,
    data,
    forms,
    groups,
    media,
    pages,
    stats,
    users,
    volunteer_applications
)

# Aggregate router that exposes all admin endpoints.
admin_router = APIRouter()

# User management.
admin_router.include_router(users.router, prefix="/users", tags=["admin-users"])

# Page groups.
admin_router.include_router(groups.router, prefix="/groups", tags=["admin-groups"])

# Pages (CRUD, approval workflow, revisions, translations).
admin_router.include_router(pages.router, prefix="/pages", tags=["admin-pages"])

# Dashboard statistics.
admin_router.include_router(stats.router, prefix="/stats", tags=["admin-stats"])

# Audit log viewer.
admin_router.include_router(audit_logs.router, prefix="/audit-logs", tags=["admin-audit"])

# Data endpoints (no prefix; routes define their own paths).
admin_router.include_router(data.router, tags=["admin-data"])

# Media uploads.
admin_router.include_router(media.router, prefix="/media", tags=["admin-media"])

# Form management.
admin_router.include_router(
    forms.admin_router,
    prefix="/forms",
    tags=["admin-forms"],
)

# Static Volunteer Application management
admin_router.include_router(
    volunteer_applications.admin_router,
    prefix="/volunteer-applications",
    tags=["admin-volunteer-applications"],
)
