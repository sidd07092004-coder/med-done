"""Pure-function tests for the page-designer content schema.

No database, no network, no running server. These tests pin the sanitiser
contract (``sanitize_content`` / ``blocks_to_html``), the derived search text
(``extract_clean_text``) and the ``PageUpdate`` schema flags.

See ``work/page-designer/03-prompt.md`` §2.15 for the required test list.
"""
from __future__ import annotations

import json
import random

import pytest

from app.schemas.page import PageUpdate
from app.services.content_text import extract_clean_text
from app.services.sanitize import (
    MAX_BLOCK_BYTES,
    blocks_to_html,
    sanitize_content,
)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def blocks(*items):
    return {"format": "blocks-v1", "blocks": list(items)}


def one(block):
    return sanitize_content(blocks(block))["blocks"][0]


def text(block):
    return extract_clean_text(blocks(block))


def sanitize_block(block):
    """Run a stored (already-sanitised) block through the sanitiser again."""
    return sanitize_content(blocks(block))["blocks"][0]


# --------------------------------------------------------------------------- #
# 1-8: Legacy blocks serialise exactly as before (no new keys materialised).
# --------------------------------------------------------------------------- #

LEGACY_FIXTURES = [
    {"type": "heading", "level": 2, "text": "Hi"},
    {"type": "paragraph", "text": "Hello"},
    {"type": "list", "ordered": False, "items": ["a", "b"]},
    {"type": "quote", "text": "Words"},
    {"type": "callout", "variant": "info", "text": "Note"},
    {"type": "image", "src": "/uploads/x.jpg", "alt": "A cat"},
    {"type": "divider"},
]


def test_legacy_heading_unchanged():
    assert one({"type": "heading", "level": 2, "text": "Hi"}) == {
        "type": "heading",
        "level": 2,
        "text": "Hi",
    }


def test_legacy_paragraph_unchanged():
    assert one({"type": "paragraph", "text": "Hello"}) == {
        "type": "paragraph",
        "text": "Hello",
    }


def test_legacy_list_unchanged():
    assert one({"type": "list", "ordered": False, "items": ["a", "b"]}) == {
        "type": "list",
        "ordered": False,
        "items": ["a", "b"],
    }


def test_legacy_list_string_items_split():
    assert one({"type": "list", "items": "a\nb"}) == {
        "type": "list",
        "ordered": False,
        "items": ["a", "b"],
    }


def test_legacy_quote_unchanged():
    assert one({"type": "quote", "text": "Words"}) == {
        "type": "quote",
        "text": "Words",
    }
    with_cite = one({"type": "quote", "text": "Words", "cite": "Someone"})
    assert with_cite["cite"] == "Someone"
    assert "cite" not in one({"type": "quote", "text": "Words", "cite": ""})


def test_legacy_callout_unchanged():
    out = one({"type": "callout", "variant": "info", "text": "Note"})
    assert out == {"type": "callout", "variant": "info", "text": "Note"}
    assert "label" not in out
    assert not any(k.endswith("Color") for k in out)


def test_legacy_image_unchanged():
    out = one({"type": "image", "src": "/uploads/x.jpg", "alt": "A cat"})
    assert out == {"type": "image", "src": "/uploads/x.jpg", "alt": "A cat"}
    assert not {"width", "height", "align", "fit", "radius"} & set(out)


def test_legacy_divider_unchanged():
    assert one({"type": "divider"}) == {"type": "divider"}


@pytest.mark.parametrize("fixture", LEGACY_FIXTURES, ids=lambda f: f["type"])
def test_legacy_golden_roundtrip(fixture):
    first = one(fixture)
    assert sanitize_block(first) == first


def test_legacy_no_layout_materialised():
    # R10: a block without layout never gains a layout key.
    for fixture in LEGACY_FIXTURES:
        assert "layout" not in one(fixture)


# --------------------------------------------------------------------------- #
# 10-11: Entity handling / idempotency (R11).
# --------------------------------------------------------------------------- #

def test_encoded_entities_idempotent():
    block = {
        "type": "paragraph",
        "text": "&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;",
    }
    first = one(block)
    assert "<script" not in first["text"]
    # Also confirm the raw HTML was dropped.
    assert one({"type": "paragraph", "text": "<script>alert(1)</script>"})["text"] == "alert(1)"
    assert sanitize_block(first) == first


def test_ampersand_escaped_and_idempotent():
    first = one({"type": "paragraph", "text": "A & B"})
    assert first["text"] == "A &amp; B"
    assert sanitize_block(first) == first

    already = one({"type": "paragraph", "text": "&amp;"})
    assert already["text"] == "&amp;"
    assert sanitize_block(already) == already


# --------------------------------------------------------------------------- #
# 10b: The sanitiser must be a fixed point (B1).
#
# Decoding entities and stripping tags are not commutative: bleach escapes a
# stray "<" back into "&lt;", so folding only the decode step left the pair
# drifting — "&lt&lt/&gt!" -> "&lt;!" -> "" silently lost author text on the
# second save. The whole pipeline is folded to a fixed point now.
# --------------------------------------------------------------------------- #

#: Strings that used to drift (text lost on the second save).
B1_CORPUS = [
    "&lt&lt/&gt!",
    "<<!&gt/&gt",
    "&lt;</>!>t",
    "&lt;<!>t ",
]


@pytest.mark.parametrize("text", B1_CORPUS)
def test_clean_text_is_a_fixed_point(text):
    once = sanitize_content(blocks({"type": "paragraph", "text": text}))
    assert sanitize_content(once) == once


def _fuzz_texts(count=2000, seed=20261022):
    """Deterministic corpus of adversarial strings (entities, tags + prose)."""
    rng = random.Random(seed)
    alphabet = list("&<>;!lt g/#")
    prose = [
        "patient",
        "diagnosis",
        "symptom",
        "treatment",
        "therapy",
        "clinic",
        "mg",
        "note",
    ]
    out = []
    for _ in range(count):
        parts = []
        for _ in range(rng.randint(0, 40)):
            if rng.random() < 0.25:
                parts.append(rng.choice(prose))
            else:
                parts.append(rng.choice(alphabet))
        out.append("".join(parts))
    return out


def test_clean_text_is_idempotent_over_a_fuzz_corpus():
    """The property (not two hand-picked strings) is what the suite enforces."""
    failures = []
    for text in _fuzz_texts():
        once = sanitize_content(blocks({"type": "paragraph", "text": text}))
        twice = sanitize_content(once)
        if once != twice:
            failures.append((text, once, twice))
    assert not failures, failures[:3]


def test_fixed_point_keeps_the_security_output_unchanged():
    assert one({"type": "paragraph", "text": "<script>alert(1)</script>"})["text"] == "alert(1)"
    assert "<script" not in one(
        {"type": "paragraph", "text": "&lt;script&gt;alert(1)&lt;/script&gt;"}
    )["text"]
    assert one({"type": "paragraph", "text": "ordinary prose about patients"})["text"] == (
        "ordinary prose about patients"
    )
    assert one({"type": "paragraph", "text": "A & B"})["text"] == "A &amp; B"


# --------------------------------------------------------------------------- #
# 12-19: Layout validation.
# --------------------------------------------------------------------------- #

def test_layout_all_fields():
    block = {
        "type": "paragraph",
        "text": "x",
        "layout": {
            "textAlign": "center",
            "width": 70,
            "offsetX": 5,
            "marginTop": 12,
            "marginBottom": 8,
            "backgroundColor": "#F7F7F8",
            "borderColor": "#D0D7DE",
            "borderWidth": 1,
            "borderStyle": "solid",
            "borderRadius": 8,
            "padding": 16,
        },
    }
    layout = one(block)["layout"]
    assert layout["textAlign"] == "center"
    assert layout["width"] == 70
    assert layout["offsetX"] == 5
    assert layout["backgroundColor"] == "#f7f7f8"
    assert layout["borderColor"] == "#d0d7de"
    assert layout["borderWidth"] == 1
    assert layout["borderStyle"] == "solid"
    assert layout["borderRadius"] == 8
    assert layout["padding"] == 16


def test_layout_absent_not_materialised():
    assert "layout" not in one({"type": "paragraph", "text": "x"})


def test_layout_empty_dropped():
    assert "layout" not in one({"type": "paragraph", "text": "x", "layout": {}})
    assert "layout" not in one(
        {"type": "paragraph", "text": "x", "layout": {"textAlign": "diagonal"}}
    )


def test_layout_zero_width_kept():
    layout = one({"type": "paragraph", "text": "x", "layout": {"width": 0}})["layout"]
    assert layout["width"] == 0


def test_layout_ranges():
    out = one(
        {
            "type": "paragraph",
            "text": "x",
            "layout": {
                "width": 101,
                "offsetX": -101,
                "padding": 65,
                "marginTop": -5,
                "marginBottom": 999,
                "borderRadius": 1000,
            },
        }
    )["layout"]
    assert out["width"] == 100
    assert out["offsetX"] == -100
    assert out["padding"] == 64
    assert out["marginTop"] == 0
    assert out["marginBottom"] == 200
    assert out["borderRadius"] == 64


def test_layout_numeric_strings():
    out = one({"type": "paragraph", "text": "x", "layout": {"width": "12"}})["layout"]
    assert out["width"] == 12


@pytest.mark.parametrize("value", ["12.5", True, False, "abc", [1]])
def test_layout_invalid_numbers_absent(value):
    # An all-invalid layout is dropped entirely (R10); when combined with a
    # valid key, only the invalid number is omitted.
    block = {"type": "paragraph", "text": "x", "layout": {"width": value, "padding": 4}}
    layout = one(block)["layout"]
    assert "width" not in layout
    assert layout["padding"] == 4


def test_layout_colors():
    assert one({"type": "paragraph", "text": "x", "layout": {"backgroundColor": "#ABC"}})[
        "layout"
    ]["backgroundColor"] == "#aabbcc"
    for bad in ("red", "#ffff", "rgb(0,0,0)", "000000"):
        layout = one(
            {"type": "paragraph", "text": "x", "layout": {"backgroundColor": bad}}
        ).get("layout", {})
        assert "backgroundColor" not in layout


def test_layout_border_style_absent_no_solid():
    # R1: width alone does not synthesise borderStyle.
    layout = one({"type": "paragraph", "text": "x", "layout": {"borderWidth": 3}})["layout"]
    assert layout["borderWidth"] == 3
    assert "borderStyle" not in layout


# --------------------------------------------------------------------------- #
# 20-22: Image sizing.
# --------------------------------------------------------------------------- #

def test_image_sizing_valid():
    out = one(
        {
            "type": "image",
            "src": "/uploads/x.jpg",
            "alt": "x",
            "width": 60,
            "height": 240,
            "align": "center",
            "fit": "contain",
            "radius": 12,
        }
    )
    assert out["width"] == 60
    assert out["height"] == 240
    assert out["align"] == "center"
    assert out["fit"] == "contain"
    assert out["radius"] == 12


def test_image_defaults_not_stored():
    out = one({"type": "image", "src": "/uploads/x.jpg", "alt": "x"})
    assert set(out) == {"type", "src", "alt"}


@pytest.mark.parametrize(
    "key,value",
    [
        ("width", 0),
        ("width", 101),
        ("height", 0),
        ("height", 4001),
        ("align", "middle"),
        ("fit", "stretch"),
        ("radius", 65),
    ],
)
def test_image_invalid_sizing(key, value):
    out = one({"type": "image", "src": "/uploads/x.jpg", "alt": "x", key: value})
    assert key not in out


def test_image_invalid_src_drops_block():
    assert sanitize_content(blocks({"type": "image", "src": "javascript:alert(1)"}))["blocks"] == []
    assert sanitize_content(blocks({"type": "image", "alt": "x"}))["blocks"] == []


# --------------------------------------------------------------------------- #
# 23-27: Callout design.
# --------------------------------------------------------------------------- #

def test_callout_legacy_not_upgraded():
    out = one({"type": "callout", "variant": "warn", "text": "x"})
    assert out == {"type": "callout", "variant": "warn", "text": "x"}


def test_callout_design_fields():
    out = one(
        {
            "type": "callout",
            "variant": "warn",
            "text": "x",
            "label": "Watch out",
            "backgroundColor": "#EEF6FF",
            "textColor": "#243447",
            "borderColor": "#B8CCE0",
            "shape": "oval",
        }
    )
    assert out["label"] == "Watch out"
    assert out["backgroundColor"] == "#eef6ff"
    assert out["textColor"] == "#243447"
    assert out["borderColor"] == "#b8cce0"
    assert out["shape"] == "oval"


def test_callout_custom_variant_preserved():
    assert one({"type": "callout", "variant": "insurance-note", "text": "x"})["variant"] == (
        "insurance-note"
    )
    assert one({"type": "callout", "variant": "Info!", "text": "x"})["variant"] == "info"


def test_callout_empty_label_preserved():
    out = one({"type": "callout", "variant": "info", "text": "x", "label": ""})
    assert out["label"] == ""


def test_callout_shape_enum():
    for shape in ("rectangle", "rounded", "square", "oval", "circle"):
        assert one({"type": "callout", "text": "x", "shape": shape})["shape"] == shape
    assert "shape" not in one({"type": "callout", "text": "x", "shape": "pill"})
    assert one({"type": "callout", "text": "x", "shape": "ROUNDED"})["shape"] == "rounded"


# --------------------------------------------------------------------------- #
# 28-38: Table validation.
# --------------------------------------------------------------------------- #

def test_table_basic():
    out = one(
        {
            "type": "table",
            "table": {
                "header": ["Symptom", "Common"],
                "rows": [["Headache", "Yes"], ["Nausea", "No"]],
            },
        }
    )
    assert out["table"]["header"] == ["Symptom", "Common"]
    assert out["table"]["rows"] == [["Headache", "Yes"], ["Nausea", "No"]]
    assert "bordered" not in out["table"]
    assert not any(k.endswith("Color") for k in out["table"])


def test_table_pads_and_truncates_rows():
    out = one(
        {
            "type": "table",
            "table": {
                "header": ["a", "b", "c"],
                "rows": [["x"], ["p", "q", "r", "s"]],
            },
        }
    )
    assert out["table"]["rows"] == [["x", "", ""], ["p", "q", "r"]]


def test_table_align_padding():
    out = one(
        {
            "type": "table",
            "table": {
                "header": ["a", "b", "c"],
                "rows": [["1", "2", "3"]],
                "align": ["center", "bogus"],
            },
        }
    )
    assert out["table"]["align"] == ["center", "left", "left"]


def test_table_header_empty_preserved():
    out = one({"type": "table", "table": {"header": [], "rows": [["a"]]}})
    assert out["table"]["header"] == []
    assert out["table"]["rows"] == [["a"]]


def test_table_missing_table_payload():
    assert one({"type": "table"}) == {"type": "table", "table": {"rows": []}}
    assert one({"type": "table", "table": {"rows": "nope"}})["table"] == {"rows": []}


def test_table_non_list_rows_dropped():
    out = one({"type": "table", "table": {"rows": [["a"], "bad", {"x": 1}]}})
    assert out["table"]["rows"] == [["a"]]


def test_table_cell_newlines_preserved():
    out = one({"type": "table", "table": {"rows": [["a\nb"]]}})
    assert out["table"]["rows"][0][0] == "a\nb"
    assert text({"type": "table", "table": {"rows": [["a\nb"]]}}) == "a b"


def test_table_cell_coercion():
    out = one({"type": "table", "table": {"rows": [[None, 1, True, ["x"], {"y": 1}]]}})
    assert out["table"]["rows"][0] == ["", "1", "True", "[invalid cell]", "[invalid cell]"]


def test_table_limits():
    block = {
        "type": "table",
        "table": {"header": ["h"] * 51, "rows": [["x" * 2001]]},
    }
    out = one(block)
    assert len(out["table"]["header"]) == 50
    assert len(out["table"]["rows"][0][0]) == 2000
    big = {"type": "table", "table": {"rows": [["a"]] * 201}}
    assert len(one(big)["table"]["rows"]) == 200


def test_table_bools_and_colors():
    out = one(
        {
            "type": "table",
            "table": {
                "rows": [],
                "bordered": False,
                "striped": "true",
                "headerBackgroundColor": "#EEE",
            },
        }
    )
    assert out["table"]["bordered"] is False
    assert out["table"]["striped"] is True
    assert out["table"]["headerBackgroundColor"] == "#eeeeee"
    assert "headerTextColor" not in out["table"]


def test_table_bytes_cap_truncates_rows():
    big = "z" * 2000
    block = {"type": "table", "table": {"header": ["H"], "rows": [[big] for _ in range(200)]}}
    out = one(block)
    assert out["table"]["header"] == ["H"]
    assert len(out["table"]["rows"]) < 200
    assert len(json.dumps(out, ensure_ascii=False)) <= MAX_BLOCK_BYTES


# --------------------------------------------------------------------------- #
# 28b: The per-block byte cap shrinks a block, it never deletes it (B2).
#
# An over-cap block used to be dropped by _enforce_block_cap, so a 131 item
# list or a >256 KiB inline image was accepted by the editor, answered with
# "Saved." and then silently vanished from the page.
# --------------------------------------------------------------------------- #

def _sanitized_blocks(block):
    """The sanitised blocks for one input block (empty when it was dropped)."""
    return sanitize_content(blocks(block))["blocks"]


def test_oversized_list_block_is_not_deleted():
    out = _sanitized_blocks({"type": "list", "items": ["z" * 2000 for _ in range(500)]})
    assert out, "an over-cap list must not be dropped"
    assert out[0]["type"] == "list"
    assert out[0]["items"], "the list must keep (some of) its items"
    assert len(out[0]["items"]) < 500
    assert len(json.dumps(out[0], ensure_ascii=False)) <= MAX_BLOCK_BYTES


def test_oversized_image_block_is_not_deleted():
    out = _sanitized_blocks(
        {"type": "image", "src": "data:image/png;base64," + "A" * 300_000, "alt": "A picture"}
    )
    assert out, "an over-cap image must not be dropped"
    assert out[0]["type"] == "image"
    assert out[0]["alt"] == "A picture"
    # The inline payload is dropped, the block survives with a visible
    # "no source" placeholder.
    assert out[0]["src"] == ""
    assert len(json.dumps(out[0], ensure_ascii=False)) <= MAX_BLOCK_BYTES


def test_oversized_image_block_survives_a_second_save():
    block = {"type": "image", "src": "data:image/png;base64," + "A" * 300_000, "alt": "A picture"}
    once = sanitize_content(blocks(block))
    assert sanitize_content(once) == once


def test_oversized_paragraph_and_unknown_block_not_deleted():
    extras = {f"extra{i}": "y" * 20_000 for i in range(20)}

    paragraph = _sanitized_blocks({"type": "paragraph", "text": "z" * 20_000, **extras})
    assert paragraph, "an over-cap paragraph must not be dropped"
    assert paragraph[0]["type"] == "paragraph"
    assert len(json.dumps(paragraph[0], ensure_ascii=False)) <= MAX_BLOCK_BYTES

    unknown = _sanitized_blocks({"type": "carousel", "body": "z" * 20_000, **extras})
    assert unknown, "an over-cap unknown block must not be dropped"
    assert unknown[0]["type"] == "carousel"
    assert len(json.dumps(unknown[0], ensure_ascii=False)) <= MAX_BLOCK_BYTES


def test_oversized_table_block_is_truncated_not_deleted():
    big = "z" * 2000
    out = _sanitized_blocks(
        {"type": "table", "table": {"header": ["H"], "rows": [[big] for _ in range(200)]}}
    )
    assert out, "an over-cap table must not be dropped"
    assert out[0]["table"]["header"] == ["H"]
    assert 0 < len(out[0]["table"]["rows"]) < 200
    assert len(json.dumps(out[0], ensure_ascii=False)) <= MAX_BLOCK_BYTES


def test_block_cap_never_returns_none():
    """_enforce_block_cap shrinks a block; it never deletes it."""
    from app.services.sanitize import _enforce_block_cap

    for block in (
        {"type": "list", "items": ["z" * 2000 for _ in range(500)]},
        {"type": "image", "src": "data:image/png;base64," + "A" * 300_000, "alt": "pic"},
        {"type": "paragraph", "text": "z" * 300_000},
        {"type": "carousel", "body": "z" * 300_000},
        {"type": "table", "table": {"rows": [["z" * 2000] for _ in range(200)]}},
    ):
        shrunk = _enforce_block_cap(dict(block))
        assert shrunk is not None
        assert shrunk.get("type") == block["type"]
        assert len(json.dumps(shrunk, ensure_ascii=False)) <= MAX_BLOCK_BYTES


# --------------------------------------------------------------------------- #
# 39-42: Unknown blocks and extra keys.
# --------------------------------------------------------------------------- #

def test_unknown_block_preserved():
    out = one(
        {
            "type": "carousel",
            "slides": [{"src": "x"}],
            "layout": {"width": 50},
        }
    )
    assert out["type"] == "carousel"
    assert out["slides"] == [{"src": "x"}]
    assert out["layout"]["width"] == 50


@pytest.mark.parametrize("bad_type", ["Bad Type", "", 123, None])
def test_unknown_block_invalid_type_dropped(bad_type):
    assert sanitize_content(blocks({"type": bad_type}))["blocks"] == []


def test_unknown_block_forbidden_keys():
    out = one(
        {
            "type": "carousel",
            "style": "color:red",
            "className": "x",
            "dangerouslySetInnerHTML": {"__html": "x"},
            "onclick": "alert(1)",
            "keep": "yes",
        }
    )
    assert "style" not in out
    assert "className" not in out
    assert "dangerouslySetInnerHTML" not in out
    assert "onclick" not in out
    assert out["keep"] == "yes"


def test_extra_keys_on_known_block_preserved():
    out = one({"type": "paragraph", "text": "x", "id": "abc", "style": "color:red"})
    assert out["id"] == "abc"
    assert "style" not in out


# --------------------------------------------------------------------------- #
# 43-45: Derived search text.
# --------------------------------------------------------------------------- #

def test_content_text_table():
    value = text(
        {
            "type": "table",
            "table": {"header": ["H1", "H2"], "rows": [["a", "b"], ["c", "d"]]},
        }
    )
    for token in ("H1", "H2", "a", "b", "c", "d"):
        assert token in value


def test_content_text_callout_label():
    assert "Lbl" in text({"type": "callout", "variant": "info", "text": "body", "label": "Lbl"})
    assert "body" in text({"type": "callout", "variant": "info", "text": "body"})


def test_content_text_decorative_fields_excluded():
    value = text(
        {
            "type": "image",
            "src": "/x.jpg",
            "alt": "visible",
            "width": 7654321,
            "height": 1357911,
            "fit": "contain",
            "radius": 246810,
            "layout": {"width": 864209},
        }
    )
    assert "visible" in value
    for decorative in ("7654321", "1357911", "246810", "864209", "contain"):
        assert decorative not in value

    table_value = text(
        {
            "type": "table",
            "table": {
                "header": ["cell"],
                "rows": [["row"]],
                "bordered": True,
                "headerBackgroundColor": "#abc123",
            },
        }
    )
    assert "cell" in table_value and "row" in table_value
    assert "abc123" not in table_value


# --------------------------------------------------------------------------- #
# 46-49: blocks_to_html (export/preview only).
# --------------------------------------------------------------------------- #

def test_blocks_to_html_table():
    html = blocks_to_html(
        {
            "format": "blocks-v1",
            "blocks": [
                {
                    "type": "table",
                    "table": {"header": ["h"], "rows": [["a\nb"]]},
                }
            ],
        }
    )
    assert '<div class="content-table-wrap">' in html
    assert '<table class="content-table content-table--bordered">' in html
    assert "<th>h</th>" in html
    assert "<td>a<br>b</td>" in html


def test_blocks_to_html_callout_label():
    with_label = blocks_to_html(
        {
            "format": "blocks-v1",
            "blocks": [{"type": "callout", "variant": "warn", "text": "t", "label": "Warning"}],
        }
    )
    assert '<strong>Warning</strong>' in with_label
    assert '<p class="callout warn">' in with_label

    legacy = blocks_to_html(
        {
            "format": "blocks-v1",
            "blocks": [{"type": "callout", "variant": "info", "text": "t"}],
        }
    )
    assert legacy == '<p class="callout info">t</p>'


def test_blocks_to_html_image_sizing():
    sized = blocks_to_html(
        {
            "format": "blocks-v1",
            "blocks": [
                {"type": "image", "src": "/x", "alt": "a", "width": 60, "align": "center"}
            ],
        }
    )
    assert 'style="text-align:center"' in sized
    assert "width:60%" in sized

    legacy = blocks_to_html(
        {"format": "blocks-v1", "blocks": [{"type": "image", "src": "/x", "alt": "a"}]}
    )
    assert legacy == '<img src="/x" alt="a">'


def test_blocks_to_html_escapes_xss():
    sanitized = one({"type": "paragraph", "text": "<script>alert(1)</script>"})
    html = blocks_to_html(blocks(sanitized))
    assert "<script" not in html


# --------------------------------------------------------------------------- #
# 50-52: Schema + top-level shape.
# --------------------------------------------------------------------------- #

def test_page_update_flags():
    data = PageUpdate(is_homepage=True).dict(exclude_unset=True)
    assert data["is_homepage"] is True
    assert "featured" not in data
    assert "is_homepage" not in PageUpdate().dict(exclude_unset=True)


def test_page_update_flags_false_explicit():
    data = PageUpdate(is_homepage=False, featured=False).dict(exclude_unset=True)
    assert data["is_homepage"] is False
    assert data["featured"] is False


def test_top_level_shape_unchanged():
    assert sanitize_content(None) == {"format": "blocks-v1", "blocks": []}
    assert sanitize_content("nope") == {"format": "blocks-v1", "blocks": []}

    home = sanitize_content({"format": "home-v1", "fields": {"hero": "Hi"}})
    assert home == {"format": "home-v1", "fields": {"hero": "Hi"}}

    many = {"format": "blocks-v1", "blocks": [{"type": "divider"}] * 2500}
    assert len(sanitize_content(many)["blocks"]) == 2000


def test_dynamic_form_configuration_survives_content_sanitization():
    form = {
        "enabled": True,
        "title": "Contact us",
        "fields": [
            {
                "name": "email",
                "label": "Email",
                "type": "email",
                "required": True,
            },
            {
                "name": "attachment",
                "label": "Attachment",
                "type": "file",
                "accept": [".pdf"],
                "max_size_mb": 5,
            },
        ],
        "review_fields": [
            {
                "name": "remark",
                "label": "Admin remark",
                "type": "textarea",
                "required": True,
            }
        ],
    }

    cleaned = sanitize_content(
        {"format": "blocks-v1", "blocks": [], "form": form}
    )

    assert cleaned["form"] == form
    assert sanitize_content(cleaned) == cleaned


def test_dynamic_form_configuration_survives_homepage_content_sanitization():
    form = {
        "enabled": True,
        "fields": [{"name": "name", "label": "Name", "type": "text"}],
    }

    cleaned = sanitize_content(
        {"format": "home-v1", "fields": {"hero": "Welcome"}, "form": form}
    )

    assert cleaned["form"] == form
