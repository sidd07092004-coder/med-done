import uuid
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_current_active_admin, get_current_active_user
from app.core.config import settings
from app.models.media import MediaFile
from app.models.user import User
from app.services.audit import log_action
from app.services.media_storage import (
    MediaFileTooLarge,
    MediaStorageError,
    delete_storage_path,
    save_upload,
)
from app.schemas.media import MediaFileResponse

router = APIRouter()

# Extensions accepted by the media library (spec §6.8). SVG, HTML, scripts and
# executables are deliberately absent and are rejected by the allow-list.
EXTENSION_KINDS = {
    ".jpg": "image",
    ".jpeg": "image",
    ".png": "image",
    ".webp": "image",
    ".gif": "image",
    ".pdf": "document",
    ".docx": "document",
    ".mp4": "video",
    ".webm": "video",
    ".mp3": "audio",
    ".m4a": "audio",
    ".ogg": "audio",
    ".vtt": "captions",
}

EXTENSION_CONTENT_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".vtt": "text/vtt",
}

# MIME types we never accept even when the extension is on the allow-list.
DANGEROUS_CONTENT_TYPES = {
    "image/svg+xml",
    "text/html",
    "application/xhtml+xml",
    "application/javascript",
    "text/javascript",
    "application/x-msdownload",
    "application/x-executable",
    "application/x-sh",
    "text/x-shellscript",
}

_KIND_LIMIT_SETTINGS = {
    "image": "MAX_IMAGE_UPLOAD_MB",
    "document": "MAX_DOCUMENT_UPLOAD_MB",
    "audio": "MAX_AUDIO_UPLOAD_MB",
    "video": "MAX_VIDEO_UPLOAD_MB",
    "captions": "MAX_CAPTIONS_UPLOAD_MB",
}


def _limit_bytes(kind: str) -> int:
    return int(getattr(settings, _KIND_LIMIT_SETTINGS[kind])) * 1024 * 1024


@router.post("/upload", response_model=MediaFileResponse)
async def upload_media(
    file: UploadFile = File(...),
    request: Request = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    original_name = Path(file.filename or "").name
    ext = Path(original_name).suffix.lower()
    kind = EXTENSION_KINDS.get(ext)
    if kind is None:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    declared_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if declared_type in DANGEROUS_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    storage_ext = ".jpg" if ext == ".jpeg" else ext
    dest_name = f"{uuid.uuid4().hex}{storage_ext}"
    limit = _limit_bytes(kind)
    try:
        storage_path, size_bytes = await save_upload(file, dest_name, limit)
    except MediaFileTooLarge as exc:
        raise HTTPException(
            status_code=413,
            detail=f"{kind.capitalize()} file too large (max {limit // (1024 * 1024)} MB)",
        ) from exc
    except MediaStorageError as exc:
        raise HTTPException(status_code=503, detail="Media storage is unavailable") from exc
    public_url = f"/uploads/{dest_name}"
    media = MediaFile(
        filename=original_name or dest_name,
        content_type=declared_type or EXTENSION_CONTENT_TYPES[ext],
        size_bytes=size_bytes,
        storage_path=storage_path,
        public_url=public_url,
        uploaded_by_id=user.id,
    )
    db.add(media)
    await db.commit()
    await db.refresh(media)
    await log_action(db, user, "Uploaded media", media.filename, "media", media.id, request=request)
    return MediaFileResponse.model_validate(media)


@router.get("/", response_model=List[MediaFileResponse])
async def list_media(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_active_user)):
    result = await db.execute(select(MediaFile).order_by(MediaFile.created_at.desc()))
    return [MediaFileResponse.model_validate(m) for m in result.scalars().all()]


@router.delete("/{media_id}")
async def delete_media(media_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_active_admin)):
    result = await db.execute(select(MediaFile).where(MediaFile.id == media_id))
    media = result.scalar_one_or_none()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")
    try:
        await delete_storage_path(media.storage_path)
    except MediaStorageError as exc:
        raise HTTPException(status_code=503, detail="Media storage is unavailable") from exc
    except OSError:
        pass
    await db.delete(media)
    await db.commit()
    await log_action(db, admin, "Deleted media", media.filename, "media", media_id, request=request)
    return {"message": "Media deleted"}
