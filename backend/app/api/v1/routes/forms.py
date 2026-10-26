
import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_current_active_admin
from app.core.config import settings
from app.models.media import MediaFile
from app.models.page import Page, PageStatus
from app.models.form_submission import FormSubmission
from app.models.user import User
from app.schemas.form_submission import (
    FormSubmissionCreate,
    FormSubmissionReceipt,
    FormSubmissionResponse,
    FormSubmissionReview,
)
from app.services.dynamic_forms import (
    FILE_TYPE_BY_EXTENSION,
    file_signature_matches,
    validate_form_config,
    validate_submission,
)


public_router = APIRouter()
admin_router = APIRouter()
UPLOAD_DIR = Path(settings.UPLOAD_DIR)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


async def _get_published_form(
    db: AsyncSession,
    slug: str,
    lang: str,
) -> tuple[Page, dict, list[dict]]:
    result = await db.execute(
        select(Page).where(
            Page.live_slug == slug,
            Page.lang == lang,
            Page.status == PageStatus.PUBLISHED,
        )
    )
    page = result.scalar_one_or_none()

    if not page or not page.live_content:
        raise HTTPException(status_code=404, detail="Published form not found")

    form = page.live_content.get("form")
    if not isinstance(form, dict) or form.get("enabled", True) is False:
        raise HTTPException(status_code=404, detail="This page has no active form")

    fields = form.get("fields")
    if not isinstance(fields, list) or not fields:
        raise HTTPException(status_code=422, detail="Form configuration is invalid")

    validate_form_config({"form": form}, require_fields=True)
    return page, form, fields


async def _store_form_upload(
    upload: UploadFile,
    field: dict,
) -> tuple[Path, int, str, str]:
    original_filename = (upload.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    extension = Path(original_filename).suffix.lower()
    expected_content_type = FILE_TYPE_BY_EXTENSION.get(extension)
    accepted_extensions = {
        item.lower()
        for item in field.get("accept", list(FILE_TYPE_BY_EXTENSION))
    }

    if extension not in accepted_extensions or expected_content_type is None:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file extension for field '{field['name']}'",
        )
    if (upload.content_type or "").lower() != expected_content_type:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file content type for field '{field['name']}'",
        )

    max_size_mb = min(
        field.get("max_size_mb", settings.MAX_UPLOAD_SIZE_MB),
        settings.MAX_UPLOAD_SIZE_MB,
    )
    max_size_bytes = max_size_mb * 1024 * 1024
    dest_path = UPLOAD_DIR / f"{uuid.uuid4().hex}{extension}"
    size_bytes = 0
    signature = bytearray()

    try:
        with dest_path.open("wb") as destination:
            while chunk := await upload.read(1024 * 1024):
                size_bytes += len(chunk)
                if size_bytes > max_size_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File for field '{field['name']}' exceeds the size limit",
                    )
                if len(signature) < 12:
                    signature.extend(chunk[: 12 - len(signature)])
                destination.write(chunk)
    except Exception:
        dest_path.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()

    if size_bytes == 0:
        dest_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=422,
            detail=f"File for field '{field['name']}' is empty",
        )
    if not file_signature_matches(extension, bytes(signature)):
        dest_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=422,
            detail=f"File content does not match its extension for field '{field['name']}'",
        )

    return dest_path, size_bytes, original_filename, expected_content_type


@admin_router.get("/{page_id}/config")
async def get_form_config(
    page_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_active_admin),
):
    page = await db.get(Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    form = page.content.get("form") if isinstance(page.content, dict) else None
    if not isinstance(form, dict):
        raise HTTPException(status_code=404, detail="Page has no form configuration")

    validate_form_config({"form": form})
    return form


@public_router.post(
    "/forms/{slug:path}/submissions",
    response_model=FormSubmissionReceipt,
    status_code=status.HTTP_201_CREATED,
)
async def submit_form(
    slug: str,
    payload: FormSubmissionCreate,
    lang: str = Query(default="en"),
    db: AsyncSession = Depends(get_db),
):
    page, form, fields = await _get_published_form(db, slug, lang)
    file_fields = {
        field["name"]
        for field in fields
        if field.get("type") == "file"
    }
    if file_fields.intersection(payload.responses):
        raise HTTPException(
            status_code=422,
            detail="Upload file fields using the multipart submission upload endpoint",
        )
    cleaned_responses = validate_submission(fields, payload.responses)

    submission = FormSubmission(
        page_id=page.id,
        form_slug=page.live_slug,
        lang=lang,
        responses=cleaned_responses,
        review_fields=form.get("review_fields", []),
        review_data={},
        status="new",
    )

    db.add(submission)
    await db.commit()
    await db.refresh(submission)

    return FormSubmissionReceipt(id=submission.id, status=submission.status)


@public_router.post(
    "/forms/{slug:path}/submissions/upload",
    response_model=FormSubmissionReceipt,
    status_code=status.HTTP_201_CREATED,
)
async def submit_form_with_uploads(
    slug: str,
    responses: str = Form(default="{}"),
    file_fields: list[str] = Form(default=[]),
    # Swagger UI needs an explicit binary format to render file pickers in OAS 3.1.
    files: list[UploadFile] = File(
        default=[],
        json_schema_extra={"items": {"type": "string", "format": "binary"}},
    ),
    lang: str = Query(default="en"),
    db: AsyncSession = Depends(get_db),
):
    try:
        submitted_responses = json.loads(responses)
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=422, detail="responses must contain valid JSON") from error
    if not isinstance(submitted_responses, dict):
        raise HTTPException(status_code=422, detail="responses must be a JSON object")

    page, form, fields = await _get_published_form(db, slug, lang)
    fields_by_name = {field["name"]: field for field in fields}
    file_fields_by_name = {
        name: field
        for name, field in fields_by_name.items()
        if field.get("type") == "file"
    }

    if len(files) != len(file_fields):
        raise HTTPException(
            status_code=422,
            detail="file_fields must contain one field name for each uploaded file",
        )
    if len(set(file_fields)) != len(file_fields):
        raise HTTPException(status_code=422, detail="file_fields must not contain duplicates")
    unknown_file_fields = set(file_fields) - set(file_fields_by_name)
    if unknown_file_fields:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown file fields: {', '.join(sorted(unknown_file_fields))}",
        )
    if set(submitted_responses).intersection(file_fields_by_name):
        raise HTTPException(
            status_code=422,
            detail="File answers must be sent as multipart file uploads, not in responses",
        )

    non_file_fields = [
        field for field in fields if field.get("type") != "file"
    ]
    cleaned_responses = validate_submission(non_file_fields, submitted_responses)
    uploaded_by_field = dict(zip(file_fields, files))
    missing_required_files = [
        field["name"]
        for field in file_fields_by_name.values()
        if field.get("required", False) and field["name"] not in uploaded_by_field
    ]
    if missing_required_files:
        raise HTTPException(
            status_code=422,
            detail=f"Field '{missing_required_files[0]}' is required",
        )

    created_paths: list[Path] = []
    try:
        for field_name, upload in uploaded_by_field.items():
            field = file_fields_by_name[field_name]
            path, size_bytes, filename, content_type = await _store_form_upload(
                upload,
                field,
            )
            created_paths.append(path)
            media = MediaFile(
                filename=filename,
                content_type=content_type,
                size_bytes=size_bytes,
                storage_path=str(path),
                public_url=f"/uploads/{path.name}",
            )
            db.add(media)
            await db.flush()
            cleaned_responses[field_name] = {
                "id": str(media.id),
                "filename": filename,
                "content_type": content_type,
                "size_bytes": size_bytes,
                "url": media.public_url,
            }

        cleaned_responses = validate_submission(fields, cleaned_responses)
        submission = FormSubmission(
            page_id=page.id,
            form_slug=page.live_slug,
            lang=lang,
            responses=cleaned_responses,
            review_fields=form.get("review_fields", []),
            review_data={},
            status="new",
        )
        db.add(submission)
        await db.commit()
    except Exception:
        await db.rollback()
        for path in created_paths:
            path.unlink(missing_ok=True)
        raise

    await db.refresh(submission)
    return FormSubmissionReceipt(id=submission.id, status=submission.status)


@admin_router.get(
    "/{page_id}/submissions",
    response_model=list[FormSubmissionResponse],
)
async def list_form_submissions(
    page_id: UUID,
    submission_status: str | None = Query(
        default=None,
        pattern="^(new|reviewing|approved|rejected|resolved|spam)$",
    ),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_active_admin),
):
    page = await db.get(Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    query = select(FormSubmission).where(FormSubmission.page_id == page_id)

    if submission_status:
        query = query.where(FormSubmission.status == submission_status)

    query = query.order_by(FormSubmission.created_at.desc()).offset(offset).limit(limit)

    result = await db.execute(query)
    return list(result.scalars().all())


@admin_router.get(
    "/{page_id}/submissions/{submission_id}",
    response_model=FormSubmissionResponse,
)
async def get_form_submission(
    page_id: UUID,
    submission_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_active_admin),
):
    result = await db.execute(
        select(FormSubmission).where(
            FormSubmission.id == submission_id,
            FormSubmission.page_id == page_id,
        )
    )
    submission = result.scalar_one_or_none()

    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    return submission


@admin_router.patch(
    "/{page_id}/submissions/{submission_id}",
    response_model=FormSubmissionResponse,
)
async def review_form_submission(
    page_id: UUID,
    submission_id: UUID,
    payload: FormSubmissionReview,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_active_admin),
):
    result = await db.execute(
        select(FormSubmission).where(
            FormSubmission.id == submission_id,
            FormSubmission.page_id == page_id,
        )
    )
    submission = result.scalar_one_or_none()

    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    merged_review_data = {**(submission.review_data or {}), **payload.review_data}
    validated_review_data = validate_submission(
        submission.review_fields or [],
        merged_review_data,
        require_required=payload.status in {"approved", "rejected"},
    )
    submission.status = payload.status
    submission.review_data = validated_review_data
    submission.reviewed_by_id = admin.id
    submission.reviewed_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(submission)

    return submission
