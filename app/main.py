from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.router import api_router
from app.api.v1.admin import admin_router
from app.api.v1.public_api import public_router

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="FastAPI backend for Medically Complicated admin panel",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(admin_router, prefix=settings.ADMIN_PREFIX)
app.include_router(public_router, prefix="/api/v1")


@app.get("/")
def root():
    return {"message": "Medically Complicated Admin API", "version": settings.VERSION}


@app.get("/health")
def health():
    return {"status": "ok"}
