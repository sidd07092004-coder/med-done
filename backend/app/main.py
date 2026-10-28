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
# Swagger UI's multipart uploader requires OpenAPI 3.0's binary file format.
app.openapi_version = "3.0.3"

# Serve uploaded media through a constrained route instead of StaticFiles.  The
# route never trusts the requested path (only ``Path(filename).name``), always
# sends hardening headers and can force an attachment download.
uploads_dir = Path(settings.UPLOAD_DIR)

# The local uploads folder is only needed when files are stored on disk.
if settings.MEDIA_STORAGE_BACKEND == "local":
    uploads_dir.mkdir(parents=True, exist_ok=True)


async def _upload_record(stored_name: str):
    """Return storage metadata for a known upload, or None for legacy files."""
    try:
        # Imported lazily so the app can still start if the DB layer is unavailable.
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
    # Strip any directory parts to block path traversal (e.g. "../secret").
    name = Path(filename).name
    if not name or name in {".", ".."}:
        raise HTTPException(status_code=404, detail="File not found")

    # Look up the file in the media table (None for legacy files without a record).
    record = await _upload_record(name)

    # Hardening headers sent with every file: no MIME sniffing, sandboxed content.
    headers = {
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
    }

    # Case 1: the file lives on the remote (SFTP) storage; stream it through.
    if record and is_remote_storage_path(record.storage_path):
        try:
            exists = await remote_file_exists(record.storage_path)
        except MediaStorageError as exc:
            raise HTTPException(status_code=503, detail="Media storage is unavailable") from exc
        if not exists:
            raise HTTPException(status_code=404, detail="File not found")
        media_type = record.content_type or mimetypes.guess_type(name)[0]
        if download:
            # RFC 5987 encoding so non-ASCII file names download correctly.
            headers["Content-Disposition"] = (
                f"attachment; filename*=UTF-8''{quote(record.filename, safe='')}"
            )
        return StreamingResponse(
            stream_remote_file(record.storage_path),
            media_type=media_type or "application/octet-stream",
            headers=headers,
        )

    # Case 2: the file is on local disk (new local uploads and legacy files).
    path = uploads_dir / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    if download:
        return FileResponse(
            path,
            headers=headers,
            # Use the original upload name when known, else the stored name.
            filename=record.filename if record else name,
            content_disposition_type="attachment",
        )
    return FileResponse(path, headers=headers)


# CORS: allow the configured frontend origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routers.
app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(admin_router, prefix=settings.ADMIN_PREFIX)
app.include_router(public_router, prefix="/api/v1")

@app.get("/")
def root():
    return {"message": "Medically Complicated Admin API", "version": settings.VERSION}


@app.get("/health")
def health():
    return {"status": "ok"}