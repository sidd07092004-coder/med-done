"""Sanitization + normalisation for page content stored as JSON.

Content shapes
--------------
Normal page::

    {"format": "blocks-v1",
     "blocks": [{"type": "paragraph", "text": "..."},
                {"type": "heading", "level": 2, "text": "..."},
                {"type": "list", "ordered": false, "items": ["a", "b"]},
                {"type": "quote", "text": "...", "cite": "..."},
                {"type": "callout", "variant": "info", "text": "..."},
                {"type": "image", "src": "/uploads/x.jpg", "alt": "..."},
                {"type": "divider"}]}

Homepage::

    {"format": "home-v1", "fields": {"heroBtTitle": "...", ...}}

Everything that reaches the database goes through :func:`sanitize_content`, so
stored content is always a well-formed JSON object and text is free of HTML
(the prototype explicitly requires server-side sanitising before saving).

Design contract (page designer)
--------------------------------
The sanitiser **validates and keeps** — it never rebuilds a block from a fixed
allow-list. A block that carries a key this server does not know about keeps
that key (deep-sanitised), so a newer client talking to an older server does not
lose data.  Only the keys listed in :data:`KNOWN_PAYLOAD_KEYS` (plus ``type``
and ``layout``) have their own validator.

Two invariants are enforced everywhere:

* **Absent != zero** — a missing optional key means "no override"; the
  sanitiser never materialises a default into storage.
* **Legacy stability** — a block that carries no new key serialises exactly as
  it did before this change (same keys, same order, same values).
"""
from __future__ import annotations

import html
import json
import math
import os
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

import bleach

# Known block types. Unknown types are *not* dropped any more: they are kept
# (deep-sanitised) so that content this server does not understand survives a
# save instead of silently disappearing.
LEGACY_BLOCK_TYPES = {"heading", "paragraph", "list", "quote", "callout", "image", "divider", "table"}
NEW_BLOCK_TYPES = {
    "button",
    "hero",
    "accordion",
    "cards",
    "steps",
    "checklist",
    "download",
    "toc",
    "references",
    "video",
    "columns",
    "gallery",
    "timeline",
    "stats",
    "key_facts",
    "audio",
    "testimonial",
    "map",
    "embed",
}
BLOCK_TYPES = LEGACY_BLOCK_TYPES | NEW_BLOCK_TYPES
CALLOUT_VARIANTS = {"info", "warn", "ok", "bad"}  # built-in variants (custom slugs are allowed too)
CALLOUT_SHAPES = {"rectangle", "rounded", "square", "oval", "circle"}
TEXT_ALIGNS = {"left", "center", "right", "justify"}
IMAGE_ALIGNS = {"left", "center", "right"}
IMAGE_FITS = {"cover", "contain", "fill"}
BORDER_STYLES = {"none", "solid", "dashed", "dotted"}
MAX_BLOCKS = 2000
MAX_TEXT = 20000
MAX_ITEMS = 500
MAX_BLOCK_BYTES = 262_144
MAX_TABLE_ROWS = 200
MAX_TABLE_COLS = 50
MAX_CELL_CHARS = 2000
MAX_HEADER_CELLS = 50
UNKNOWN_BLOCK_KEYS = 50

# Page-builder expansion limits (spec §2.1).
MAX_COLUMNS = 10
MIN_COLUMNS = 2
MAX_COLUMN_BLOCKS = 20
MAX_NESTED_BLOCKS = 60
MAX_RICH_SPANS = 500
MAX_RICH_TEXT = 20_000
MAX_RICH_SPAN_TEXT = 5_000
MAX_GALLERY_IMAGES = 24
MAX_REFERENCES = 100
MAX_STATS = 6
MAX_KEY_FACTS = 10
MAX_DOWNLOAD_BYTES = 1_073_741_824
MAX_ACCORDION_ITEMS = 50
MAX_CARDS = 12
MAX_STEPS = 20
MAX_CHECKLIST_ITEMS = 50
MAX_TIMELINE_ITEMS = 20
EMBED_PROVIDERS = {"youtube", "vimeo", "spotify", "google_maps"}

#: Item-list blocks that shrink by dropping trailing entries when over the byte
#: cap (spec §2.5). ``gallery`` uses ``images`` instead of ``items``.
SHRINKABLE_ITEM_BLOCKS = {
    "gallery",
    "references",
    "cards",
    "checklist",
    "accordion",
    "timeline",
    "stats",
    "key_facts",
}

# Keys that must never survive a round trip: prototype-pollution vectors, raw
# author CSS / class names and event handlers.
_DENIED_KEYS = {
    "__proto__",
    "constructor",
    "prototype",
    "dangerouslySetInnerHTML",
    "className",
    "style",
}
_DENIED_KEYS_LOWER = {k.lower() for k in _DENIED_KEYS}

# Keys that carry their own validator and are therefore not copied verbatim as
# "extras" on a known block type.
KNOWN_PAYLOAD_KEYS = {
    "heading": {"level", "text", "textColor"},
    "paragraph": {"text", "rich"},
    "list": {"ordered", "items", "richItems"},
    "quote": {"text", "cite", "rich"},
    "callout": {
        "variant",
        "text",
        "rich",
        "label",
        "backgroundColor",
        "textColor",
        "borderColor",
        "shape",
    },
    "image": {"src", "alt", "width", "height", "align", "fit", "radius"},
    "divider": set(),
    "table": {"table"},
    "button": {"label", "href", "variant", "size", "align", "newTab"},
    "hero": {
        "eyebrow",
        "title",
        "subtitle",
        "imageSrc",
        "imageAlt",
        "height",
        "overlay",
        "align",
        "primaryCta",
        "secondaryCta",
    },
    "accordion": {"heading", "items", "allowMultiple", "defaultOpen"},
    "cards": {"items", "columns", "variant", "linkWholeCard"},
    "steps": {"heading", "items", "style"},
    "checklist": {"title", "items", "style"},
    "download": {"fileSrc", "label", "description", "fileType", "fileSizeBytes", "newTab"},
    "toc": {"title", "minLevel", "maxLevel", "maxDepth", "sticky"},
    "references": {"title", "items", "numbered"},
    "video": {"src", "poster", "captionsSrc", "title", "autoplay", "loop", "muted", "controls"},
    "columns": {"columns", "ratio", "gap", "stackAt"},
    "gallery": {"images", "display", "columns", "lightbox", "aspect"},
    "timeline": {"items", "style"},
    "stats": {"items", "variant"},
    "key_facts": {"title", "items"},
    "audio": {"src", "title", "transcript", "controls"},
    "testimonial": {"quote", "attribution", "context", "consentRef", "avatarSrc"},
    "map": {"address", "lat", "lng", "zoom", "label", "staticImageSrc", "directionsUrl"},
    "embed": {"provider", "url", "title", "consentRequired"},
}

_URL_RE = re.compile(r"^(https?://|/|data:image/)", re.IGNORECASE)
_SLUG_RE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_IMAGE_DATA_RE = re.compile(r"^data:image/(?:png|jpe?g|gif|webp);base64,", re.IGNORECASE)

_RICH_MARKS = ("bold", "italic", "superscript", "subscript")
_RICH_MARK_SET = set(_RICH_MARKS)

_EMBED_URL_RES = {
    "youtube": re.compile(
        r"^https://(?:www\.youtube\.com|www\.youtube-nocookie\.com)/embed/[A-Za-z0-9_-]{6,}(?:\?.*)?$"
    ),
    "vimeo": re.compile(r"^https://player\.vimeo\.com/video/\d+(?:\?.*)?$"),
    "spotify": re.compile(
        r"^https://open\.spotify\.com/embed/(?:track|album|playlist|episode|show)/[A-Za-z0-9]+(?:\?.*)?$"
    ),
    "google_maps": re.compile(r"^https://www\.google\.com/maps/embed\?pb=.+$"),
}

_DOWNLOAD_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def _clean_text(value: Any, limit: int = MAX_TEXT) -> str:
    """Strip every HTML tag and normalise whitespace-safe text.

    The *whole* pipeline (entity decoding + tag stripping) is folded to a fixed
    point, not just the decoding step: ``bleach`` escapes a stray ``<`` back
    into ``&lt;``, so decoding and stripping separately is **not** idempotent
    ("&lt&lt/&gt!" -> "&lt;!" -> "" loses author text on the second save).

    Folding the pair keeps the sanitiser a fixed point, so a save -> load ->
    save cycle never drifts and never drops text (F.6).
    """
    if value is None:
        return ""
    text = str(value)
    # Decode entities first so "&lt;script&gt;" is handled, then strip tags.
    # The *pair* is applied to a fixed point (max 10 rounds) so that neither a
    # double-encoded entity ("&amp;lt;script&amp;gt;") nor a re-escaped "<"
    # can survive as something a later consumer might decode again.
    for _ in range(10):
        nxt = bleach.clean(html.unescape(text), tags=[], attributes={}, strip=True)
        if nxt == text:
            break
        text = nxt
    text = text.replace("\x00", "")
    return text[:limit]


def safe_url(value: Any) -> str:
    """Allow http(s), site-relative paths and inline data images only."""
    if not value:
        return ""
    url = str(value).strip()
    if not _URL_RE.match(url):
        return ""
    # Cap inline data URLs (a few MB of base64) to avoid unbounded blobs.
    if url.lower().startswith("data:image/") and len(url) > 8_000_000:
        return ""
    return url[:8_000_000]


def _has_unsafe_url_chars(url: str) -> bool:
    """True when a URL contains whitespace or control characters."""
    return any(ch.isspace() or ord(ch) < 0x20 or ord(ch) == 0x7F for ch in url)


def _is_site_relative(url: str) -> bool:
    """A single-slash site-relative path (``//`` and ``/\\`` are rejected)."""
    return url.startswith("/") and not url.startswith("//") and not url.startswith("/\\")


def safe_href(value: Any) -> str:
    """Validate a navigation href (spec §2.1). Invalid values become ``""``."""
    if value is None or isinstance(value, bool):
        return ""
    url = str(value).strip()
    if not url or len(url) > 2048 or _has_unsafe_url_chars(url):
        return ""
    lower = url.lower()
    if _is_site_relative(url):
        return url
    if lower.startswith("http://") or lower.startswith("https://"):
        return url
    if lower.startswith("mailto:") or lower.startswith("tel:"):
        return url
    return ""


def safe_media_url(value: Any) -> str:
    """Validate an audio/video/poster URL: http(s) or site-relative only."""
    if value is None or isinstance(value, bool):
        return ""
    url = str(value).strip()
    if not url or len(url) > 2048 or _has_unsafe_url_chars(url):
        return ""
    lower = url.lower()
    if _is_site_relative(url):
        return url
    if lower.startswith("http://") or lower.startswith("https://"):
        return url
    return ""


def safe_image_url(value: Any) -> str:
    """Validate an image URL including safe inline raster data URLs.

    ``safe_url`` (kept unchanged for the legacy image block) accepts any
    ``data:image/`` payload, including SVG. The page-builder image helper is
    stricter: only PNG/JPEG/GIF/WebP base64 payloads are allowed.
    """
    if value is None or isinstance(value, bool):
        return ""
    url = str(value).strip()
    if not url or _has_unsafe_url_chars(url):
        return ""
    lower = url.lower()
    if lower.startswith("data:"):
        if not _IMAGE_DATA_RE.match(url) or len(url) > 8_000_000:
            return ""
        return url
    if url.startswith("//") or url.startswith("/\\"):
        return ""
    return safe_url(url)


def safe_upload_url(value: Any) -> str:
    """Download files must live in the local upload library (spec §2.1)."""
    if value is None or isinstance(value, bool):
        return ""
    url = str(value).strip()
    if not url or len(url) > 2048 or _has_unsafe_url_chars(url):
        return ""
    if url.startswith("//") or url.startswith("/\\"):
        return ""
    if not url.startswith("/uploads/"):
        return ""
    return url


def _sanitize_link(value: Any) -> Optional[Dict[str, Any]]:
    """Validate a rich-text link; never invent one (spec §2.1)."""
    if not isinstance(value, dict):
        return None
    href = safe_href(value.get("href"))
    if not href:
        return None
    out: Dict[str, Any] = {"href": href}
    # "real newTab" (spec §2.1): store an actual boolean, not a truthy value.
    if isinstance(value.get("newTab"), bool):
        out["newTab"] = value["newTab"]
    return out


def _sanitize_rich(value: Any, fallback_text: Any = "") -> Optional[List[Dict[str, Any]]]:
    """Normalise a rich-text span array (spec §2.3).

    ``fallback_text`` is accepted for call-site symmetry; the caller keeps the
    plain field when this returns ``None``.
    """
    if not isinstance(value, (list, tuple)):
        return None

    spans: List[Dict[str, Any]] = []
    total = 0
    for raw in list(value)[:MAX_RICH_SPANS]:
        if not isinstance(raw, dict):
            continue
        span_text = _clean_text(raw.get("text"), MAX_RICH_SPAN_TEXT)
        if not span_text:
            continue
        remaining = MAX_RICH_TEXT - total
        if remaining <= 0:
            break
        if len(span_text) > remaining:
            span_text = span_text[:remaining]
        total += len(span_text)

        span: Dict[str, Any] = {"text": span_text}
        raw_marks = raw.get("marks")
        if isinstance(raw_marks, list):
            found = set()
            for mark in raw_marks:
                if isinstance(mark, str):
                    low = mark.strip().lower()
                    if low in _RICH_MARK_SET:
                        found.add(low)
            marks = [mark for mark in _RICH_MARKS if mark in found]
            if marks:
                span["marks"] = marks
        link = _sanitize_link(raw.get("link"))
        if link:
            span["link"] = link
        spans.append(span)
        if total >= MAX_RICH_TEXT:
            break
    return spans or None


def _rich_projection(rich: List[Dict[str, Any]]) -> str:
    return "".join(str(span.get("text", "")) for span in rich)


# --------------------------------------------------------------------------- #
# Primitive validators. Every one of them returns ``None`` for "absent/invalid"
# so that the caller can simply skip the key (absent != zero).
# --------------------------------------------------------------------------- #

def _hex_color(value: Any) -> Optional[str]:
    """``#rgb`` / ``#rrggbb`` -> lowercase ``#rrggbb``; anything else -> None."""
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip()
    if not _HEX_RE.match(text):
        return None
    if len(text) == 4:  # #abc -> #aabbcc
        text = "#" + "".join(ch * 2 for ch in text[1:])
    return text.lower()

# Typography settings
ALLOWED_FONT_FAMILIES = {
    "Cormorant Garamond",
    "DM Sans",
    "Jost",
    "Lora",
}

ALLOWED_FONT_WEIGHTS = {300, 400, 500, 600, 700, 800}


def _font_family(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text if text in ALLOWED_FONT_FAMILIES else None


def _font_weight(value: Any) -> Optional[int]:
    return _int_in_strict(value, 300, 800) if (
        _int_value(value) in ALLOWED_FONT_WEIGHTS
    ) else None


def _sanitize_typography(value: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(value, dict):
        return None

    out: Dict[str, Any] = {}

    # Theme-level font roles
    for key in ("siteFont", "bodyFont", "articleTitleFont"):
        family = _font_family(value.get(key))
        if family is not None:
            out[key] = family

    # Block-level typography
    family = _font_family(value.get("fontFamily"))
    if family is not None:
        out["fontFamily"] = family

    weight = _font_weight(value.get("fontWeight"))
    if weight is not None:
        out["fontWeight"] = weight

    return out or None


def _int_in(value: Any, lo: int, hi: int) -> Optional[int]:
    """Coerce to an int and clamp it into ``[lo, hi]``; None when invalid."""
    number = _int_value(value)
    if number is None:
        return None
    return min(hi, max(lo, number))


def _float_in(value: Any, lo: float, hi: float) -> Optional[float]:
    """Coerce a finite number (int/float/string) and clamp it into ``[lo, hi]``."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number: float = float(value)
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            number = float(text)
        except ValueError:
            return None
    else:
        return None
    if not math.isfinite(number):
        return None
    return min(hi, max(lo, number))


def _int_in_strict(value: Any, lo: int, hi: int) -> Optional[int]:
    """Like :func:`_int_in` but out-of-range values are rejected, not clamped."""
    number = _int_value(value)
    if number is None or number < lo or number > hi:
        return None
    return number


def _int_value(value: Any) -> Optional[int]:
    """Coerce ints / integral floats / numeric strings to an int (no clamping)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value) or not value.is_integer():
            return None
        return int(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return int(text)
        except ValueError:
            return None
    return None


def _bool_or_none(value: Any) -> Optional[bool]:
    """Accept real bools, 0/1 and "true"/"false"; anything else -> None."""
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        text = value.strip().lower()
        if text == "true":
            return True
        if text == "false":
            return False
    return None


def _enum(value: Any, allowed: set) -> Optional[str]:
    """Lowercase the value and return it when it is part of ``allowed``."""
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip().lower()
    return text if text in allowed else None


def _slug(value: Any) -> Optional[str]:
    """``^[a-z][a-z0-9_-]{0,31}$`` after lowercasing; anything else -> None."""
    if not isinstance(value, str):
        return None
    text = value.strip().lower()
    return text if _SLUG_RE.match(text) else None


def _string_list(value: Any, *, max_items: int, max_chars: int) -> Optional[List[str]]:
    """A list of cleaned strings; non-lists -> None."""
    if not isinstance(value, (list, tuple)):
        return None
    out: List[str] = []
    for item in list(value)[:max_items]:
        if item is None:
            continue
        out.append(_clean_text(item, max_chars))
    return out


def _clean_row(value: Any) -> Optional[List[str]]:
    """Clean one table row; a non-list row is skipped (never a single cell)."""
    if not isinstance(value, (list, tuple)):
        return None
    row: List[str] = []
    for cell in list(value)[:MAX_TABLE_COLS]:
        if cell is None:
            row.append("")
        elif isinstance(cell, (str, int, float, bool)):
            row.append(_clean_text(str(cell), MAX_CELL_CHARS))
        else:
            row.append(_clean_text("[invalid cell]", MAX_CELL_CHARS))
    return row


def _is_denied_key(key: str) -> bool:
    """Deny prototype pollution vectors, raw CSS/class names and ``on*`` keys."""
    low = str(key).lower()
    if low in _DENIED_KEYS_LOWER:
        return True
    return low.startswith("on")


def _sanitize_extra(value: Any, depth: int = 0) -> Any:
    """Deep-sanitise an unknown value (bounded depth / width)."""
    if depth > 8:
        return None
    if isinstance(value, str):
        return _clean_text(value)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, (list, tuple)):
        return [_sanitize_extra(item, depth + 1) for item in list(value)[:200]]
    if isinstance(value, dict):
        out: Dict[str, Any] = {}
        for key, item in list(value.items())[:200]:
            if not isinstance(key, str) or _is_denied_key(key):
                continue
            out[key] = _sanitize_extra(item, depth + 1)
        return out
    return _clean_text(str(value))


# --------------------------------------------------------------------------- #
# Block payload validators
# --------------------------------------------------------------------------- #

def _sanitize_layout(value: Any) -> Optional[Dict[str, Any]]:
    """Validate the optional per-block ``layout`` object (R10: {} is dropped)."""
    if not isinstance(value, dict):
        return None
    out: Dict[str, Any] = {}

    text_align = _enum(value.get("textAlign"), TEXT_ALIGNS)
    if text_align is not None:
        out["textAlign"] = text_align
    for key, lo, hi in (
        ("width", 0, 100),
        ("offsetX", -100, 100),
        ("marginTop", 0, 200),
        ("marginBottom", 0, 200),
        ("borderWidth", 0, 8),
        ("borderRadius", 0, 64),
        ("padding", 0, 64),
    ):
        number = _int_in(value.get(key), lo, hi)
        if number is not None:
            out[key] = number
    for key in ("backgroundColor", "textColor", "borderColor"):
        color = _hex_color(value.get(key))
        if color is not None:
            out[key] = color
    border_style = _enum(value.get("borderStyle"), BORDER_STYLES)
    if border_style is not None:
        out["borderStyle"] = border_style

    return out or None


def _sanitize_image_fields(block: Dict[str, Any], out: Dict[str, Any]) -> None:
    """Validate the optional image sizing keys (no defaults are materialised)."""
    width = _int_in_strict(block.get("width"), 1, 100)
    if width is not None:
        out["width"] = width
    height = _int_in_strict(block.get("height"), 1, 4000)
    if height is not None:
        out["height"] = height
    align = _enum(block.get("align"), IMAGE_ALIGNS)
    if align is not None:
        out["align"] = align
    fit = _enum(block.get("fit"), IMAGE_FITS)
    if fit is not None:
        out["fit"] = fit
    radius = _int_in_strict(block.get("radius"), 0, 64)
    if radius is not None:
        out["radius"] = radius


def _sanitize_callout_fields(block: Dict[str, Any], out: Dict[str, Any]) -> None:
    """Validate the optional callout design keys."""
    variant = _slug(block.get("variant")) or "info"
    out["variant"] = variant  # replaces the legacy branch's value (same value)
    if "label" in block:
        # An explicitly sent empty label is preserved (R7).
        out["label"] = _clean_text(block.get("label"), 200)
    for key in ("backgroundColor", "textColor", "borderColor"):
        color = _hex_color(block.get(key))
        if color is not None:
            out[key] = color
    shape = _enum(block.get("shape"), CALLOUT_SHAPES)
    if shape is not None:
        out["shape"] = shape


def _sanitize_table(value: Any) -> Optional[Dict[str, Any]]:
    """Validate + normalise the nested ``table`` payload (see the spec §B.6)."""
    if not isinstance(value, dict):
        return None
    out: Dict[str, Any] = {}

    if "header" in value:
        header = _string_list(value.get("header"), max_items=MAX_HEADER_CELLS, max_chars=MAX_CELL_CHARS)
        if header is not None:
            out["header"] = header  # an explicit [] is preserved (R4)

    raw_rows = value.get("rows")
    rows: List[List[str]] = []
    if isinstance(raw_rows, list):
        for row in raw_rows[:MAX_TABLE_ROWS]:
            cleaned = _clean_row(row)
            if cleaned is not None:
                rows.append(cleaned)
    out["rows"] = rows  # always present (R13)

    cols = len(out.get("header") or [])
    if cols == 0:
        cols = max((len(row) for row in rows), default=0)
    for index, row in enumerate(rows):
        rows[index] = (row + [""] * cols)[:cols]

    if "align" in value:
        aligns = _string_list(value.get("align"), max_items=MAX_TABLE_COLS, max_chars=16) or []
        aligns = [
            a.strip().lower() if a.strip().lower() in {"left", "center", "right"} else "left"
            for a in aligns
        ]
        out["align"] = (aligns + ["left"] * cols)[:cols]

    for key in ("headerBackgroundColor", "headerTextColor"):
        color = _hex_color(value.get(key))
        if color is not None:
            out[key] = color
    for key in ("bordered", "striped"):
        flag = _bool_or_none(value.get(key))
        if flag is not None:
            out[key] = flag

    return out


def _sanitize_unknown_block(block: Dict[str, Any], btype: str) -> Optional[Dict[str, Any]]:
    """Keep a block whose type this server does not know (deep-sanitised)."""
    if not _SLUG_RE.match(btype):
        return None
    out: Dict[str, Any] = {"type": btype}
    extras = 0
    for key, value in block.items():
        if not isinstance(key, str) or key in ("type", "layout") or _is_denied_key(key):
            continue
        if extras >= UNKNOWN_BLOCK_KEYS:
            break
        out[key] = _sanitize_extra(value)
        extras += 1
    layout = _sanitize_layout(block.get("layout"))
    if layout:
        out["layout"] = layout
    return out


def _sanitize_cta(value: Any) -> Optional[Dict[str, Any]]:
    """Hero CTA: stored only with a non-empty label and a valid href."""
    if not isinstance(value, dict):
        return None
    label = _clean_text(value.get("label"), 80)
    href = safe_href(value.get("href"))
    if not label or not href:
        return None
    out: Dict[str, Any] = {"label": label, "href": href}
    new_tab = _bool_or_none(value.get("newTab"))
    if new_tab is not None:
        out["newTab"] = new_tab
    return out


def _download_file_type(src: str) -> str:
    """Derive the download file type from the upload extension (client input ignored)."""
    path = src.split("?", 1)[0].split("#", 1)[0]
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        return "pdf"
    if ext == ".docx":
        return "docx"
    if ext in _DOWNLOAD_IMAGE_EXTS:
        return "image"
    return "other"


def _safe_embed_url(provider: str, value: Any) -> str:
    """Canonical embed URL for ``provider`` (spec §4.4); anything else -> ``""``."""
    if not isinstance(value, str):
        return ""
    url = value.strip()
    if not url or len(url) > 2048 or _has_unsafe_url_chars(url):
        return ""
    pattern = _EMBED_URL_RES.get(provider)
    if pattern is None or not pattern.match(url):
        return ""
    return url


def _sanitize_columns(value: Any, depth: int = 0) -> List[List[Dict[str, Any]]]:
    """Validate the nested ``columns`` payload (spec §2.4); never raises."""
    if depth > 0 or not isinstance(value, (list, tuple)):
        return [[], []]

    raw_columns = list(value)[:MAX_COLUMNS]
    while len(raw_columns) < MIN_COLUMNS:
        raw_columns.append([])

    out: List[List[Dict[str, Any]]] = []
    total = 0
    for raw_column in raw_columns:
        column: List[Dict[str, Any]] = []
        if isinstance(raw_column, (list, tuple)):
            for raw_block in list(raw_column)[:MAX_COLUMN_BLOCKS]:
                if total >= MAX_NESTED_BLOCKS:
                    break
                child = _sanitize_block(raw_block, depth + 1)
                if child is None:
                    continue
                child = _enforce_block_cap(child)
                column.append(child)
                total += 1
        out.append(column)
    return out



def _sanitize_block(block: Any, depth: int = 0) -> Optional[Dict[str, Any]]:
    if not isinstance(block, dict):
        return None

    raw_type = block.get("type")
    btype = raw_type.strip().lower() if isinstance(raw_type, str) else ""

    if btype not in BLOCK_TYPES:
        return _sanitize_unknown_block(block, btype)

    # Columns may not nest (spec §2.4): drop nested block, keep siblings.
    if btype == "columns" and depth > 0:
        return None

    out: Dict[str, Any]

    if btype == "heading":
        try:
            level = int(block.get("level", 2))
        except (TypeError, ValueError):
            level = 2

        level = min(4, max(1, level))

        out = {
            "type": "heading",
            "level": level,
            "text": _clean_text(block.get("text")),
        }

        # Support root-level textColor
        text_color = _hex_color(block.get("textColor"))
        if text_color is not None:
            out["textColor"] = text_color


    elif btype == "paragraph":
        plain = _clean_text(block.get("text"))
        rich = _sanitize_rich(block.get("rich"), plain)

        out = {
            "type": "paragraph",
            "text": _rich_projection(rich) if rich else plain,
        }

        if rich:
            out["rich"] = rich

    elif btype == "list":
        raw_items = block.get("items") or []

        if isinstance(raw_items, str):
            raw_items = raw_items.split("\n")
        elif not isinstance(raw_items, (list, tuple)):
            raw_items = []

        raw_rich_items = block.get("richItems")
        if not isinstance(raw_rich_items, (list, tuple)):
            raw_rich_items = None

        pairs: List[Tuple[str, Optional[List[Dict[str, Any]]]]] = []
        any_rich = False

        for index, item in enumerate(raw_items):
            item_text = _clean_text(item, 2000)
            rich = None

            if raw_rich_items is not None and index < len(raw_rich_items):
                rich = _sanitize_rich(raw_rich_items[index], item_text)

            if rich:
                item_text = _rich_projection(rich)
                any_rich = True

            if str(item).strip() or rich:
                pairs.append((item_text, rich))

            if len(pairs) >= MAX_ITEMS:
                break

        out = {
            "type": "list",
            "ordered": bool(block.get("ordered", False)),
            "items": [pair[0] for pair in pairs],
        }

        if any_rich:
            out["richItems"] = [pair[1] or [] for pair in pairs]

    elif btype == "quote":
        plain = _clean_text(block.get("text"))
        rich = _sanitize_rich(block.get("rich"), plain)

        out = {
            "type": "quote",
            "text": _rich_projection(rich) if rich else plain,
        }

        if rich:
            out["rich"] = rich

        cite = _clean_text(block.get("cite"), 512)
        if cite:
            out["cite"] = cite

    elif btype == "callout":
        variant = _slug(block.get("variant")) or "info"
        plain = _clean_text(block.get("text"))
        rich = _sanitize_rich(block.get("rich"), plain)

        out = {
            "type": "callout",
            "variant": variant,
            "text": _rich_projection(rich) if rich else plain,
        }

        if rich:
            out["rich"] = rich

    elif btype == "image":
        raw_src = block.get("src")
        src = safe_url(raw_src)

        if not src:
            if isinstance(raw_src, str) and not raw_src.strip():
                src = ""
            else:
                return None

        out = {
            "type": "image",
            "src": src,
            "alt": _clean_text(block.get("alt"), 1000),
        }

    elif btype == "divider":
        out = {"type": "divider"}

    elif btype == "table":
        out = {"type": "table"}
        table = _sanitize_table(block.get("table"))
        out["table"] = table if table is not None else {"rows": []}

    elif btype == "button":
        out = {
            "type": "button",
            "label": _clean_text(block.get("label"), 80),
        }

        href = safe_href(block.get("href"))
        if href:
            out["href"] = href

        variant = _enum(block.get("variant"), {"primary", "secondary", "ghost"})
        if variant is not None:
            out["variant"] = variant

        size = _enum(block.get("size"), {"sm", "md", "lg"})
        if size is not None:
            out["size"] = size

        align = _enum(block.get("align"), IMAGE_ALIGNS)
        if align is not None:
            out["align"] = align

        new_tab = _bool_or_none(block.get("newTab"))
        if new_tab is not None:
            out["newTab"] = new_tab

    elif btype == "hero":
        out = {
            "type": "hero",
            "title": _clean_text(block.get("title"), 200),
        }

        eyebrow = _clean_text(block.get("eyebrow"), 80)
        if eyebrow:
            out["eyebrow"] = eyebrow

        subtitle = _clean_text(block.get("subtitle"), 400)
        if subtitle:
            out["subtitle"] = subtitle

        image_src = safe_image_url(block.get("imageSrc"))
        image_alt = _clean_text(block.get("imageAlt"), 250)

        if image_src and image_alt:
            out["imageSrc"] = image_src
            out["imageAlt"] = image_alt

        height = _enum(block.get("height"), {"sm", "md", "lg"})
        if height is not None:
            out["height"] = height

        overlay = _int_in(block.get("overlay"), 0, 80)
        if overlay is not None:
            out["overlay"] = overlay

        align = _enum(block.get("align"), {"left", "center"})
        if align is not None:
            out["align"] = align

        primary_cta = _sanitize_cta(block.get("primaryCta"))
        if primary_cta is not None:
            out["primaryCta"] = primary_cta

        secondary_cta = _sanitize_cta(block.get("secondaryCta"))
        if secondary_cta is not None:
            out["secondaryCta"] = secondary_cta

    elif btype == "accordion":
        out = {"type": "accordion"}

        heading = _clean_text(block.get("heading"), 200)
        if heading:
            out["heading"] = heading

        raw_items = block.get("items")
        items: List[Dict[str, Any]] = []

        if isinstance(raw_items, list):
            for raw_item in raw_items[:MAX_ACCORDION_ITEMS]:
                if not isinstance(raw_item, dict):
                    continue

                question = _clean_text(raw_item.get("question"), 200)
                answer = _clean_text(raw_item.get("answer"), 5000)
                rich = _sanitize_rich(raw_item.get("rich"), answer)

                if rich:
                    answer = _rich_projection(rich)

                if not (question or answer):
                    continue

                item: Dict[str, Any] = {
                    "question": question,
                    "answer": answer,
                }

                if rich:
                    item["rich"] = rich

                items.append(item)

        out["items"] = items

        allow_multiple = _bool_or_none(block.get("allowMultiple"))
        if allow_multiple is not None:
            out["allowMultiple"] = allow_multiple

        default_open = _enum(block.get("defaultOpen"), {"none", "first", "all"})
        if default_open is not None:
            out["defaultOpen"] = default_open

    elif btype == "cards":
        raw_items = block.get("items")
        items = []

        if isinstance(raw_items, list):
            for raw_item in raw_items[:MAX_CARDS]:
                if not isinstance(raw_item, dict):
                    continue

                image_src = safe_image_url(raw_item.get("imageSrc"))
                image_alt = _clean_text(raw_item.get("imageAlt"), 250)
                title = _clean_text(raw_item.get("title"), 120)
                text = _clean_text(raw_item.get("text"), 400)
                href = safe_href(raw_item.get("href"))
                cta_label = _clean_text(raw_item.get("ctaLabel"), 60)

                if not (title or text or image_src):
                    continue

                item = {"title": title}

                if image_src:
                    item["imageSrc"] = image_src
                    item["imageAlt"] = image_alt

                if text:
                    item["text"] = text

                if href:
                    item["href"] = href
                    if cta_label:
                        item["ctaLabel"] = cta_label

                new_tab = _bool_or_none(raw_item.get("newTab"))
                if new_tab is not None:
                    item["newTab"] = new_tab

                items.append(item)

        out = {"type": "cards", "items": items}

        columns = _int_in(block.get("columns"), 1, 3)
        if columns is not None:
            out["columns"] = columns

        variant = _enum(block.get("variant"), {"image-top", "compact"})
        if variant is not None:
            out["variant"] = variant

        link_whole = _bool_or_none(block.get("linkWholeCard"))
        if link_whole is not None:
            out["linkWholeCard"] = link_whole

    elif btype == "steps":
        out = {"type": "steps"}

        heading = _clean_text(block.get("heading"), 200)
        if heading:
            out["heading"] = heading

        raw_items = block.get("items")
        items = []

        if isinstance(raw_items, list):
            for raw_item in raw_items[:MAX_STEPS]:
                if not isinstance(raw_item, dict):
                    continue

                title = _clean_text(raw_item.get("title"), 120)
                item_text = _clean_text(raw_item.get("text"), 1000)

                if not (title or item_text):
                    continue

                item = {"title": title}
                if item_text:
                    item["text"] = item_text

                items.append(item)

        out["items"] = items

        style = _enum(block.get("style"), {"numbered", "plain"})
        if style is not None:
            out["style"] = style

    elif btype == "checklist":
        out = {"type": "checklist"}

        title = _clean_text(block.get("title"), 200)
        if title:
            out["title"] = title

        raw_items = block.get("items")
        items = []

        if isinstance(raw_items, list):
            for raw_item in raw_items[:MAX_CHECKLIST_ITEMS]:
                if not isinstance(raw_item, dict):
                    continue

                item_text = _clean_text(raw_item.get("text"), 300)
                if not item_text:
                    continue

                item = {"text": item_text}
                note = _clean_text(raw_item.get("note"), 200)

                if note:
                    item["note"] = note

                items.append(item)

        out["items"] = items

        style = _enum(block.get("style"), {"check", "number"})
        if style is not None:
            out["style"] = style

    elif btype == "download":
        file_src = safe_upload_url(block.get("fileSrc"))

        out = {
            "type": "download",
            "fileSrc": file_src,
            "label": _clean_text(block.get("label"), 120),
            "fileType": _download_file_type(file_src),
        }

        description = _clean_text(block.get("description"), 300)
        if description:
            out["description"] = description

        size = _int_in(block.get("fileSizeBytes"), 0, MAX_DOWNLOAD_BYTES)
        if size is not None:
            out["fileSizeBytes"] = size

        new_tab = _bool_or_none(block.get("newTab"))
        if new_tab is not None:
            out["newTab"] = new_tab

    elif btype == "toc":
        out = {"type": "toc"}

        title = _clean_text(block.get("title"), 120)
        if title:
            out["title"] = title

        min_level = _int_in_strict(block.get("minLevel"), 1, 4)
        max_level = _int_in_strict(block.get("maxLevel"), 1, 4)

        if min_level is not None and max_level is not None and min_level > max_level:
            min_level, max_level = max_level, min_level

        if min_level is not None:
            out["minLevel"] = min_level

        if max_level is not None:
            out["maxLevel"] = max_level

        max_depth = _int_in_strict(block.get("maxDepth"), 1, 3)
        if max_depth is not None:
            out["maxDepth"] = max_depth

        sticky = _bool_or_none(block.get("sticky"))
        if sticky is not None:
            out["sticky"] = sticky

    elif btype == "references":
        out = {"type": "references"}

        title = _clean_text(block.get("title"), 120)
        if title:
            out["title"] = title

        raw_items = block.get("items")
        items = []

        if isinstance(raw_items, list):
            for raw_item in raw_items[:MAX_REFERENCES]:
                if not isinstance(raw_item, dict):
                    continue

                item_text = _clean_text(raw_item.get("text"), 300)
                if not item_text:
                    continue

                item = {"text": item_text}

                url = safe_href(raw_item.get("url"))
                if url:
                    item["url"] = url

                publisher = _clean_text(raw_item.get("publisher"), 200)
                if publisher:
                    item["publisher"] = publisher

                year = _int_in_strict(raw_item.get("year"), 1800, 2100)
                if year is not None:
                    item["year"] = year

                items.append(item)

        out["items"] = items

        numbered = _bool_or_none(block.get("numbered"))
        if numbered is not None:
            out["numbered"] = numbered

    elif btype == "video":
        out = {
            "type": "video",
            "src": safe_media_url(block.get("src")),
            "controls": True,
        }

        poster = safe_media_url(block.get("poster"))
        if poster:
            out["poster"] = poster

        captions = safe_media_url(block.get("captionsSrc"))
        if captions and captions.split("?", 1)[0].lower().endswith(".vtt"):
            out["captionsSrc"] = captions

        title = _clean_text(block.get("title"), 200)
        if title:
            out["title"] = title

        autoplay = _bool_or_none(block.get("autoplay"))
        loop = _bool_or_none(block.get("loop"))
        muted = _bool_or_none(block.get("muted"))

        if autoplay is not None:
            out["autoplay"] = autoplay

        if loop is not None:
            out["loop"] = loop

        if autoplay:
            muted = True

        if muted is not None:
            out["muted"] = muted

    elif btype == "columns":
        out = {
            "type": "columns",
            "columns": _sanitize_columns(block.get("columns"), depth),
        }

        ratio = _enum(block.get("ratio"), {"equal", "wide-left", "wide-right"})
        if ratio is not None:
            out["ratio"] = ratio

        gap = _int_in(block.get("gap"), 0, 64)
        if gap is not None:
            out["gap"] = gap

        stack_at = _enum(block.get("stackAt"), {"mobile", "tablet"})
        if stack_at is not None:
            out["stackAt"] = stack_at

    elif btype == "gallery":
        raw_images = block.get("images")
        images = []

        if isinstance(raw_images, list):
            for raw_image in raw_images[:MAX_GALLERY_IMAGES]:
                if not isinstance(raw_image, dict):
                    continue

                src = safe_image_url(raw_image.get("src"))
                if not src:
                    continue

                image = {
                    "src": src,
                    "alt": _clean_text(raw_image.get("alt"), 250),
                }

                caption = _clean_text(raw_image.get("caption"), 300)
                if caption:
                    image["caption"] = caption

                images.append(image)

        out = {"type": "gallery", "images": images}

        display = _enum(block.get("display"), {"grid", "carousel"})
        if display is not None:
            out["display"] = display

        columns = _int_in(block.get("columns"), 2, 4)
        if columns is not None:
            out["columns"] = columns

        lightbox = _bool_or_none(block.get("lightbox"))
        if lightbox is not None:
            out["lightbox"] = lightbox

        aspect = _enum(block.get("aspect"), {"square", "4:3", "16:9", "natural"})
        if aspect is not None:
            out["aspect"] = aspect

    elif btype == "timeline":
        raw_items = block.get("items")
        items = []

        if isinstance(raw_items, list):
            for raw_item in raw_items[:MAX_TIMELINE_ITEMS]:
                if not isinstance(raw_item, dict):
                    continue

                label = _clean_text(raw_item.get("label"), 80)
                title = _clean_text(raw_item.get("title"), 120)
                item_text = _clean_text(raw_item.get("text"), 600)

                if not (label or title or item_text):
                    continue

                item = {"title": title}

                if label:
                    item["label"] = label

                if item_text:
                    item["text"] = item_text

                items.append(item)

        out = {"type": "timeline", "items": items}

        style = _enum(block.get("style"), {"line", "cards"})
        if style is not None:
            out["style"] = style

    elif btype == "stats":
        raw_items = block.get("items")
        items = []

        if isinstance(raw_items, list):
            for raw_item in raw_items[:MAX_STATS]:
                if not isinstance(raw_item, dict):
                    continue

                value = _clean_text(raw_item.get("value"), 20)
                label = _clean_text(raw_item.get("label"), 80)
                source = _clean_text(raw_item.get("source"), 200)
                note = _clean_text(raw_item.get("note"), 200)

                if not (value or label or source or note):
                    continue

                item = {
                    "value": value,
                    "label": label,
                    "source": source,
                }

                if note:
                    item["note"] = note

                items.append(item)

        out = {"type": "stats", "items": items}

        variant = _enum(block.get("variant"), {"cards", "inline"})
        if variant is not None:
            out["variant"] = variant

    elif btype == "key_facts":
        out = {"type": "key_facts"}

        title = _clean_text(block.get("title"), 120)
        if title:
            out["title"] = title

        raw_items = block.get("items")
        items = []

        if isinstance(raw_items, list):
            for raw_item in raw_items[:MAX_KEY_FACTS]:
                if not isinstance(raw_item, dict):
                    continue

                label = _clean_text(raw_item.get("label"), 80)
                value = _clean_text(raw_item.get("value"), 200)

                if not (label or value):
                    continue

                items.append({"label": label, "value": value})

        out["items"] = items

    elif btype == "audio":
        out = {
            "type": "audio",
            "src": safe_media_url(block.get("src")),
            "transcript": _clean_text(block.get("transcript"), 20000),
            "controls": True,
        }

        title = _clean_text(block.get("title"), 200)
        if title:
            out["title"] = title

    elif btype == "testimonial":
        out = {
            "type": "testimonial",
            "quote": _clean_text(block.get("quote"), 1000),
            "attribution": _clean_text(block.get("attribution"), 120),
            "consentRef": _clean_text(block.get("consentRef"), 120),
        }

        context = _clean_text(block.get("context"), 200)
        if context:
            out["context"] = context

        avatar = safe_image_url(block.get("avatarSrc"))
        if avatar:
            out["avatarSrc"] = avatar

    elif btype == "map":
        out = {
            "type": "map",
            "address": _clean_text(block.get("address"), 300),
        }

        lat = _float_in(block.get("lat"), -90, 90)
        if lat is not None:
            out["lat"] = lat

        lng = _float_in(block.get("lng"), -180, 180)
        if lng is not None:
            out["lng"] = lng

        zoom = _int_in(block.get("zoom"), 1, 20)
        if zoom is not None:
            out["zoom"] = zoom

        label = _clean_text(block.get("label"), 120)
        if label:
            out["label"] = label

        static_image = safe_image_url(block.get("staticImageSrc"))
        if static_image:
            out["staticImageSrc"] = static_image

        directions = safe_href(block.get("directionsUrl"))
        if directions:
            out["directionsUrl"] = directions

    elif btype == "embed":
        provider = _enum(block.get("provider"), EMBED_PROVIDERS) or "youtube"
        raw_url = block.get("url") or block.get("src")

        out = {
            "type": "embed",
            "provider": provider,
            "url": _safe_embed_url(provider, raw_url),
        }

        title = _clean_text(block.get("title"), 200)
        if title:
            out["title"] = title

        consent = _bool_or_none(block.get("consentRequired"))
        if consent is not None:
            out["consentRequired"] = consent

    else:  # pragma: no cover
        return None

    # Validate and attach layout properties.
    layout = _sanitize_layout(block.get("layout"))
    if layout:
        out["layout"] = layout

    # Type-specific payloads.
    if btype == "callout":
        _sanitize_callout_fields(block, out)
    elif btype == "image":
        _sanitize_image_fields(block, out)

    # Optional block-level typography overrides.
    typography = _sanitize_typography(block.get("typography"))
    if typography:
        block_typography = {
            key: typography[key]
            for key in ("fontFamily", "fontWeight")
            if key in typography
        }
        if block_typography:
            out["typography"] = block_typography

    # Preserve safe unknown keys.
    reserved = {"type", "layout", "typography"} | KNOWN_PAYLOAD_KEYS[btype]
    extras = 0

    for key, value in block.items():
        if not isinstance(key, str) or key in reserved or _is_denied_key(key):
            continue

        if extras >= UNKNOWN_BLOCK_KEYS:
            break

        out[key] = _sanitize_extra(value)
        extras += 1

    return out



# --------------------------------------------------------------------------- #
# Per-block byte cap
# --------------------------------------------------------------------------- #

def _block_size(block: Dict[str, Any]) -> int:
    """Serialised size of a block (the unit :data:`MAX_BLOCK_BYTES` counts)."""
    return len(json.dumps(block, ensure_ascii=False, default=str))


def _iter_strings(value: Any, path: Tuple[Any, ...] = ()):
    """Yield ``(path, string)`` for every non-empty string inside ``value``."""
    if isinstance(value, str):
        if value:
            yield path, value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from _iter_strings(item, path + (key,))
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            yield from _iter_strings(item, path + (index,))


def _path_rank(path: Tuple[Any, ...]) -> int:
    """Preference rank of a string path: ``text`` first, then ``items``, then rest."""
    if not path:
        return 3
    if path[0] == "text":
        return 0
    if path[0] == "items":
        return 1
    return 2


def _pick_longest_string(block: Dict[str, Any]):
    """Pick the string to shrink next: the longest one, ties broken by preference."""
    best_path = None
    best_value = None
    best_key = None
    for path, value in _iter_strings(block):
        key = (-len(value), _path_rank(path))
        if best_key is None or key < best_key:
            best_key = key
            best_path = path
            best_value = value
    return best_path, best_value


def _set_at_path(root: Any, path: Tuple[Any, ...], value: Any) -> None:
    """Assign ``value`` at ``path`` inside ``root`` (in place)."""
    node = root
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value


def _truncate_strings_to_fit(block: Dict[str, Any]) -> None:
    """Shrink the block's longest strings until it fits the byte cap (in place).

    The longest string is cut first (``text`` wins a tie, then ``items``, then
    the remaining fields). A single string never loses more than half of its
    content in one step, so the loss is spread over the block instead of
    wiping one field out.
    """
    while _block_size(block) > MAX_BLOCK_BYTES:
        path, value = _pick_longest_string(block)
        if path is None:
            break  # nothing left to shrink
        excess = _block_size(block) - MAX_BLOCK_BYTES
        cut = max(1, min(len(value) - 1, excess, len(value) // 2))
        _set_at_path(block, path, value[: len(value) - cut])


def _largest_fitting_prefix(length: int, size_of: Callable[[int], int]) -> int:
    """Largest ``k <= length`` whose serialised size still fits the byte cap.

    The size grows monotonically with ``k``, so a binary search finds the exact
    cut point without re-serialising the block for every single entry.
    """
    if size_of(0) > MAX_BLOCK_BYTES:
        return 0
    if size_of(length) <= MAX_BLOCK_BYTES:
        return length
    low, high = 0, length
    while low + 1 < high:
        middle = (low + high) // 2
        if size_of(middle) <= MAX_BLOCK_BYTES:
            low = middle
        else:
            high = middle
    return low


def _shrink_list_items(block: Dict[str, Any]) -> None:
    """Drop trailing ``items`` (and parallel ``richItems``) until the cap fits."""
    items = block.get("items")
    if not isinstance(items, list) or not items:
        return
    rich_items = block.get("richItems")
    has_rich = isinstance(rich_items, list)

    def size_of(count: int) -> int:
        trial = dict(block)
        trial["items"] = items[:count]
        if has_rich:
            trial["richItems"] = rich_items[:count]
        return _block_size(trial)

    keep = _largest_fitting_prefix(len(items), size_of)
    del items[keep:]
    if has_rich:
        del rich_items[keep:]


def _shrink_item_list(block: Dict[str, Any], key: str) -> None:
    """Drop trailing entries of an item-list block (``items`` / ``images``)."""
    items = block.get(key)
    if not isinstance(items, list) or not items:
        return

    def size_of(count: int) -> int:
        trial = dict(block)
        trial[key] = items[:count]
        return _block_size(trial)

    del items[_largest_fitting_prefix(len(items), size_of):]


def _shrink_columns(block: Dict[str, Any]) -> None:
    """Drop trailing child blocks from the last column first (spec §2.5)."""
    columns = block.get("columns")
    if not isinstance(columns, list) or not columns:
        return
    while _block_size(block) > MAX_BLOCK_BYTES:
        target = None
        for index in range(len(columns) - 1, -1, -1):
            if isinstance(columns[index], list) and columns[index]:
                target = index
                break
        if target is None:
            break
        columns[target].pop()


def _shrink_table_rows(block: Dict[str, Any]) -> None:
    """Drop trailing ``rows`` of a table block until it fits the byte cap (F.3)."""
    table = block.get("table")
    if not isinstance(table, dict):
        return
    rows = table.get("rows")
    if not isinstance(rows, list) or not rows:
        return

    def size_of(count: int) -> int:
        trial_table = dict(table)
        trial_table["rows"] = rows[:count]
        trial = dict(block)
        trial["table"] = trial_table
        return _block_size(trial)

    del rows[_largest_fitting_prefix(len(rows), size_of):]


def _enforce_block_cap(block: Dict[str, Any]) -> Dict[str, Any]:
    """Keep a block below :data:`MAX_BLOCK_BYTES` by SHRINKING it — never by deleting it.

    Dropping an over-cap block silently loses author content (a 131 item list or
    a >256 KiB inline image is legal input the editor can produce in seconds),
    so the block is shrunk instead and always survives:

    * ``list``  — trailing ``items`` are dropped (the block survives, even with
      ``items: []``).
    * ``table`` — trailing ``rows`` are dropped (F.3, unchanged).
    * ``image`` — an inline ``data:`` payload is dropped (``src`` becomes ``""``
      so the renderers show their visible "no source" placeholder); the block
      and its ``alt`` survive.
    * everything else (text bearing and unknown blocks) — the longest string
      values are truncated until the block fits.

    This function never returns ``None``.
    """
    if _block_size(block) <= MAX_BLOCK_BYTES:
        return block

    btype = block.get("type")

    if btype == "list" and isinstance(block.get("items"), list):
        # Drop trailing items — the block itself is kept.
        _shrink_list_items(block)
    elif btype == "table":
        # F.3: the table is truncated (rows dropped from the end), not deleted.
        _shrink_table_rows(block)
    elif btype == "image":
        # An inline data URL is the only thing that can blow the cap here:
        # drop the payload, keep the block (and its alt text).
        src = block.get("src")
        if isinstance(src, str) and src.lower().startswith("data:"):
            block["src"] = ""
    elif btype in SHRINKABLE_ITEM_BLOCKS:
        # Page-builder item lists shrink by dropping trailing entries.
        _shrink_item_list(block, "images" if btype == "gallery" else "items")
    elif btype == "columns":
        # Columns shrink by dropping trailing child blocks from the last column.
        _shrink_columns(block)

    # Fallback for every other shape (text bearing and unknown blocks):
    # truncate the longest strings until the block fits.
    if _block_size(block) > MAX_BLOCK_BYTES:
        _truncate_strings_to_fit(block)

    return block

def _sanitize_theme(value: Any) -> Optional[Dict[str, Any]]:
    """Validate page-level theme settings."""
    if not isinstance(value, dict):
        return None

    theme: Dict[str, Any] = {}

    # Background color: only valid hex colors
    color = _hex_color(value.get("backgroundColor"))
    if color is not None:
        theme["backgroundColor"] = color

    # Text color: only valid hex colors
    text_color = _hex_color(value.get("textColor"))
    if text_color is not None:
        theme["textColor"] = text_color

    # Background image: only safe image URLs
    image = safe_image_url(value.get("backgroundImage"))
    if image:
        theme["backgroundImage"] = image

    # Canvas width: numeric pixel value between 320 and 2400
    width = _int_in_strict(value.get("canvasWidth"), 320, 2400)
    if width is not None:
        theme["canvasWidth"] = width

    # Gradient: accept a CSS linear-gradient value with basic safety checks.
    gradient = value.get("gradient")
    if isinstance(gradient, str):
        gradient = gradient.strip()
        if (
            len(gradient) <= 500
            and re.fullmatch(
                r"linear-gradient\(\s*[\w\s.,%#()-]+\)",
                gradient,
                flags=re.IGNORECASE,
            )
            and "url(" not in gradient.lower()
            and "expression" not in gradient.lower()
        ):
            theme["gradient"] = gradient

    typography = _sanitize_typography(value.get("typography"))
    if typography:
        # Theme only accepts global font roles.
        theme_typography = {
            key: typography[key]
            for key in ("siteFont", "bodyFont", "articleTitleFont")
            if key in typography
        }
        if theme_typography:
            theme["typography"] = theme_typography

    return theme or None


def sanitize_content(content: Any) -> Dict[str, Any]:
    """Return a safe, canonical content object ready to persist."""
    if not isinstance(content, dict):
        return {"format": "blocks-v1", "blocks": []}

    fmt = str(content.get("format", "")).strip()

    # Homepage-style section fields.
    if fmt == "home-v1" or ("fields" in content and "blocks" not in content):
        fields = content.get("fields")
        if not isinstance(fields, dict):
            fields = {}
        clean_fields = {str(k): _clean_text(v) for k, v in fields.items()}
        return {"format": "home-v1", "fields": clean_fields}

    blocks = content.get("blocks")
    if not isinstance(blocks, list):
        blocks = []
    clean_blocks: List[Dict[str, Any]] = []
    for b in blocks[:MAX_BLOCKS]:
        sb = _sanitize_block(b, 0)
        if sb is None:
            continue
        # _enforce_block_cap never deletes a block — it only shrinks it.
        sb = _enforce_block_cap(sb)
        if sb is not None:
            clean_blocks.append(sb)

    result: Dict[str, Any] = {
        "format": "blocks-v1",
        "blocks": clean_blocks,
    }

    # Preserve the dynamic form configuration after sanitizing it.
    raw_form = content.get("form")

    if isinstance(raw_form, dict):
        clean_form = _sanitize_extra(raw_form)

        if isinstance(clean_form, dict):
            result["form"] = clean_form

    # Preserve validated page theme settings
    raw_theme = content.get("theme")
    clean_theme = _sanitize_theme(raw_theme)

    if clean_theme:
        result["theme"] = clean_theme

    return result


def blocks_to_html(content: Any) -> str:
    """Render stored content to HTML (used for exports/previews)."""
    if not isinstance(content, dict):
        return ""
    fmt = content.get("format")

    if fmt == "home-v1":
        parts = []
        for k, v in (content.get("fields") or {}).items():
            if v:
                parts.append(f"<p><strong>{html.escape(str(k))}</strong>: {html.escape(str(v))}</p>")
        return "".join(parts)

    out: List[str] = []
    for b in content.get("blocks") or []:
        if not isinstance(b, dict):
            continue
        t = b.get("type")

        if t == "heading":
            # Legacy blocks keep their content under ``data`` (data.text /
            # data.level) with an empty top-level ``text``; fall back to it.
            data = b.get("data")
            if not isinstance(data, dict):
                data = {}

            text = b.get("text") or data.get("text") or ""

            raw_level = b.get("level")
            if raw_level is None:
                raw_level = data.get("level", 2)
            try:
                lvl = min(4, max(1, int(raw_level)))
            except (TypeError, ValueError):
                lvl = 2

            # Only the block-level ``textColor`` is used. ``layout.textColor``
            # is a separate field and is deliberately NOT treated as the same.
            # No block color -> no inline style -> the heading inherits the
            # theme/default color.
            text_color = _hex_color(b.get("textColor"))
            style = f' style="color:{text_color}"' if text_color else ""

            out.append(
                f"<h{lvl}{style}>{html.escape(str(text))}</h{lvl}>"
            )

        elif t == "paragraph":
            out.append(f"<p>{html.escape(str(b.get('text', '')))}</p>")
        elif t == "list":
            tag = "ol" if b.get("ordered") else "ul"
            lis = "".join(f"<li>{html.escape(str(i))}</li>" for i in b.get("items") or [])
            out.append(f"<{tag}>{lis}</{tag}>")
        elif t == "quote":
            out.append(f"<blockquote>{html.escape(str(b.get('text', '')))}</blockquote>")
        elif t == "callout":
            label = str(b.get("label") or "").strip()
            prefix = f"<strong>{html.escape(label)}</strong> " if label else ""
            out.append(
                f"<p class=\"callout {html.escape(str(b.get('variant', 'info')))}\">"
                f"{prefix}{html.escape(str(b.get('text', '')))}</p>"
            )
        elif t == "image":
            src = html.escape(str(b.get("src", "")))
            alt = html.escape(str(b.get("alt", "")))
            styles = []
            width = _int_in_strict(b.get("width"), 1, 100)
            if width is not None:
                styles.append(f"width:{width}%")
            height = _int_in_strict(b.get("height"), 1, 4000)
            if height is not None:
                styles.append(f"height:{height}px")
            radius = _int_in_strict(b.get("radius"), 0, 64)
            if radius is not None:
                styles.append(f"border-radius:{radius}px")
            style_attr = f' style="{";".join(styles)}"' if styles else ""
            align = _enum(b.get("align"), IMAGE_ALIGNS)
            img = f'<img src="{src}" alt="{alt}"{style_attr}>'
            if align:
                out.append(f'<figure style="text-align:{align}">{img}</figure>')
            else:
                out.append(img)
        elif t == "table":
            table = b.get("table") or {}
            header = table.get("header") or []
            rows = table.get("rows") or []
            thead = ""
            if header:
                thead = "<thead><tr>" + "".join(
                    f"<th>{html.escape(str(c))}</th>" for c in header
                ) + "</tr></thead>"
            body = "<tbody>" + "".join(
                "<tr>" + "".join(
                    f"<td>{html.escape(str(c)).replace(chr(10), '<br>')}</td>"
                    for c in (row if isinstance(row, (list, tuple)) else [])
                ) + "</tr>"
                for row in rows
            ) + "</tbody>"
            classes = "content-table" + (" content-table--bordered" if table.get("bordered", True) else "")
            out.append(
                f'<div class="content-table-wrap"><table class="{classes}">{thead}{body}</table></div>'
            )
        elif t == "divider":
            out.append("<hr>")
    return "".join(out)