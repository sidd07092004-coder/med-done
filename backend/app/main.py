import mimetypes
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from app.core.config import settings
from app.api.v1.router import api_router
from app.api.v1.admin import admin_router
from app.api.v1.public_api import public_router
from app.services.media_storage import (
    MediaStorageError,
    is_remote_storage_path,
    remote_file_exists,
    stream_remote_file,
)

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="FastAPI backend for Medically Complicated admin panel",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
)

# Serve uploaded media through a constrained route instead of StaticFiles.  The
# route never trusts the requested path (only ``Path(filename).name``), always
# sends hardening headers and can force an attachment download.
uploads_dir = Path(settings.UPLOAD_DIR)
if settings.MEDIA_STORAGE_BACKEND == "local":
    uploads_dir.mkdir(parents=True, exist_ok=True)


async def _upload_record(stored_name: str):
    """Return storage metadata for a known upload, or None for legacy files."""
    try:
        from sqlalchemy import select

        from app.db.session import AsyncSessionLocal
        from app.models.media import MediaFile

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(MediaFile.filename, MediaFile.storage_path, MediaFile.content_type).where(
                    MediaFile.public_url == f"/uploads/{stored_name}"
                )
            )
            return result.first()
    except Exception:
        # Preserve delivery of legacy files if the media table is unavailable.
        pass
    return None


@app.get("/uploads/{filename}", include_in_schema=False)
async def serve_upload(filename: str, download: bool = False):
    name = Path(filename).name
    if not name or name in {".", ".."}:
        raise HTTPException(status_code=404, detail="File not found")
    record = await _upload_record(name)
    headers = {
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
    }

    if record and is_remote_storage_path(record.storage_path):
        try:
            exists = await remote_file_exists(record.storage_path)
        except MediaStorageError as exc:
            raise HTTPException(status_code=503, detail="Media storage is unavailable") from exc
        if not exists:
            raise HTTPException(status_code=404, detail="File not found")
        media_type = record.content_type or mimetypes.guess_type(name)[0]
        if download:
            headers["Content-Disposition"] = (
                f"attachment; filename*=UTF-8''{quote(record.filename, safe='')}"
            )
        return StreamingResponse(
            stream_remote_file(record.storage_path),
            media_type=media_type or "application/octet-stream",
            headers=headers,
        )

    path = uploads_dir / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    if download:
        return FileResponse(
            path,
            headers=headers,
            filename=record.filename if record else name,
            content_disposition_type="attachment",
        )
    return FileResponse(path, headers=headers)


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
