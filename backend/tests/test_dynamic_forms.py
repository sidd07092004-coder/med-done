from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from pydantic import ValidationError
from starlette.datastructures import Headers

from app.api.v1.routes import forms
from app.schemas.form_submission import FormSubmissionReview
from app.services.dynamic_forms import (
    file_signature_matches,
    validate_form_config,
    validate_submission,
)


def test_validates_field_configuration_and_submission():
    fields = [
        {
            "name": "full_name",
            "label": "Full name",
            "type": "text",
            "required": True,
        },
        {
            "name": "interest",
            "label": "Area of interest",
            "type": "select",
            "required": False,
            "options": ["Volunteering", "Translation"],
        },
        {
            "name": "availability",
            "label": "Availability",
            "type": "checkbox",
            "required": False,
            "options": ["Weekdays", "Weekends"],
        },
    ]
    validate_form_config({"format": "blocks-v1", "blocks": [], "form": {"fields": fields}})

    cleaned = validate_submission(
        fields,
        {
            "full_name": "Sam Example",
            "interest": "Translation",
            "availability": ["Weekdays"],
        },
    )

    assert cleaned == {
        "full_name": "Sam Example",
        "interest": "Translation",
        "availability": ["Weekdays"],
    }


@pytest.mark.parametrize(
    ("fields", "responses", "message"),
    [
        (
            [{"name": "email", "label": "Email", "type": "email", "required": True}],
            {},
            "is required",
        ),
        (
            [{"name": "interest", "label": "Interest", "type": "select", "options": ["A"]}],
            {"interest": "B"},
            "Invalid option",
        ),
        (
            [{"name": "email", "label": "Email", "type": "email"}],
            {"email": "a@example.com", "admin": True},
            "Unknown form fields",
        ),
    ],
)
def test_rejects_invalid_submissions(fields, responses, message):
    with pytest.raises(HTTPException) as error:
        validate_submission(fields, responses)
    assert message in error.value.detail


def test_rejects_duplicate_names_and_invalid_option_values():
    with pytest.raises(HTTPException) as duplicate_error:
        validate_form_config(
            {
                "form": {
                    "fields": [
                        {"name": "answer", "label": "A", "type": "text"},
                        {"name": "answer", "label": "B", "type": "text"},
                    ]
                }
            }
        )
    assert "Duplicate form field" in duplicate_error.value.detail

    with pytest.raises(HTTPException) as option_error:
        validate_form_config(
            {
                "form": {
                    "fields": [
                        {
                            "name": "choice",
                            "label": "Choice",
                            "type": "select",
                            "options": ["same", "same"],
                        }
                    ]
                }
            }
        )
    assert "unique values" in option_error.value.detail


def test_enabled_form_needs_fields_before_publishing():
    with pytest.raises(HTTPException) as error:
        validate_form_config({"form": {"enabled": True, "fields": []}}, require_fields=True)
    assert "at least one field" in error.value.detail

    validate_form_config(
        {"form": {"enabled": False, "fields": []}},
        require_fields=True,
    )


def test_review_fields_and_decisions_are_dynamic_and_validated():
    review_fields = [
        {
            "name": "decision_note",
            "label": "Decision note",
            "type": "textarea",
            "required": True,
        },
        {
            "name": "priority",
            "label": "Priority",
            "type": "select",
            "required": False,
            "options": ["normal", "urgent"],
        },
    ]
    validate_form_config(
        {
            "form": {
                "fields": [{"name": "email", "label": "Email", "type": "email"}],
                "review_fields": review_fields,
            }
        }
    )

    with pytest.raises(HTTPException) as missing_review_note:
        validate_submission(review_fields, {}, require_required=True)
    assert "decision_note" in missing_review_note.value.detail

    reviewed = validate_submission(
        review_fields,
        {"decision_note": "Approved after review", "priority": "urgent"},
        require_required=True,
    )
    assert reviewed == {
        "decision_note": "Approved after review",
        "priority": "urgent",
    }

    assert FormSubmissionReview(
        status="approved",
        review_data={"decision_note": "Approved"},
    ).status == "approved"
    assert FormSubmissionReview(
        status="rejected",
        review_data={"decision_note": "Incomplete"},
    ).status == "rejected"

    with pytest.raises(ValidationError):
        FormSubmissionReview(status="published")


def test_validates_file_field_configuration_and_submission():
    fields = [
        {
            "name": "resume",
            "label": "Resume",
            "type": "file",
            "required": True,
            "accept": [".pdf", ".png"],
            "max_size_mb": 5,
        }
    ]
    validate_form_config({"form": {"fields": fields}})

    cleaned = validate_submission(
        fields,
        {
            "resume": {
                "id": "ae3182ac-3430-4d7f-ad38-d2f993d2a221",
                "filename": "resume.pdf",
                "content_type": "application/pdf",
                "size_bytes": 2048,
                "url": "/uploads/4a46adbc.pdf",
            }
        },
    )
    assert cleaned["resume"]["filename"] == "resume.pdf"


@pytest.mark.parametrize(
    "field",
    [
        {
            "name": "attachment",
            "label": "Attachment",
            "type": "file",
            "accept": [".svg"],
        },
        {
            "name": "attachment",
            "label": "Attachment",
            "type": "file",
            "max_size_mb": 0,
        },
    ],
)
def test_rejects_invalid_file_field_configuration(field):
    with pytest.raises(HTTPException):
        validate_form_config({"form": {"fields": [field]}})


def test_file_fields_cannot_be_used_for_admin_review():
    with pytest.raises(HTTPException) as error:
        validate_form_config(
            {
                "form": {
                    "fields": [
                        {"name": "email", "label": "Email", "type": "email"}
                    ],
                    "review_fields": [
                        {"name": "attachment", "label": "Attachment", "type": "file"}
                    ],
                }
            }
        )
    assert "not supported in review_fields" in error.value.detail


def test_file_submission_requires_uploaded_file_metadata():
    fields = [
        {
            "name": "attachment",
            "label": "Attachment",
            "type": "file",
            "required": True,
        }
    ]
    with pytest.raises(HTTPException) as missing_upload:
        validate_submission(fields, {})
    assert "is required" in missing_upload.value.detail

    with pytest.raises(HTTPException) as invalid_upload:
        validate_submission(fields, {"attachment": {"url": "/uploads/fake.pdf"}})
    assert "invalid uploaded file reference" in invalid_upload.value.detail


@pytest.mark.parametrize(
    ("extension", "signature"),
    [
        (".pdf", b"%PDF-1.7"),
        (".jpg", b"\xff\xd8\xff\xe0"),
        (".png", b"\x89PNG\r\n\x1a\n"),
        (".gif", b"GIF89a"),
        (".webp", b"RIFF\x00\x00\x00\x00WEBP"),
    ],
)
def test_accepts_matching_upload_signatures(extension, signature):
    assert file_signature_matches(extension, signature)


def test_rejects_file_signature_that_does_not_match_extension():
    assert not file_signature_matches(".pdf", b"<html>not a PDF</html>")


@pytest.mark.asyncio
async def test_form_upload_uses_generated_filename_and_keeps_original_name(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(forms, "UPLOAD_DIR", tmp_path)
    upload = UploadFile(
        filename="../../resume.pdf",
        file=BytesIO(b"%PDF-1.7\nsample"),
        headers=Headers({"content-type": "application/pdf"}),
    )

    path, size_bytes, filename, content_type = await forms._store_form_upload(
        upload,
        {"name": "resume", "accept": [".pdf"]},
    )

    assert path.parent == tmp_path
    assert path.name != "resume.pdf"
    assert filename == "resume.pdf"
    assert content_type == "application/pdf"
    assert size_bytes == len(b"%PDF-1.7\nsample")
    assert path.read_bytes().startswith(b"%PDF-")
    path.unlink()


@pytest.mark.asyncio
async def test_form_upload_removes_file_with_mismatched_signature(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(forms, "UPLOAD_DIR", tmp_path)
    upload = UploadFile(
        filename="not-a-pdf.pdf",
        file=BytesIO(b"<html>not a PDF</html>"),
        headers=Headers({"content-type": "application/pdf"}),
    )

    with pytest.raises(HTTPException) as error:
        await forms._store_form_upload(
            upload,
            {"name": "attachment", "accept": [".pdf"]},
        )

    assert error.value.status_code == 422
    assert list(tmp_path.iterdir()) == []
