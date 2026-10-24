"""Derive clean plain text from stored JSON content.

The public API and search return ``content_text`` — the "clean text" the brief
asks for — regardless of how the JSON is structured.
"""
from __future__ import annotations

import re
from typing import Any, Dict


def strip_html(text: str) -> str:
    if not text:
        return ""
    clean = re.compile("<.*?>")
    text = re.sub(clean, " ", text)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _add(parts: list[str], value: Any) -> None:
    """Append a scalar text field; ignore empty values, booleans and containers."""
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, (str, int, float)):
        text = str(value)
        if text:
            parts.append(text)


def _add_item(parts: list[str], key: str, item: Any) -> None:
    if isinstance(item, dict):
        _add(parts, item.get(key))


def _block_text(block: Dict[str, Any]) -> str:
    """Extract only the searchable fields for one block (spec §3).

    Unknown blocks contribute nothing. URLs, colours, layout values, numeric
    metadata and ``consentRef`` are deliberately never included.
    """
    btype = block.get("type")
    parts: list[str] = []

    if btype in ("heading", "paragraph"):
        _add(parts, block.get("text"))

    elif btype == "list":
        items = block.get("items")
        if isinstance(items, list):
            for item in items:
                _add(parts, item)

    elif btype == "quote":
        _add(parts, block.get("text"))
        _add(parts, block.get("cite"))

    elif btype == "callout":
        _add(parts, block.get("label"))
        _add(parts, block.get("text"))

    elif btype == "image":
        _add(parts, block.get("alt"))

    elif btype == "divider":
        pass

    elif btype == "table":
        table = block.get("table")
        if isinstance(table, dict):
            header = table.get("header")
            if isinstance(header, list):
                for cell in header:
                    if cell:
                        _add(parts, cell)
            for row in table.get("rows") or []:
                if isinstance(row, list):
                    for cell in row:
                        if cell:
                            _add(parts, cell)

    elif btype == "button":
        _add(parts, block.get("label"))

    elif btype == "hero":
        _add(parts, block.get("eyebrow"))
        _add(parts, block.get("title"))
        _add(parts, block.get("subtitle"))
        for key in ("primaryCta", "secondaryCta"):
            _add_item(parts, "label", block.get(key))

    elif btype == "accordion":
        _add(parts, block.get("heading"))
        items = block.get("items")
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    _add(parts, item.get("question"))
                    _add(parts, item.get("answer"))

    elif btype == "cards":
        items = block.get("items")
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    _add(parts, item.get("title"))
                    _add(parts, item.get("text"))
                    _add(parts, item.get("ctaLabel"))

    elif btype == "steps":
        _add(parts, block.get("heading"))
        items = block.get("items")
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    _add(parts, item.get("title"))
                    _add(parts, item.get("text"))

    elif btype == "checklist":
        _add(parts, block.get("title"))
        items = block.get("items")
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    _add(parts, item.get("text"))
                    _add(parts, item.get("note"))

    elif btype == "download":
        _add(parts, block.get("label"))
        _add(parts, block.get("description"))

    elif btype == "toc":
        _add(parts, block.get("title"))

    elif btype == "references":
        _add(parts, block.get("title"))
        items = block.get("items")
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    _add(parts, item.get("text"))
                    _add(parts, item.get("publisher"))
                    _add(parts, item.get("year"))

    elif btype == "video":
        _add(parts, block.get("title"))

    elif btype == "columns":
        columns = block.get("columns")
        if isinstance(columns, list):
            for column in columns:
                if isinstance(column, list):
                    for child in column:
                        if isinstance(child, dict):
                            _add(parts, _block_text(child))

    elif btype == "gallery":
        images = block.get("images")
        if isinstance(images, list):
            for image in images:
                if isinstance(image, dict):
                    _add(parts, image.get("alt"))
                    _add(parts, image.get("caption"))

    elif btype == "timeline":
        items = block.get("items")
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    _add(parts, item.get("label"))
                    _add(parts, item.get("title"))
                    _add(parts, item.get("text"))

    elif btype == "stats":
        items = block.get("items")
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    _add(parts, item.get("value"))
                    _add(parts, item.get("label"))
                    _add(parts, item.get("source"))
                    _add(parts, item.get("note"))

    elif btype == "key_facts":
        _add(parts, block.get("title"))
        items = block.get("items")
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    _add(parts, item.get("label"))
                    _add(parts, item.get("value"))

    elif btype == "audio":
        _add(parts, block.get("title"))
        _add(parts, block.get("transcript"))

    elif btype == "testimonial":
        _add(parts, block.get("quote"))
        _add(parts, block.get("attribution"))
        _add(parts, block.get("context"))
        # consentRef is internal and must never reach search/public text.

    elif btype == "map":
        _add(parts, block.get("address"))
        _add(parts, block.get("label"))

    elif btype == "embed":
        _add(parts, block.get("title"))
        _add(parts, block.get("provider"))

    return " ".join(parts)


def extract_clean_text(content: Dict[str, Any] | None) -> str:
    if not content or not isinstance(content, dict):
        return ""

    texts = []

    # Homepage-style section fields.
    if content.get("format") == "home-v1" or "fields" in content:
        fields = content.get("fields")
        if isinstance(fields, dict):
            texts.extend(str(v) for v in fields.values() if v)

    # Structured blocks.
    if isinstance(content.get("blocks"), list):
        for block in content["blocks"]:
            if isinstance(block, dict):
                texts.append(_block_text(block))

    # Legacy / alternate shapes.
    if content.get("body"):
        texts.append(strip_html(str(content["body"])))
    if content.get("text"):
        texts.append(str(content["text"]))
    if isinstance(content.get("sections"), list):
        for section in content["sections"]:
            if isinstance(section, dict) and section.get("text"):
                texts.append(str(section["text"]))

    # Any leftover top-level string values (excluding structural keys).
    reserved = {"format", "blocks", "fields", "body", "text", "sections"}
    for key, value in content.items():
        if key not in reserved and isinstance(value, str) and value and len(value) < 500:
            texts.append(value)

    result = " ".join(t for t in texts if t)
    return strip_html(result)
