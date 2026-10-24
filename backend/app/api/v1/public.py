from fastapi import APIRouter
from app.api.v1.routes import public

public_router = APIRouter()
public_router.include_router(public.router, prefix="/pages", tags=["public-pages"])
public_router.include_router(public.router)  # also add homepage at root level
