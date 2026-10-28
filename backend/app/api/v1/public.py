from fastapi import APIRouter

from app.api.v1.routes import public
from app.api.v1.routes.volunteer_applications import public_router as volunteer_public_router

public_router = APIRouter()

# public pages: /pages/...
public_router.include_router(public.router, prefix="/pages", tags=["public-pages"])

# same router at root level (homepage etc.), duplicate docs se bachne ke liye schema se hide
public_router.include_router(public.router, tags=["public"], include_in_schema=False)

# volunteer applications
public_router.include_router(
    volunteer_public_router,
    tags=["volunteer-applications"],
)