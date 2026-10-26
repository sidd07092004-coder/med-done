# Dynamic Forms: Backend Code and Integration Guide

This guide describes the backend dynamic-form pipeline, including public form
submissions, configurable admin review fields, file uploads, persistence, and
how to add the module to an existing FastAPI backend. The implementation lives
in the linked files below; this guide explains how those pieces fit together
and includes the request/data contracts used by each piece.

## 1. Architecture at a glance

Dynamic forms are page content, not a separate page type. Admins configure them
in `Page.content.form`; the public API reads the form from the published
`Page.live_content` snapshot. The pipeline is:

1. An authenticated page editor creates or updates a page and writes its
   `form` object into `content`.
2. Page create, update, submit, and publish operations validate that object.
3. The public API loads the matching published page and validates each response
   against its current published field definitions.
4. A successful submission stores validated answers and a snapshot of
   `review_fields` in `form_submissions`.
5. Admin review requests validate against that saved snapshot and store the
   supplied `review_data`.
6. For a `file` field, the client sends a multipart request. The server checks
   the configured extension, MIME type, file signature, and size limit, then
   stores the file through the existing media storage and `media_files` model.
   File metadata is stored with the submission answer.

The live file and JSON request contracts in Swagger are generated from these
backend routes.

## 2. Relevant code map

| Responsibility | Backend code |
| --- | --- |
| Field types, configuration checks, answer validation, accepted upload formats, file-signature checks | [`app/services/dynamic_forms.py`](./app/services/dynamic_forms.py) |
| Public submit, multipart submit, upload persistence, admin config/list/detail/review APIs | [`app/api/v1/routes/forms.py`](./app/api/v1/routes/forms.py) |
| Submission request, receipt, review, and response schemas | [`app/schemas/form_submission.py`](./app/schemas/form_submission.py) |
| Form submission table and JSONB snapshots | [`app/models/form_submission.py`](./app/models/form_submission.py) |
| Page content create/update/publish validation and workflow | [`app/api/v1/routes/pages.py`](./app/api/v1/routes/pages.py) |
| Public router includes form routes | [`app/api/v1/public_api.py`](./app/api/v1/public_api.py) |
| Admin router includes form routes | [`app/api/v1/admin.py`](./app/api/v1/admin.py) |
| Existing uploaded-media metadata model | [`app/models/media.py`](./app/models/media.py) |
| Existing file-size and storage settings | [`app/core/config.py`](./app/core/config.py) |
| Upload directory is served at `/uploads` | [`app/main.py`](./app/main.py) |
| Form-submission table migration | [`alembic/versions/97a258ddad89_add_form_submissions.py`](./alembic/versions/97a258ddad89_add_form_submissions.py) |
| Dynamic field, review, and upload validation tests | [`tests/test_dynamic_forms.py`](./tests/test_dynamic_forms.py) |
| OpenAPI route and multipart request contract test | [`tests/test_api.py`](./tests/test_api.py) |

File uploads intentionally reuse `media_files`; the dynamic upload endpoint
does not add a second file table or migration. `python-multipart` is already a
backend dependency and is needed by FastAPI to parse multipart requests.

## 3. Page content contract

Place `form` alongside the page's regular blocks:

```json
{
  "format": "blocks-v1",
  "blocks": [],
  "form": {
    "enabled": true,
    "title": "Volunteer application",
    "submit_label": "Send application",
    "success_message": "Thank you for applying.",
    "fields": [
      {
        "name": "email",
        "label": "Email",
        "type": "email",
        "required": true
      },
      {
        "name": "availability",
        "label": "Availability",
        "type": "select",
        "required": true,
        "options": ["Weekdays", "Weekends"]
      },
      {
        "name": "resume",
        "label": "Resume",
        "type": "file",
        "required": false,
        "accept": [".pdf", ".png", ".jpg"],
        "max_size_mb": 5,
        "help_text": "PDF or image, up to 5 MB."
      }
    ],
    "review_fields": [
      {
        "name": "decision_remark",
        "label": "Approval or rejection remark",
        "type": "textarea",
        "required": true
      },
      {
        "name": "priority",
        "label": "Priority",
        "type": "select",
        "required": false,
        "options": ["normal", "urgent"]
      }
    ]
  }
}
```

Supported field types are `text`, `textarea`, `email`, `number`, `select`,
`radio`, `checkbox`, `boolean`, `tel`, `url`, `date`, and `file`. All fields
need a unique `name`, a non-empty `label`, and optionally a boolean `required`.
`select` and `radio` fields require non-empty unique `options`. Each option can
be a string or a `{ "label": "...", "value": "..." }` object.

File field options:

| Property | Meaning |
| --- | --- |
| `accept` | Optional non-empty list of allowed extensions. Current supported formats are `.pdf`, `.jpg`, `.jpeg`, `.png`, `.gif`, and `.webp`. If omitted, all these formats are accepted. |
| `max_size_mb` | Optional positive integer limit for this field. It cannot increase the backend-wide `MAX_UPLOAD_SIZE_MB` setting. |
| `required` | If true, one uploaded file must be supplied for the field. |

Only one file per file field is supported. File fields are submitter fields;
`review_fields` support the regular text/choice field types but not file uploads.

## 4. API contract

### Admin page configuration

Use the existing page APIs to create/update a page. The form definition remains
inside the page `content` property:

- `POST /admin/pages/`
- `PATCH /admin/pages/{page_id}`

The existing page workflow checks the configuration when content is saved and
requires at least one field when an enabled form is submitted or published.
`GET /admin/forms/{page_id}/config` returns the current form definition.

### Public JSON submission without files

```http
POST /api/v1/forms/volunteer-application/submissions?lang=en
Content-Type: application/json
```

```json
{
  "responses": {
    "email": "person@example.com",
    "availability": "Weekends"
  }
}
```

JSON submissions remain supported for existing forms. If a file answer is
included in JSON `responses`, the API returns 422; clients must use the
multipart upload route for file answers.

### Public multipart submission with files

Use `POST /api/v1/forms/{slug}/submissions/upload`. The multipart body has:

- `responses`: a JSON object string containing all non-file answers.
- `file_fields`: one field name for each uploaded file.
- `files`: one upload per field name, in the same order as `file_fields`.
- `lang`: optional query parameter, default `en`.

Example:

```bash
curl -X POST \
  'http://127.0.0.1:8000/api/v1/forms/volunteer-application/submissions/upload?lang=en' \
  -F 'responses={"email":"person@example.com","availability":"Weekends"}' \
  -F 'file_fields=resume' \
  -F 'files=@resume.pdf;type=application/pdf'
```

To upload multiple different file fields, repeat both multipart keys in matching
order:

```bash
-F 'file_fields=resume' -F 'files=@resume.pdf;type=application/pdf' \
-F 'file_fields=photo' -F 'files=@photo.png;type=image/png'
```

`file_fields` and `files` must have the same number of values. Duplicate,
unknown, or non-file field names are rejected. Non-file answers are validated
the same way as JSON submissions. The service stores a file answer in the
submission response using this shape:

```json
{
  "resume": {
    "id": "6e8c8f45-b2a9-4a25-a203-bb62723c985e",
    "filename": "resume.pdf",
    "content_type": "application/pdf",
    "size_bytes": 123456,
    "url": "/uploads/2c1a9b0d7c564865adac9c0c53c88a14.pdf"
  }
}
```

The receipt response remains the same for JSON and multipart submissions:

```json
{
  "id": "submission-uuid",
  "status": "new",
  "message": "Form submitted successfully"
}
```

### Admin submission review

- `GET /admin/forms/{page_id}/submissions` lists submissions and accepts
  optional `submission_status`, `limit`, and `offset`.
- `GET /admin/forms/{page_id}/submissions/{submission_id}` returns a single
  submission, including `responses`, saved `review_fields`, and `review_data`.
- `PATCH /admin/forms/{page_id}/submissions/{submission_id}` updates a status
  and merges validated review data:

```json
{
  "status": "approved",
  "review_data": {
    "decision_remark": "Application approved.",
    "priority": "normal"
  }
}
```

The API requires configured required review fields when status is `approved`
or `rejected`. `reviewing` supports incremental updates. Review-field
definitions are snapshotted when the public submission is created, so page
edits do not change the review contract for existing submissions.

## 5. Storage, validation, and error behavior

- Public submissions are accepted only for a published page and its
  `live_content` form snapshot.
- Unknown response names, missing required fields, invalid field values,
  invalid choices, and malformed file metadata return 422.
- The file extension must be in the field's `accept` list (or the supported
  default list). The multipart MIME type must match that extension.
- The implementation checks the leading bytes for PDF, JPEG, PNG, GIF, and
  WebP signatures; extension and MIME headers alone are not trusted.
- Uploads are streamed to disk under a random server-generated filename. The
  submitted filename is display metadata only and is not used as a path.
- The per-field size limit is capped by `MAX_UPLOAD_SIZE_MB` (10 MB by default).
  An oversized upload returns 413.
- The `media_files` row and `form_submissions` row are committed together. If
  submission validation or persistence fails, newly written file paths are
  removed.
- A successful file's URL is served by the existing `/uploads` static mount.
  The media administration endpoints can list and remove its metadata/file.
- Dynamic form uploads are public because the form itself is public; configure
  CORS, reverse-proxy request limits, and rate limiting appropriately for a
  public deployment.

## 6. How to integrate this pipeline into an existing FastAPI backend

These are the integration responsibilities to port/adapt; keep the page/content
workflow your application already uses.

1. **Define the JSON contract.** Store a `form` object inside the page's JSON
   content. Give each field a stable unique name, type, label, required flag,
   and any choices or file restrictions.
2. **Validate page configuration.** Port `validate_form_config` and
   `validate_field` from [`app/services/dynamic_forms.py`](./app/services/dynamic_forms.py).
   Call the validator when page content is created/updated, and require at
   least one field when an enabled form is published.
3. **Validate submissions server-side.** Port `validate_submission`; do not
   treat client-provided field values or select choices as trusted. Resolve
   only the published page snapshot before validating public answers.
4. **Persist submissions.** Add a submission model/table with a page foreign
   key, language, form slug, JSONB/JSON responses, status, and creation
   timestamp. Snapshot review field definitions and store review answers
   separately if the admin needs dynamic review forms.
5. **Wire public and admin routes.** Add the public submit/config routes to the
   public router and the authenticated admin list/detail/review routes to the
   admin router. Verify registration through the generated OpenAPI document.
6. **Add multipart file handling.** Install `python-multipart`. Define a
   multipart route with a JSON `responses` part and paired `file_fields` /
   `files` parts. Check field configuration, file count, allowed extensions,
   MIME type, content signature, and size before writing. Use generated
   filenames and save metadata to the application's media table. Never accept
   a client-provided disk path or URL as proof of an upload.
7. **Configure static/authorized file access.** This project serves media from
   `/uploads`, so upload URLs are public. If your application requires private
   documents, replace that mount with authenticated downloads or signed URLs.
8. **Add migrations and tests.** Create a migration for any new submission
   table/columns. Reuse an existing media table where possible. Test
   configuration rules, field values, required fields, file content/type/size
   failures, submit and review APIs, and OpenAPI route registration.

In this repository, the submission table and media table already exist, so
adding the dynamic file field does not require an additional migration.

## 7. Tests and local backend setup

From `backend/`, run the targeted tests:

```bash
python -m pytest -q tests/test_dynamic_forms.py tests/test_api.py
```

The dynamic field tests do not need PostgreSQL. The API route registration test
uses the app's OpenAPI endpoint. Database-backed submission tests require the
backend's configured PostgreSQL database.

Use Swagger UI at `/docs` to inspect:

- `POST /api/v1/forms/{slug}/submissions` for JSON-only forms.
- `POST /api/v1/forms/{slug}/submissions/upload` for multipart file forms.
- `GET` / `PATCH /admin/forms/...` for admin review.

See [`context.md`](./context.md) for the local backend run instructions and
project-specific database setup.

## 8. Copy-paste implementation, step by step

The sections below contain the implementation code, not only a file list. Copy
the complete code blocks into the corresponding paths in your backend, then
adapt the marked imports, model names, page status, and auth dependencies to
your project. Do not replace your existing page router or application router
with these snippets; merge the wiring into them.

### Step 1 — Install multipart support

Add this dependency to your backend dependency file, then install dependencies:

```text
python-multipart>=0.0.12
```

FastAPI requires it to parse `multipart/form-data`.

### Step 2 — Field configuration and answer validation

Create `app/services/dynamic_forms.py`:

```python
from typing import Any
import re
from uuid import UUID

from fastapi import HTTPException


FILE_TYPE_BY_EXTENSION = {
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".webp": "image/webp",
}


def file_signature_matches(extension: str, signature: bytes) -> bool:
    """Check the leading bytes for the file formats accepted by dynamic forms."""

    extension = extension.lower()
    if extension == ".pdf":
        return signature.startswith(b"%PDF-")
    if extension in {".jpg", ".jpeg"}:
        return signature.startswith(b"\xff\xd8\xff")
    if extension == ".png":
        return signature.startswith(b"\x89PNG\r\n\x1a\n")
    if extension == ".gif":
        return signature.startswith((b"GIF87a", b"GIF89a"))
    if extension == ".webp":
        return (
            len(signature) >= 12
            and signature.startswith(b"RIFF")
            and signature[8:12] == b"WEBP"
        )
    return False


SUPPORTED_TYPES = {
    "text",
    "textarea",
    "email",
    "number",
    "select",
    "radio",
    "checkbox",
    "boolean",
    "tel",
    "url",
    "date",
    "file",
}
MAX_FIELDS = 100
MAX_OPTIONS = 100
_FIELD_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")


def _field_name(field: dict) -> str | None:
    name = field.get("name", field.get("key"))
    return name.strip() if isinstance(name, str) else None


def _option_values(options: Any) -> set:
    if not isinstance(options, list):
        return set()

    values = set()
    for option in options:
        if isinstance(option, (str, int, float)) and not isinstance(option, bool):
            values.add(option)
        elif isinstance(option, dict):
            value = option.get("value")
            if isinstance(value, (str, int, float)) and not isinstance(value, bool):
                values.add(value)
    return values


def validate_form_config(content: Any, require_fields: bool = False) -> None:
    """Validate a page's optional dynamic form configuration."""

    if content is None:
        return
    if not isinstance(content, dict):
        raise HTTPException(status_code=422, detail="Page content must be an object")

    form = content.get("form")
    if form is None:
        return
    if not isinstance(form, dict):
        raise HTTPException(
            status_code=422,
            detail="Form configuration must be an object",
        )

    if "enabled" in form and not isinstance(form["enabled"], bool):
        raise HTTPException(
            status_code=422,
            detail="Form enabled must be true or false",
        )

    fields = form.get("fields", [])
    if not isinstance(fields, list):
        raise HTTPException(status_code=422, detail="Form fields must be a list")
    if len(fields) > MAX_FIELDS:
        raise HTTPException(
            status_code=422,
            detail=f"A form can contain at most {MAX_FIELDS} fields",
        )
    if require_fields and form.get("enabled", True) and not fields:
        raise HTTPException(
            status_code=422,
            detail="An enabled form must have at least one field before publishing",
        )

    review_fields = form.get("review_fields", [])
    if not isinstance(review_fields, list):
        raise HTTPException(
            status_code=422,
            detail="Form review_fields must be a list",
        )
    if len(review_fields) > MAX_FIELDS:
        raise HTTPException(
            status_code=422,
            detail=f"A form can contain at most {MAX_FIELDS} review fields",
        )

    for text_key in ("title", "submit_label", "success_message"):
        value = form.get(text_key)
        if value is not None and not isinstance(value, str):
            raise HTTPException(
                status_code=422,
                detail=f"Form {text_key} must be text",
            )

    def validate_fields(field_list: list, field_group: str) -> None:
        seen_names = set()
        for field in field_list:
            validate_field(field, seen_names, field_group)

    validate_fields(fields, "Form")
    validate_fields(review_fields, "Review form")


def validate_field(field: Any, seen_names: set[str], field_group: str) -> None:
    if not isinstance(field, dict):
        raise HTTPException(
            status_code=422,
            detail=f"Each {field_group.lower()} field must be an object",
        )

    name = _field_name(field)
    field_type = field.get("type")
    if not name:
        raise HTTPException(
            status_code=422,
            detail=f"Every {field_group.lower()} field must have a name or key",
        )
    if not _FIELD_NAME_RE.fullmatch(name):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid {field_group.lower()} field name: {name}",
        )
    if name in seen_names:
        raise HTTPException(
            status_code=422,
            detail=f"Duplicate {field_group.lower()} field name: {name}",
        )
    seen_names.add(name)

    label = field.get("label")
    if not isinstance(label, str) or not label.strip():
        raise HTTPException(
            status_code=422,
            detail=f"Field '{name}' must have a label",
        )
    if field_type not in SUPPORTED_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported field type for '{name}': {field_type}",
        )
    if "required" in field and not isinstance(field["required"], bool):
        raise HTTPException(
            status_code=422,
            detail=f"Field '{name}': required must be true or false",
        )

    for text_key in ("placeholder", "help_text"):
        value = field.get(text_key)
        if value is not None and not isinstance(value, str):
            raise HTTPException(
                status_code=422,
                detail=f"Field '{name}': {text_key} must be text",
            )

    if field_type in {"select", "radio", "checkbox"} and "options" in field:
        options = field.get("options")
        if not isinstance(options, list) or len(options) > MAX_OPTIONS:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Field '{name}' options must be a list with at most "
                    f"{MAX_OPTIONS} items"
                ),
            )
        for option in options:
            if isinstance(option, str):
                valid_option = bool(option.strip())
            elif isinstance(option, dict):
                valid_option = (
                    isinstance(option.get("label"), str)
                    and bool(option["label"].strip())
                    and isinstance(option.get("value"), (str, int, float))
                    and not isinstance(option.get("value"), bool)
                )
            else:
                valid_option = False
            if not valid_option:
                raise HTTPException(
                    status_code=422,
                    detail=f"Field '{name}' contains an invalid option",
                )

    if field_type in {"select", "radio"}:
        options = field.get("options")
        if not isinstance(options, list) or not options:
            raise HTTPException(
                status_code=422,
                detail=f"Field '{name}' must have a non-empty options list",
            )
        option_values = [_option_values([option]) for option in options]
        flattened = [next(iter(values)) for values in option_values if values]
        if len(flattened) != len(options) or len(set(flattened)) != len(flattened):
            raise HTTPException(
                status_code=422,
                detail=f"Field '{name}' options must have unique values",
            )

    if field_type == "file":
        if field_group == "Review form":
            raise HTTPException(
                status_code=422,
                detail=f"File fields are not supported in review_fields ('{name}')",
            )

        accept = field.get("accept")
        if accept is not None:
            if (
                not isinstance(accept, list)
                or not accept
                or any(
                    not isinstance(extension, str)
                    or extension.lower() not in FILE_TYPE_BY_EXTENSION
                    for extension in accept
                )
            ):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Field '{name}' accept must be a non-empty list of "
                        "supported file extensions"
                    ),
                )
            normalized_accept = [extension.lower() for extension in accept]
            if len(set(normalized_accept)) != len(normalized_accept):
                raise HTTPException(
                    status_code=422,
                    detail=f"Field '{name}' accept extensions must be unique",
                )

        max_size_mb = field.get("max_size_mb")
        if max_size_mb is not None and (
            isinstance(max_size_mb, bool)
            or not isinstance(max_size_mb, int)
            or max_size_mb < 1
        ):
            raise HTTPException(
                status_code=422,
                detail=f"Field '{name}' max_size_mb must be a positive integer",
            )


def validate_submission(
    fields: list,
    responses: dict[str, Any],
    *,
    require_required: bool = True,
) -> dict[str, Any]:
    """Validate submitted answers and return only configured field values."""

    if not isinstance(responses, dict):
        raise HTTPException(status_code=422, detail="Responses must be an object")

    validate_form_config({"form": {"fields": fields}})
    field_names = {
        _field_name(field)
        for field in fields
        if isinstance(field, dict)
    }
    unknown_names = set(responses.keys()) - field_names
    if unknown_names:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown form fields: {', '.join(sorted(unknown_names))}",
        )

    cleaned = {}
    for field in fields:
        name = _field_name(field)
        field_type = field["type"]
        required = field.get("required", False)
        value = responses.get(name)
        is_empty = (
            value is None
            or value == ""
            or (isinstance(value, str) and not value.strip())
        )
        if isinstance(value, list) and not value:
            is_empty = True

        if required and require_required and is_empty:
            raise HTTPException(
                status_code=422,
                detail=f"Field '{name}' is required",
            )
        if is_empty:
            continue

        if field_type in {
            "text", "textarea", "email", "tel", "url", "date", "radio"
        } and not isinstance(value, str):
            raise HTTPException(
                status_code=422,
                detail=f"Field '{name}' must be text",
            )
        if field_type == "number" and (
            isinstance(value, bool) or not isinstance(value, (int, float))
        ):
            raise HTTPException(
                status_code=422,
                detail=f"Field '{name}' must be a number",
            )
        if field_type == "boolean" and not isinstance(value, bool):
            raise HTTPException(
                status_code=422,
                detail=f"Field '{name}' must be true or false",
            )

        if field_type == "file":
            if not isinstance(value, dict):
                raise HTTPException(
                    status_code=422,
                    detail=f"Field '{name}' must contain an uploaded file",
                )
            try:
                UUID(str(value.get("id", "")))
            except (ValueError, TypeError, AttributeError):
                raise HTTPException(
                    status_code=422,
                    detail=f"Field '{name}' has an invalid uploaded file reference",
                )

            filename = value.get("filename")
            extension = (
                "." + filename.rsplit(".", 1)[-1].lower()
                if isinstance(filename, str) and "." in filename
                else ""
            )
            accepted_extensions = {
                item.lower()
                for item in field.get("accept", list(FILE_TYPE_BY_EXTENSION))
            }
            if (
                not isinstance(filename, str)
                or not filename.strip()
                or extension not in accepted_extensions
                or value.get("content_type") != FILE_TYPE_BY_EXTENSION.get(extension)
                or isinstance(value.get("size_bytes"), bool)
                or not isinstance(value.get("size_bytes"), int)
                or value["size_bytes"] < 1
                or not isinstance(value.get("url"), str)
                or not value["url"].startswith("/uploads/")
            ):
                raise HTTPException(
                    status_code=422,
                    detail=f"Field '{name}' has invalid uploaded file metadata",
                )

        if field_type in {"select", "radio"}:
            allowed = _option_values(field.get("options", []))
            if (
                not isinstance(value, (str, int, float))
                or isinstance(value, bool)
                or value not in allowed
            ):
                raise HTTPException(
                    status_code=422,
                    detail=f"Invalid option for field '{name}'",
                )

        if field_type == "checkbox":
            allowed = _option_values(field.get("options", []))
            if allowed:
                if not isinstance(value, list) or not all(
                    isinstance(item, (str, int, float))
                    and not isinstance(item, bool)
                    and item in allowed
                    for item in value
                ):
                    raise HTTPException(
                        status_code=422,
                        detail=f"Invalid option for field '{name}'",
                    )
            elif not isinstance(value, bool):
                raise HTTPException(
                    status_code=422,
                    detail=f"Field '{name}' must be true or false",
                )

        cleaned[name] = value

    return cleaned
```

### Step 3 — Submission request and response schemas

Create `app/schemas/form_submission.py`:

```python
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class FormSubmissionCreate(BaseModel):
    responses: dict[str, Any] = Field(max_length=100)


class FormSubmissionReview(BaseModel):
    status: Literal[
        "new",
        "reviewing",
        "approved",
        "rejected",
        "resolved",
        "spam",
    ]
    review_data: dict[str, Any] = Field(default_factory=dict, max_length=100)


class FormSubmissionReceipt(BaseModel):
    id: UUID
    status: str
    message: str = "Form submitted successfully"


class FormSubmissionResponse(BaseModel):
    id: UUID
    page_id: UUID
    form_slug: str
    lang: str
    responses: dict[str, Any]
    review_fields: list[dict[str, Any]]
    review_data: dict[str, Any]
    status: str
    reviewed_by_id: UUID | None
    reviewed_at: datetime | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
```

### Step 4 — Submission database model

Create `app/models/form_submission.py`. Change the `Base` import only if your
project uses a different declarative base:

```python
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import String, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class FormSubmission(Base):
    __tablename__ = "form_submissions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    page_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("pages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    form_slug: Mapped[str] = mapped_column(String(512), nullable=False)
    lang: Mapped[str] = mapped_column(String(10), default="en", nullable=False)
    responses: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    review_fields: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    review_data: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict
    )
    status: Mapped[str] = mapped_column(
        String(30), default="new", nullable=False, index=True
    )
    reviewed_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
```

### Step 5 — Form API routes

Create `app/api/v1/routes/forms.py`. Adapt the `app.api.deps`, page/user model,
settings, and media model import paths if those names differ in your project.
This route module includes public JSON and multipart submissions plus
admin-only configuration, submission listing, detail, and review operations:

```python
import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID
import uuid

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
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
    files: list[UploadFile] = File(default=[]),
    lang: str = Query(default="en"),
    db: AsyncSession = Depends(get_db),
):
    try:
        submitted_responses = json.loads(responses)
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=422,
            detail="responses must contain valid JSON",
        ) from error
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
```

### Step 6 — Register the model with your application

If your project imports models centrally for SQLAlchemy metadata, add the model
to `app/models/__init__.py`:

```python
from app.models.form_submission import FormSubmission
```

Also add `"FormSubmission"` to the existing `__all__` list if your project has
one. Preserve all existing imports and model names.

### Step 7 — Add the database migration

If you use Alembic, generate or create a migration after the model exists. This
example assumes PostgreSQL, a `pages` table, and a `users` table; adjust the
parent revision and foreign-key table names to match your application.

```python
"""create form submissions

Revision ID: replace_with_revision_id
Revises: replace_with_parent_revision
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "replace_with_revision_id"
down_revision: Union[str, None] = "replace_with_parent_revision"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "form_submissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("page_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("form_slug", sa.String(length=512), nullable=False),
        sa.Column("lang", sa.String(length=10), nullable=False),
        sa.Column(
            "responses",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "review_fields",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "review_data",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("reviewed_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["page_id"], ["pages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["reviewed_by_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_form_submissions_page_id",
        "form_submissions",
        ["page_id"],
    )
    op.create_index(
        "ix_form_submissions_status",
        "form_submissions",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index("ix_form_submissions_status", table_name="form_submissions")
    op.drop_index("ix_form_submissions_page_id", table_name="form_submissions")
    op.drop_table("form_submissions")
```

Run your migration using the normal migration command for that backend. Do not
run the example with the placeholder revision IDs.

### Step 8 — Wire the public and admin routers

In your existing `app/api/v1/public_api.py`, import the public router and
include it. Keep your other routes:

```python
from app.api.v1.routes.forms import public_router as forms_public_router

public_router.include_router(forms_public_router, tags=["public-forms"])
```

In your existing admin router module, import the admin router and include it
under the admin forms prefix:

```python
from app.api.v1.routes.forms import admin_router as forms_admin_router

admin_router.include_router(
    forms_admin_router,
    prefix="/forms",
    tags=["admin-forms"],
)
```

The application must include the public and admin routers with prefixes, for
example:

```python
app.include_router(public_router, prefix="/api/v1")
app.include_router(admin_router, prefix="/admin")
```

The paths above then become:

- `POST /api/v1/forms/{slug}/submissions`
- `POST /api/v1/forms/{slug}/submissions/upload`
- `GET /admin/forms/{page_id}/config`
- `GET /admin/forms/{page_id}/submissions`
- `GET /admin/forms/{page_id}/submissions/{submission_id}`
- `PATCH /admin/forms/{page_id}/submissions/{submission_id}`

### Step 9 — Validate the form when a page is edited or published

Import the validator in the existing page routes:

```python
from app.services.dynamic_forms import validate_form_config
```

When creating a page, validate the content before saving. Require a non-empty
field list only when publishing directly:

```python
validate_form_config(
    page_data.get("content"),
    require_fields=page_data.get("status") == "published",
)
```

When updating content:

```python
if "content" in update_data:
    validate_form_config(update_data["content"])
```

Before accepting page submission for approval or approving it for publication:

```python
validate_form_config(page.content, require_fields=True)
```

For security, leave your existing page authorization and workflow checks in
place; only add these validator calls.

### Step 10 — Configure upload storage and settings

The upload route expects these settings. Add them to your existing settings
class or map them to the equivalent settings in your application:

```python
UPLOAD_DIR: str = "uploads"
MAX_UPLOAD_SIZE_MB: int = 10
```

If uploads should be available from a public URL, mount the same directory:

```python
from pathlib import Path
from fastapi.staticfiles import StaticFiles

uploads_dir = Path(settings.UPLOAD_DIR)
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")
```

This makes uploaded files public. If uploaded documents are private, use an
authenticated download route or signed URLs instead of a public static mount.
Set reverse-proxy request size limits and rate limits too.

The route uses the existing `MediaFile` model. If your backend does not have
one, create a media model/table with at least `id`, `filename`, `content_type`,
`size_bytes`, `storage_path`, `public_url`, and optional uploader ID; then
change the import and constructor in `forms.py` to match it.

### Step 11 — Create a page with form content

Send this object as the page's `content` when using the existing page-create or
page-update API:

```json
{
  "format": "blocks-v1",
  "blocks": [],
  "form": {
    "enabled": true,
    "title": "Volunteer application",
    "submit_label": "Submit application",
    "success_message": "Application received.",
    "fields": [
      {
        "name": "email",
        "label": "Email",
        "type": "email",
        "required": true
      },
      {
        "name": "interest",
        "label": "Area of interest",
        "type": "select",
        "required": true,
        "options": ["Volunteering", "Translation"]
      },
      {
        "name": "resume",
        "label": "Resume",
        "type": "file",
        "required": false,
        "accept": [".pdf"],
        "max_size_mb": 5
      }
    ],
    "review_fields": [
      {
        "name": "decision_remark",
        "label": "Decision remark",
        "type": "textarea",
        "required": true
      },
      {
        "name": "priority",
        "label": "Priority",
        "type": "select",
        "required": false,
        "options": ["normal", "urgent"]
      }
    ]
  }
}
```

### Step 12 — Submit to the API

For forms without file fields, use the JSON endpoint:

```bash
curl -X POST \
  'http://localhost:8000/api/v1/forms/volunteer-application/submissions?lang=en' \
  -H 'Content-Type: application/json' \
  -d '{"responses":{"email":"person@example.com","interest":"Translation"}}'
```

For forms with uploads, send JSON answers as one multipart `responses` part
and repeat `file_fields` / `files` parts in the same order:

```bash
curl -X POST \
  'http://localhost:8000/api/v1/forms/volunteer-application/submissions/upload?lang=en' \
  -F 'responses={"email":"person@example.com","interest":"Translation"}' \
  -F 'file_fields=resume' \
  -F 'files=@resume.pdf;type=application/pdf'
```

The file answer stored in the submission is metadata, not raw file bytes:

```json
{
  "resume": {
    "id": "uploaded-media-uuid",
    "filename": "resume.pdf",
    "content_type": "application/pdf",
    "size_bytes": 123456,
    "url": "/uploads/generated-filename.pdf"
  }
}
```

### Step 13 — Verify the installation

Run the tests from your backend directory (install the test dependencies first
if needed):

```bash
python -m pytest -q tests/test_dynamic_forms.py tests/test_api.py
python -m compileall -q app tests
```

Open `/docs` and check that both public submission endpoints and all
`/admin/forms` endpoints appear in OpenAPI. Test at least:

- Required text field missing: expect 422.
- Unknown response field or invalid select value: expect 422.
- Required file missing: expect 422.
- Disallowed extension, mismatched MIME type, or invalid file signature:
  expect 422.
- Upload larger than configured limit: expect 413.
- Valid JSON or multipart submission: expect 201.
- Approve/reject without required review data: expect 422.
- Approve/reject with configured required review data: expect 200.

## 9. Project-specific changes you must make when copying

This code is written for the current backend and assumes:

- SQLAlchemy async sessions are supplied by `get_db`.
- Admin authentication is supplied by `get_current_active_admin`.
- Pages have `live_slug`, `live_content`, `status`, `lang`, and `id`.
- Published page status is `PageStatus.PUBLISHED`.
- The application has a `MediaFile` model and an `UPLOAD_DIR` directory.
- PostgreSQL JSONB is used for the form data and submissions.

In another backend, adapt these names and table references to your schema.
Keep the behavior and safety checks: validate against the published form
definition, never trust a URL or file path supplied in JSON, enforce file size
and content checks, and protect admin review routes with your admin dependency.
