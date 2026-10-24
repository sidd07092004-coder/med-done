"""Map a page to its top-level site section (mirrors the prototype's sectionOf)."""
from __future__ import annotations

SHARED = {"stories", "submit-story", "community", "blog", "resources", "glossary"}
SECTIONS = ["Homepage", "Brain Tumors", "Endometriosis", "Shared sections", "About, legal, and other"]


def section_of(slug: str) -> str:
    if slug == "home":
        return "Homepage"
    first = (slug or "").split("/")[0]
    if first == "bt":
        return "Brain Tumors"
    if first == "en":
        return "Endometriosis"
    if first in SHARED:
        return "Shared sections"
    return "About, legal, and other"
