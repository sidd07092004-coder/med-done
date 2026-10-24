"""Helpers for rendering group names in the requested language."""
from __future__ import annotations

from typing import Any


def localized_group_name(group: Any, lang: str | None) -> str:
    """Return the translation for ``lang`` or fall back to the base (English) name."""
    translations = getattr(group, "name_translations", None) or {}
    return translations.get(lang) or group.name
