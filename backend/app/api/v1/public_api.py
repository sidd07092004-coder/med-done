from fastapi import APIRouter
from app.api.v1.routes import forms
from app.api.v1.routes.public import router as pub_router
from app.api.v1.routes.volunteer_applications import public_router as volunteer_public_router

public_router = APIRouter()
public_router.include_router(pub_router, tags=["public"])
public_router.include_router(forms.public_router, tags=["public-forms"])

public_router.include_router(pub_router, tags=["public"])
public_router.include_router(
    volunteer_public_router,
    tags=["volunteer-applications"],
)
