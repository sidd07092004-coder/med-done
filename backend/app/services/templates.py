"""Starter page recipes for the page builder (spec §6.2).

Each recipe is expressed with the canonical block defaults.  The recipes are
never trusted as stored JSON: :func:`get_templates` deep-copies the defaults on
every call and passes the result through :func:`sanitize_content`, so a client
receives exactly the shape the server would persist.
"""
from __future__ import annotations

import copy
from typing import Any, Dict, List

from app.services.sanitize import sanitize_content

TEMPLATES_VERSION = 1


def _blocks_blank() -> List[Dict[str, Any]]:
    # Blank must still contain a paragraph (spec §6.2).
    return [{"type": "paragraph", "text": ""}]


def _blocks_article() -> List[Dict[str, Any]]:
    return [
        {"type": "heading", "level": 2, "text": ""},
        {"type": "paragraph", "text": ""},
        {"type": "toc", "title": "On this page", "minLevel": 2, "maxLevel": 4, "maxDepth": 2},
        {"type": "heading", "level": 2, "text": ""},
        {"type": "paragraph", "text": ""},
        {"type": "callout", "variant": "info", "text": ""},
        {"type": "heading", "level": 2, "text": ""},
        {"type": "list", "ordered": False, "items": [""]},
        {"type": "references", "title": "References", "items": [{"text": ""}], "numbered": True},
    ]


def _blocks_treatment() -> List[Dict[str, Any]]:
    return [
        {"type": "hero", "title": "Treatment name", "height": "md", "align": "left"},
        {"type": "key_facts", "title": "Key facts", "items": [{"label": "", "value": ""}]},
        {"type": "heading", "level": 2, "text": ""},
        {"type": "paragraph", "text": ""},
        {"type": "steps", "items": [{"title": "", "text": ""}, {"title": "", "text": ""}], "style": "numbered"},
        {"type": "callout", "variant": "warn", "text": ""},
        {"type": "references", "title": "References", "items": [{"text": ""}], "numbered": True},
    ]


def _blocks_condition() -> List[Dict[str, Any]]:
    return [
        {"type": "hero", "title": "Condition name", "height": "md", "align": "left"},
        {"type": "key_facts", "title": "Key facts", "items": [{"label": "", "value": ""}]},
        {"type": "heading", "level": 2, "text": ""},
        {"type": "paragraph", "text": ""},
        {"type": "accordion", "items": [{"question": "", "answer": ""} for _ in range(3)], "defaultOpen": "none"},
        {"type": "references", "title": "References", "items": [{"text": ""}], "numbered": True},
    ]


def _blocks_faq() -> List[Dict[str, Any]]:
    return [
        {"type": "heading", "level": 2, "text": "Frequently asked questions"},
        {"type": "accordion", "items": [{"question": "", "answer": ""} for _ in range(3)], "defaultOpen": "none"},
        {"type": "callout", "variant": "info", "text": ""},
        {"type": "references", "title": "References", "items": [{"text": ""}], "numbered": True},
    ]


def _blocks_practitioner() -> List[Dict[str, Any]]:
    return [
        {"type": "hero", "title": "Practitioner name", "height": "md", "align": "left"},
        {"type": "heading", "level": 2, "text": ""},
        {"type": "paragraph", "text": ""},
        {"type": "key_facts", "title": "Key facts", "items": [{"label": "", "value": ""}]},
        {"type": "timeline", "items": [{"title": "", "text": ""}], "style": "line"},
    ]


# id, label, description and a factory so shared state can never leak between calls.
_TEMPLATE_DEFINITIONS = [
    ("blank", "Blank", "An empty page.", _blocks_blank),
    ("article", "Article", "A long-form article with a table of contents and references.", _blocks_article),
    ("treatment", "Treatment", "A treatment overview with key facts, steps and references.", _blocks_treatment),
    ("condition", "Condition", "A condition overview with key facts and an FAQ.", _blocks_condition),
    ("faq", "FAQ", "A frequently asked questions page.", _blocks_faq),
    ("practitioner", "Practitioner", "A practitioner profile with a timeline.", _blocks_practitioner),
]


def get_templates() -> Dict[str, Any]:
    """Return the versioned template catalogue, freshly sanitised."""
    templates: List[Dict[str, Any]] = []
    for template_id, label, description, factory in _TEMPLATE_DEFINITIONS:
        blocks = copy.deepcopy(factory())
        content = sanitize_content({"format": "blocks-v1", "blocks": blocks})
        templates.append(
            {
                "id": template_id,
                "label": label,
                "description": description,
                "content": content,
            }
        )
    return {"version": TEMPLATES_VERSION, "templates": templates}
