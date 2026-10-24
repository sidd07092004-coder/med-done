from fastapi import APIRouter
from fastapi.staticfiles import StaticFiles
from app.api.v1.routes import users, groups, pages, stats, audit_logs, data, media

admin_router = APIRouter()
admin_router.include_router(users.router, prefix="/users", tags=["admin-users"])
admin_router.include_router(groups.router, prefix="/groups", tags=["admin-groups"])
admin_router.include_router(pages.router, prefix="/pages", tags=["admin-pages"])
admin_router.include_router(stats.router, prefix="/stats", tags=["admin-stats"])
admin_router.include_router(audit_logs.router, prefix="/audit-logs", tags=["admin-audit"])
admin_router.include_router(data.router, tags=["admin-data"])
admin_router.include_router(media.router, prefix="/media", tags=["admin-media"])
