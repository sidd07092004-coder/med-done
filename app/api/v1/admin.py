from fastapi import APIRouter
from app.api.v1.routes import users, groups, pages

admin_router = APIRouter()
admin_router.include_router(users.router, prefix="/users", tags=["admin-users"])
admin_router.include_router(groups.router, prefix="/groups", tags=["admin-groups"])
admin_router.include_router(pages.router, prefix="/pages", tags=["admin-pages"])
