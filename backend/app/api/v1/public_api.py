from fastapi import APIRouter
from app.api.v1.routes import forms
from app.api.v1.routes.public import router as pub_router

public_router = APIRouter()
public_router.include_router(pub_router, tags=["public"])
public_router.include_router(forms.public_router, tags=["public-forms"])
