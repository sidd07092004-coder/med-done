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
        raise HTTPException(
            status_code=422,
            detail="Page content must be an object",
        )

    form = content.get("form")

    # Pages without a form are valid.
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
        raise HTTPException(
            status_code=422,
            detail="Form fields must be a list",
        )
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
                detail=f"Field '{name}' options must be a list with at most {MAX_OPTIONS} items",
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
        raise HTTPException(
            status_code=422,
            detail="Responses must be an object",
        )

    # Validate the field configuration before checking the answers.
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
        }:
            if not isinstance(value, str):
                raise HTTPException(
                    status_code=422,
                    detail=f"Field '{name}' must be text",
                )

        elif field_type == "number":
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise HTTPException(
                    status_code=422,
                    detail=f"Field '{name}' must be a number",
                )

        elif field_type == "boolean":
            if not isinstance(value, bool):
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
            extension = ""
            filename = value.get("filename")
            if isinstance(filename, str):
                extension = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
            accepted_extensions = field.get("accept", list(FILE_TYPE_BY_EXTENSION))
            accepted_extensions = {item.lower() for item in accepted_extensions}
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