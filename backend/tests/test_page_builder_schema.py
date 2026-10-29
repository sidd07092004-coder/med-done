"""Pure-function tests for the page-builder content core.

This suite covers the backend half of ``work/page-builder/03-prompt.md`` §7 that
does not need a database:

* the eight legacy block shapes and ``home-v1`` are byte-for-byte stable;
* the sanitiser is idempotent over every block type;
* every new block's ranges/enums/fallbacks/caps/drop rules;
* rich text normalisation;
* URL allow-lists;
* columns recursion and byte-cap shrinking;
* unknown-field preservation;
* ``content_text`` extraction.

No database, no network, no running server.
"""
from __future__ import annotations

import json

import pytest

from app.services.content_text import extract_clean_text
from app.services.sanitize import (
    MAX_BLOCK_BYTES,
    MAX_COLUMN_BLOCKS,
    MAX_COLUMNS,
    MAX_DOWNLOAD_BYTES,
    MAX_NESTED_BLOCKS,
    MAX_RICH_SPANS,
    MAX_RICH_TEXT,
    _sanitize_rich,
    safe_href,
    safe_image_url,
    safe_media_url,
    safe_upload_url,
    sanitize_content,
)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def blocks(*items):
    return {"format": "blocks-v1", "blocks": list(items)}


def one(block):
    return sanitize_content(blocks(block))["blocks"][0]


def sanitized(block):
    return sanitize_content(blocks(block))["blocks"]


def text(block):
    return extract_clean_text(blocks(block))


# --------------------------------------------------------------------------- #
# §7: legacy fixtures + home-v1 are unchanged.
# --------------------------------------------------------------------------- #

LEGACY_FIXTURES = [
    {"type": "heading", "level": 2, "text": "Heading"},
    {"type": "paragraph", "text": "Paragraph", "layout": {"textAlign": "center", "width": 60}},
    {"type": "list", "ordered": False, "items": ["one", "two"]},
    {"type": "quote", "text": "Quote", "cite": "Someone"},
    {"type": "callout", "variant": "warn", "text": "Careful", "label": "Warning"},
    {"type": "image", "src": "/uploads/x.jpg", "alt": "A cat"},
    {"type": "divider"},
    {
        "type": "table",
        "table": {"header": ["Symptom", "Common"], "rows": [["Headache", "Yes"]]},
    },
]


@pytest.mark.parametrize("fixture", LEGACY_FIXTURES, ids=lambda f: f["type"])
def test_legacy_fixture_unchanged(fixture):
    assert one(fixture) == fixture


def test_legacy_home_v1_unchanged():
    home = {
        "format": "home-v1",
        "fields": {
            "heroTitle": "Welcome",
            "heroText": "Plain homepage copy",
            "ctaLabel": "Book",
        },
    }
    assert sanitize_content(home) == home


def test_legacy_paragraph_does_not_gain_rich():
    out = one({"type": "paragraph", "text": "Plain"})
    assert out == {"type": "paragraph", "text": "Plain"}
    assert "rich" not in out


def test_legacy_list_does_not_gain_rich_items():
    out = one({"type": "list", "ordered": True, "items": ["a", "b"]})
    assert out == {"type": "list", "ordered": True, "items": ["a", "b"]}
    assert "richItems" not in out


def test_legacy_quote_and_callout_do_not_gain_rich():
    assert "rich" not in one({"type": "quote", "text": "q"})
    assert "rich" not in one({"type": "callout", "text": "c"})


# --------------------------------------------------------------------------- #
# §7: idempotency over a representative corpus (every new block + legacy).
# --------------------------------------------------------------------------- #

NEW_BLOCK_CORPUS = [
    {
        "type": "button",
        "label": "Book now",
        "href": "/book",
        "variant": "primary",
        "size": "lg",
        "align": "center",
        "newTab": True,
    },
    {
        "type": "hero",
        "eyebrow": "Care",
        "title": "Title",
        "subtitle": "Subtitle",
        "imageSrc": "/uploads/h.jpg",
        "imageAlt": "Alt",
        "height": "lg",
        "overlay": 40,
        "align": "center",
        "primaryCta": {"label": "Go", "href": "/go", "newTab": True},
        "secondaryCta": {"label": "More", "href": "https://example.test"},
    },
    {
        "type": "accordion",
        "heading": "FAQ",
        "items": [
            {"question": "Q1", "answer": "A1"},
            {"question": "Q2", "answer": "A2"},
        ],
        "allowMultiple": False,
        "defaultOpen": "all",
    },
    {
        "type": "cards",
        "items": [
            {
                "imageSrc": "/uploads/c.jpg",
                "imageAlt": "Alt",
                "title": "Card",
                "text": "Body",
                "href": "/read",
                "ctaLabel": "Read",
                "newTab": True,
            }
        ],
        "columns": 2,
        "variant": "compact",
        "linkWholeCard": True,
    },
    {
        "type": "steps",
        "heading": "How it works",
        "items": [{"title": "First", "text": "Do this"}],
        "style": "numbered",
    },
    {
        "type": "checklist",
        "title": "Checklist",
        "items": [{"text": "Item", "note": "Note"}],
        "style": "check",
    },
    {
        "type": "download",
        "fileSrc": "/uploads/guide.pdf",
        "label": "Guide",
        "description": "Desc",
        "fileSizeBytes": 1234,
        "newTab": True,
    },
    {
        "type": "toc",
        "title": "On this page",
        "minLevel": 2,
        "maxLevel": 3,
        "maxDepth": 2,
        "sticky": True,
    },
    {
        "type": "references",
        "title": "Refs",
        "items": [
            {
                "text": "Source",
                "url": "https://example.test/a",
                "publisher": "Pub",
                "year": 2020,
            }
        ],
        "numbered": True,
    },
    {
        "type": "video",
        "src": "/uploads/v.mp4",
        "poster": "/uploads/p.jpg",
        "captionsSrc": "/uploads/c.vtt",
        "title": "Watch",
        "autoplay": True,
        "loop": True,
        "muted": True,
        "controls": True,
    },
    {
        "type": "columns",
        "columns": [
            [{"type": "paragraph", "text": "Left"}],
            [{"type": "heading", "level": 2, "text": "Right"}],
        ],
        "ratio": "wide-left",
        "gap": 24,
        "stackAt": "tablet",
    },
    {
        "type": "gallery",
        "images": [{"src": "/uploads/g.jpg", "alt": "Alt", "caption": "Cap"}],
        "display": "carousel",
        "columns": 4,
        "lightbox": True,
        "aspect": "16:9",
    },
    {
        "type": "timeline",
        "items": [{"label": "2020", "title": "Title", "text": "Body"}],
        "style": "cards",
    },
    {
        "type": "stats",
        "items": [{"value": "75%", "label": "Recovery", "source": "Study", "note": "Note"}],
        "variant": "inline",
    },
    {
        "type": "key_facts",
        "title": "Facts",
        "items": [{"label": "Label", "value": "Value"}],
    },
    {
        "type": "audio",
        "src": "/uploads/a.mp3",
        "title": "Listen",
        "transcript": "Transcript",
        "controls": True,
    },
    {
        "type": "testimonial",
        "quote": "Quote",
        "attribution": "Dr X",
        "context": "Patient",
        "consentRef": "CONSENT-1",
        "avatarSrc": "/uploads/a.jpg",
    },
    {
        "type": "map",
        "address": "1 Road",
        "lat": 51.5,
        "lng": -0.1,
        "zoom": 12,
        "label": "Clinic",
        "staticImageSrc": "/uploads/m.jpg",
        "directionsUrl": "/directions",
    },
    {
        "type": "embed",
        "provider": "youtube",
        "url": "https://www.youtube.com/embed/abcdef",
        "title": "Video",
        "consentRequired": False,
    },
]


@pytest.mark.parametrize("block", LEGACY_FIXTURES + NEW_BLOCK_CORPUS, ids=lambda b: b["type"])
def test_sanitize_is_idempotent(block):
    once = sanitize_content(blocks(block))
    assert sanitize_content(once) == once


def test_idempotent_over_the_whole_corpus_at_once():
    payload = blocks(*(LEGACY_FIXTURES + NEW_BLOCK_CORPUS))
    once = sanitize_content(payload)
    assert sanitize_content(once) == once


# --------------------------------------------------------------------------- #
# §2.2 button
# --------------------------------------------------------------------------- #

def test_button_valid_roundtrip():
    block = {
        "type": "button",
        "label": "Book now",
        "href": "/book",
        "variant": "primary",
        "size": "lg",
        "align": "center",
        "newTab": True,
    }
    assert one(block) == block


def test_button_required_label_and_invalid_enums():
    out = one({"type": "button", "variant": "bogus", "size": "xl", "align": "middle"})
    assert out == {"type": "button", "label": ""}


def test_button_invalid_href_omitted_and_label_capped():
    out = one({"type": "button", "label": "x" * 100, "href": "javascript:alert(1)"})
    assert "href" not in out
    assert len(out["label"]) == 80


# --------------------------------------------------------------------------- #
# §2.2 hero
# --------------------------------------------------------------------------- #

def test_hero_valid_roundtrip():
    block = {
        "type": "hero",
        "eyebrow": "Care",
        "title": "Title",
        "subtitle": "Subtitle",
        "imageSrc": "/uploads/h.jpg",
        "imageAlt": "Alt",
        "height": "lg",
        "overlay": 40,
        "align": "center",
        "primaryCta": {"label": "Go", "href": "/go", "newTab": True},
        "secondaryCta": {"label": "More", "href": "https://example.test"},
    }
    assert one(block) == block


def test_hero_title_always_present_and_capped():
    out = one({"type": "hero", "title": "t" * 300})
    assert out["title"] == "t" * 200
    assert one({"type": "hero"})["title"] == ""


def test_hero_overlay_is_clamped():
    assert one({"type": "hero", "title": "T", "overlay": 999})["overlay"] == 80
    assert one({"type": "hero", "title": "T", "overlay": -5})["overlay"] == 0


def test_hero_invalid_enums_omitted():
    out = one({"type": "hero", "title": "T", "height": "xl", "align": "right"})
    assert "height" not in out
    assert "align" not in out


def test_hero_image_requires_non_empty_alt():
    out = one({"type": "hero", "title": "T", "imageSrc": "/x.jpg", "imageAlt": ""})
    assert "imageSrc" not in out and "imageAlt" not in out
    valid = one({"type": "hero", "title": "T", "imageSrc": "/x.jpg", "imageAlt": "Alt"})
    assert valid["imageSrc"] == "/x.jpg" and valid["imageAlt"] == "Alt"


def test_hero_cta_requires_label_and_valid_href():
    out = one(
        {
            "type": "hero",
            "title": "T",
            "primaryCta": {"label": "", "href": "/x"},
            "secondaryCta": {"label": "Go", "href": "javascript:alert(1)"},
        }
    )
    assert "primaryCta" not in out
    assert "secondaryCta" not in out


# --------------------------------------------------------------------------- #
# §2.2 accordion
# --------------------------------------------------------------------------- #

def test_accordion_valid_roundtrip():
    block = {
        "type": "accordion",
        "heading": "FAQ",
        "items": [
            {"question": "Q1", "answer": "A1"},
            {"question": "Q2", "answer": "A2"},
        ],
        "allowMultiple": False,
        "defaultOpen": "all",
    }
    assert one(block) == block


def test_accordion_non_list_items_become_empty_array():
    out = one({"type": "accordion", "items": "nope"})
    assert out["items"] == []
    assert one({"type": "accordion", "items": []})["items"] == []


def test_accordion_drops_empty_items_and_keeps_answer_rich():
    out = one(
        {
            "type": "accordion",
            "items": [
                {"question": "", "answer": ""},
                {"question": "Q", "answer": ""},
                {"question": "", "answer": "", "rich": [{"text": "Rich"}]},
            ],
        }
    )
    assert out["items"] == [
        {"question": "Q", "answer": ""},
        {"question": "", "answer": "Rich", "rich": [{"text": "Rich"}]},
    ]


def test_accordion_item_cap_and_enum():
    items = [{"question": f"Q{i}", "answer": "A"} for i in range(55)]
    out = one({"type": "accordion", "items": items, "defaultOpen": "sometimes"})
    assert len(out["items"]) == 50
    assert "defaultOpen" not in out


# --------------------------------------------------------------------------- #
# §2.2 cards
# --------------------------------------------------------------------------- #

def test_cards_valid_roundtrip():
    block = {
        "type": "cards",
        "items": [
            {
                "imageSrc": "/uploads/c.jpg",
                "imageAlt": "Alt",
                "title": "Card",
                "text": "Body",
                "href": "/read",
                "ctaLabel": "Read",
                "newTab": True,
            }
        ],
        "columns": 2,
        "variant": "compact",
        "linkWholeCard": True,
    }
    assert one(block) == block


def test_cards_item_requires_text_title_or_image():
    out = one(
        {
            "type": "cards",
            "items": [
                {"href": "/only-link"},
                {"title": "Kept"},
            ],
        }
    )
    assert out["items"] == [{"title": "Kept"}]


def test_cards_cta_label_only_with_href_and_invalid_links_dropped():
    out = one(
        {
            "type": "cards",
            "items": [
                {"title": "T", "href": "javascript:alert(1)", "ctaLabel": "Go"},
                {"title": "U", "href": "/ok", "ctaLabel": "Go"},
            ],
        }
    )
    assert out["items"][0] == {"title": "T"}
    assert out["items"][1]["href"] == "/ok"
    assert out["items"][1]["ctaLabel"] == "Go"


def test_cards_columns_clamped_and_item_cap():
    items = [{"title": f"T{i}"} for i in range(15)]
    out = one({"type": "cards", "items": items, "columns": 99, "variant": "bogus"})
    assert len(out["items"]) == 12
    assert out["columns"] == 3
    assert "variant" not in out
    assert one({"type": "cards", "columns": 0})["columns"] == 1


# --------------------------------------------------------------------------- #
# §2.2 steps
# --------------------------------------------------------------------------- #

def test_steps_valid_roundtrip():
    block = {
        "type": "steps",
        "heading": "How it works",
        "items": [{"title": "First", "text": "Do this"}],
        "style": "numbered",
    }
    assert one(block) == block


def test_steps_drops_empty_items_and_caps_at_20():
    items = [{"title": "", "text": ""}, {"title": "Kept"}]
    out = one({"type": "steps", "items": items})
    assert out["items"] == [{"title": "Kept"}]
    many = [{"title": f"T{i}"} for i in range(25)]
    assert len(one({"type": "steps", "items": many})["items"]) == 20


def test_steps_style_enum_and_empty_array_preserved():
    out = one({"type": "steps", "items": [], "style": "fancy"})
    assert out["items"] == []
    assert "style" not in out


# --------------------------------------------------------------------------- #
# §2.2 checklist
# --------------------------------------------------------------------------- #

def test_checklist_valid_roundtrip():
    block = {
        "type": "checklist",
        "title": "Checklist",
        "items": [{"text": "Item", "note": "Note"}],
        "style": "check",
    }
    assert one(block) == block


def test_checklist_item_requires_text_and_caps_at_50():
    out = one(
        {
            "type": "checklist",
            "items": [{"text": "", "note": "orphan"}, {"text": "Kept"}],
        }
    )
    assert out["items"] == [{"text": "Kept"}]
    many = [{"text": f"Item {i}"} for i in range(55)]
    assert len(one({"type": "checklist", "items": many})["items"]) == 50


def test_checklist_field_caps_and_enum():
    out = one(
        {
            "type": "checklist",
            "title": "t" * 300,
            "items": [{"text": "x" * 400, "note": "n" * 300}],
            "style": "bogus",
        }
    )
    assert len(out["title"]) == 200
    assert len(out["items"][0]["text"]) == 300
    assert len(out["items"][0]["note"]) == 200
    assert "style" not in out


# --------------------------------------------------------------------------- #
# §2.2 download
# --------------------------------------------------------------------------- #

def test_download_valid_roundtrip_derives_file_type():
    block = {
        "type": "download",
        "fileSrc": "/uploads/guide.pdf",
        "label": "Guide",
        "description": "Desc",
        "fileSizeBytes": 1234,
        "newTab": True,
    }
    out = one(block)
    assert out == {**block, "fileType": "pdf"}


def test_download_invalid_src_becomes_empty_and_client_type_ignored():
    out = one(
        {
            "type": "download",
            "fileSrc": "https://evil.test/x.pdf",
            "label": "Guide",
            "fileType": "docx",
        }
    )
    assert out["fileSrc"] == ""
    assert out["fileType"] == "other"
    assert out["label"] == "Guide"


@pytest.mark.parametrize(
    "src,expected",
    [
        ("/uploads/a.pdf", "pdf"),
        ("/uploads/a.docx", "docx"),
        ("/uploads/a.png", "image"),
        ("/uploads/a.jpeg", "image"),
        ("/uploads/a.txt", "other"),
    ],
)
def test_download_file_type_derivation(src, expected):
    assert one({"type": "download", "fileSrc": src, "label": "x"})["fileType"] == expected


def test_download_size_clamped():
    assert one({"type": "download", "label": "x", "fileSizeBytes": 10**20})[
        "fileSizeBytes"
    ] == MAX_DOWNLOAD_BYTES
    assert one({"type": "download", "label": "x", "fileSizeBytes": -1})["fileSizeBytes"] == 0


# --------------------------------------------------------------------------- #
# §2.2 toc
# --------------------------------------------------------------------------- #

def test_toc_valid_roundtrip():
    block = {
        "type": "toc",
        "title": "On this page",
        "minLevel": 2,
        "maxLevel": 3,
        "maxDepth": 2,
        "sticky": True,
    }
    assert one(block) == block


def test_toc_swaps_reversed_levels():
    out = one({"type": "toc", "minLevel": 4, "maxLevel": 2})
    assert out["minLevel"] == 2 and out["maxLevel"] == 4


def test_toc_invalid_levels_omitted_and_no_defaults_materialised():
    out = one({"type": "toc", "minLevel": 9, "maxLevel": 0, "maxDepth": 9})
    assert out == {"type": "toc"}


def test_toc_title_capped():
    assert len(one({"type": "toc", "title": "t" * 200})["title"]) == 120


# --------------------------------------------------------------------------- #
# §2.2 references
# --------------------------------------------------------------------------- #

def test_references_valid_roundtrip():
    block = {
        "type": "references",
        "title": "Refs",
        "items": [
            {
                "text": "Source",
                "url": "https://example.test/a",
                "publisher": "Pub",
                "year": 2020,
            }
        ],
        "numbered": True,
    }
    assert one(block) == block


def test_references_keeps_text_with_invalid_url():
    out = one(
        {
            "type": "references",
            "items": [
                {"text": "Kept", "url": "javascript:alert(1)"},
                {"text": "", "url": "/orphan"},
            ],
        }
    )
    assert out["items"] == [{"text": "Kept"}]


@pytest.mark.parametrize("year", [1799, 2101, "abc"])
def test_references_out_of_range_year_omitted(year):
    out = one({"type": "references", "items": [{"text": "x", "year": year}]})
    assert "year" not in out["items"][0]


def test_references_cap_at_100():
    items = [{"text": f"Ref {i}"} for i in range(105)]
    assert len(one({"type": "references", "items": items})["items"]) == 100


# --------------------------------------------------------------------------- #
# §2.2 video
# --------------------------------------------------------------------------- #

def test_video_valid_roundtrip_and_controls_forced_true():
    block = {
        "type": "video",
        "src": "/uploads/v.mp4",
        "poster": "/uploads/p.jpg",
        "captionsSrc": "/uploads/c.vtt",
        "title": "Watch",
        "autoplay": True,
        "loop": True,
        "muted": True,
        "controls": True,
    }
    assert one(block) == block
    assert one({**block, "controls": False})["controls"] is True


def test_video_autoplay_forces_muted():
    out = one({"type": "video", "src": "/v.mp4", "autoplay": True, "muted": False})
    assert out["autoplay"] is True
    assert out["muted"] is True


def test_video_invalid_urls_omitted():
    out = one(
        {
            "type": "video",
            "src": "javascript:alert(1)",
            "poster": "ftp://evil/x.jpg",
            "captionsSrc": "/uploads/c.srt",
        }
    )
    assert out["src"] == ""
    assert "poster" not in out
    assert "captionsSrc" not in out


def test_video_title_capped():
    assert len(one({"type": "video", "src": "/v.mp4", "title": "t" * 300})["title"]) == 200


# --------------------------------------------------------------------------- #
# §2.2 columns
# --------------------------------------------------------------------------- #

def test_columns_non_list_becomes_two_empty_columns():
    assert one({"type": "columns", "columns": "nope"})["columns"] == [[], []]


def test_columns_pad_and_truncate_to_maximum():
    # One column should be padded to two.
    one_column = one({
        "type": "columns",
        "columns": [[{"type": "paragraph", "text": "Only"}]],
    })["columns"]

    assert len(one_column) == 2

    # Eight columns should be preserved.
    eight = [
        [{"type": "paragraph", "text": str(i)}]
        for i in range(8)
    ]
    assert len(
        one({"type": "columns", "columns": eight})["columns"]
    ) == 8

    # Ten columns should be preserved.
    ten = [
        [{"type": "paragraph", "text": str(i)}]
        for i in range(10)
    ]
    assert len(
        one({"type": "columns", "columns": ten})["columns"]
    ) == 10

    # Eleven columns should be truncated to ten.
    eleven = [
        [{"type": "paragraph", "text": str(i)}]
        for i in range(11)
    ]
    assert len(
        one({"type": "columns", "columns": eleven})["columns"]
    ) == MAX_COLUMNS


def test_columns_per_column_and_total_caps():
    raw = [[{"type": "paragraph", "text": f"{c}-{i}"} for i in range(25)] for c in range(3)]
    columns = one({"type": "columns", "columns": raw})["columns"]
    assert [len(column) for column in columns] == [
        MAX_COLUMN_BLOCKS,
        MAX_COLUMN_BLOCKS,
        MAX_COLUMN_BLOCKS,
    ]
    assert sum(len(column) for column in columns) == MAX_NESTED_BLOCKS


def test_columns_nested_columns_are_dropped_but_siblings_survive():
    out = one(
        {
            "type": "columns",
            "columns": [
                [
                    {"type": "columns", "columns": [[], []]},
                    {"type": "paragraph", "text": "Keep"},
                ],
                [],
            ],
        }
    )
    assert out["columns"][0] == [{"type": "paragraph", "text": "Keep"}]


def test_columns_enum_and_range_clamping():
    out = one(
        {
            "type": "columns",
            "columns": [[], []],
            "ratio": "wide-right",
            "gap": 999,
            "stackAt": "tablet",
        }
    )
    assert out["ratio"] == "wide-right"
    assert out["gap"] == 64
    assert out["stackAt"] == "tablet"
    invalid = one({"type": "columns", "columns": [[], []], "ratio": "sideways", "stackAt": "desktop"})
    assert "ratio" not in invalid and "stackAt" not in invalid


def test_columns_over_cap_shrinks_and_keeps_the_block():
    big = {
        "type": "columns",
        "columns": [
            [{"type": "paragraph", "text": "z" * 20_000} for _ in range(20)]
            for _ in range(3)
        ],
    }
    out = sanitized(big)
    assert out, "an over-cap columns block must not be deleted"
    assert out[0]["type"] == "columns"
    assert len(json.dumps(out[0], ensure_ascii=False)) <= MAX_BLOCK_BYTES
    total = sum(len(column) for column in out[0]["columns"])
    assert 0 < total < MAX_NESTED_BLOCKS
    assert sanitize_content(blocks(out[0])) == blocks(out[0])


# --------------------------------------------------------------------------- #
# §2.2 gallery
# --------------------------------------------------------------------------- #

def test_gallery_valid_roundtrip():
    block = {
        "type": "gallery",
        "images": [{"src": "/uploads/g.jpg", "alt": "Alt", "caption": "Cap"}],
        "display": "carousel",
        "columns": 4,
        "lightbox": True,
        "aspect": "16:9",
    }
    assert one(block) == block


def test_gallery_invalid_src_dropped_and_caps():
    out = one(
        {
            "type": "gallery",
            "images": [
                {"src": "javascript:alert(1)", "alt": "bad"},
                {"src": "/ok.jpg", "alt": "good"},
            ],
        }
    )
    assert out["images"] == [{"src": "/ok.jpg", "alt": "good"}]

    many = [{"src": f"/uploads/{i}.jpg", "alt": f"A{i}"} for i in range(30)]
    assert len(one({"type": "gallery", "images": many})["images"]) == 24


def test_gallery_columns_clamped_and_enums():
    assert one({"type": "gallery", "columns": 1})["columns"] == 2
    assert one({"type": "gallery", "columns": 9})["columns"] == 4
    out = one({"type": "gallery", "display": "mosaic", "aspect": "1:1"})
    assert "display" not in out and "aspect" not in out


# --------------------------------------------------------------------------- #
# §2.2 timeline
# --------------------------------------------------------------------------- #

def test_timeline_valid_roundtrip():
    block = {
        "type": "timeline",
        "items": [{"label": "2020", "title": "Title", "text": "Body"}],
        "style": "cards",
    }
    assert one(block) == block


def test_timeline_drops_empty_items_and_caps_at_20():
    out = one(
        {
            "type": "timeline",
            "items": [{"label": "", "title": "", "text": ""}, {"title": "Kept"}],
        }
    )
    assert out["items"] == [{"title": "Kept"}]
    many = [{"title": f"T{i}"} for i in range(25)]
    assert len(one({"type": "timeline", "items": many})["items"]) == 20


# --------------------------------------------------------------------------- #
# §2.2 stats
# --------------------------------------------------------------------------- #

def test_stats_valid_roundtrip():
    block = {
        "type": "stats",
        "items": [{"value": "75%", "label": "Recovery", "source": "Study", "note": "Note"}],
        "variant": "inline",
    }
    assert one(block) == block


def test_stats_empty_source_preserved_and_empty_items_dropped():
    out = one(
        {
            "type": "stats",
            "items": [
                {"value": "1", "label": "L", "source": ""},
                {"value": "", "label": "", "source": "", "note": ""},
            ],
        }
    )
    assert out["items"] == [{"value": "1", "label": "L", "source": ""}]


def test_stats_cap_at_6_and_variant_enum():
    many = [{"value": str(i), "label": "L", "source": "S"} for i in range(9)]
    out = one({"type": "stats", "items": many, "variant": "bogus"})
    assert len(out["items"]) == 6
    assert "variant" not in out


# --------------------------------------------------------------------------- #
# §2.2 key_facts
# --------------------------------------------------------------------------- #

def test_key_facts_valid_roundtrip():
    block = {
        "type": "key_facts",
        "title": "Facts",
        "items": [{"label": "Label", "value": "Value"}],
    }
    assert one(block) == block


def test_key_facts_drops_empty_items_and_caps_at_10():
    out = one(
        {
            "type": "key_facts",
            "items": [{"label": "", "value": ""}, {"label": "", "value": "Kept"}],
        }
    )
    assert out["items"] == [{"label": "", "value": "Kept"}]
    many = [{"label": f"L{i}", "value": f"V{i}"} for i in range(15)]
    assert len(one({"type": "key_facts", "items": many})["items"]) == 10


# --------------------------------------------------------------------------- #
# §2.2 audio
# --------------------------------------------------------------------------- #

def test_audio_valid_roundtrip_and_transcript_always_present():
    block = {
        "type": "audio",
        "src": "/uploads/a.mp3",
        "title": "Listen",
        "transcript": "Text",
        "controls": True,
    }
    assert one(block) == block
    assert one({"type": "audio"}) == {
        "type": "audio",
        "src": "",
        "transcript": "",
        "controls": True,
    }


def test_audio_invalid_src_controls_forced_and_title_capped():
    out = one(
        {
            "type": "audio",
            "src": "javascript:alert(1)",
            "title": "t" * 300,
            "transcript": "x",
            "controls": False,
        }
    )
    assert out["src"] == ""
    assert out["controls"] is True
    assert len(out["title"]) == 200


# --------------------------------------------------------------------------- #
# §2.2 testimonial
# --------------------------------------------------------------------------- #

def test_testimonial_valid_roundtrip():
    block = {
        "type": "testimonial",
        "quote": "Quote",
        "attribution": "Dr X",
        "context": "Patient",
        "consentRef": "CONSENT-1",
        "avatarSrc": "/uploads/a.jpg",
    }
    assert one(block) == block


def test_testimonial_required_fields_always_present():
    out = one({"type": "testimonial"})
    assert out == {
        "type": "testimonial",
        "quote": "",
        "attribution": "",
        "consentRef": "",
    }


def test_testimonial_invalid_avatar_omitted_and_caps():
    out = one(
        {
            "type": "testimonial",
            "quote": "q" * 1200,
            "attribution": "a" * 200,
            "context": "c" * 300,
            "consentRef": "r" * 200,
            "avatarSrc": "data:image/svg+xml;base64,x",
        }
    )
    assert len(out["quote"]) == 1000
    assert len(out["attribution"]) == 120
    assert len(out["context"]) == 200
    assert len(out["consentRef"]) == 120
    assert "avatarSrc" not in out


# --------------------------------------------------------------------------- #
# §2.2 map
# --------------------------------------------------------------------------- #

def test_map_valid_roundtrip():
    block = {
        "type": "map",
        "address": "1 Road",
        "lat": 51.5,
        "lng": -0.1,
        "zoom": 12,
        "label": "Clinic",
        "staticImageSrc": "/uploads/m.jpg",
        "directionsUrl": "/directions",
    }
    assert one(block) == block


def test_map_address_always_present_and_numbers_clamped():
    out = one({"type": "map", "lat": 999, "lng": -999, "zoom": 99})
    assert out["address"] == ""
    assert out["lat"] == 90
    assert out["lng"] == -180
    assert out["zoom"] == 20


def test_map_invalid_numbers_and_directions_omitted():
    out = one(
        {
            "type": "map",
            "address": "A",
            "lat": "north",
            "lng": float("nan"),
            "directionsUrl": "javascript:alert(1)",
        }
    )
    assert "lat" not in out and "lng" not in out
    assert "directionsUrl" not in out


# --------------------------------------------------------------------------- #
# §2.2 embed
# --------------------------------------------------------------------------- #

def test_embed_valid_roundtrip():
    block = {
        "type": "embed",
        "provider": "youtube",
        "url": "https://www.youtube.com/embed/abcdef",
        "title": "Video",
        "consentRequired": False,
    }
    assert one(block) == block


def test_embed_invalid_provider_defaults_to_youtube():
    out = one({"type": "embed", "provider": "tiktok", "url": "https://www.youtube.com/embed/abcdef"})
    assert out["provider"] == "youtube"
    assert out["url"] == "https://www.youtube.com/embed/abcdef"


@pytest.mark.parametrize(
    "provider,url,accepted",
    [
        ("youtube", "https://www.youtube.com/embed/abc123", True),
        ("youtube", "https://www.youtube-nocookie.com/embed/abc123", True),
        ("youtube", "http://www.youtube.com/embed/abc123", False),
        ("youtube", "https://youtu.be/abc123", False),
        ("vimeo", "https://player.vimeo.com/video/12345", True),
        ("vimeo", "https://vimeo.com/12345", False),
        ("spotify", "https://open.spotify.com/embed/track/abc123", True),
        ("spotify", "https://open.spotify.com/embed/movie/abc123", False),
        ("google_maps", "https://www.google.com/maps/embed?pb=foo", True),
        ("google_maps", "https://maps.google.com/maps/embed?pb=foo", False),
    ],
)
def test_embed_provider_url_allow_list(provider, url, accepted):
    out = one({"type": "embed", "provider": provider, "url": url})
    assert out["url"] == (url if accepted else "")


def test_embed_non_matching_url_becomes_empty_but_block_survives():
    out = one({"type": "embed", "provider": "vimeo", "url": "javascript:alert(1)"})
    assert out == {"type": "embed", "provider": "vimeo", "url": ""}


# --------------------------------------------------------------------------- #
# §2.3 rich text
# --------------------------------------------------------------------------- #

def test_rich_marks_filtered_deduplicated_and_ordered():
    out = one(
        {
            "type": "paragraph",
            "text": "ignored",
            "rich": [
                {
                    "text": "A",
                    "marks": ["subscript", "italic", "bold", "BOLD", "bogus", "bold"],
                }
            ],
        }
    )
    assert out["rich"][0]["marks"] == ["bold", "italic", "subscript"]
    assert out["text"] == "A"


def test_rich_invalid_link_drops_link_but_keeps_text():
    out = one(
        {
            "type": "paragraph",
            "text": "fallback",
            "rich": [{"text": "Text", "link": {"href": "javascript:alert(1)"}}],
        }
    )
    assert out["rich"] == [{"text": "Text"}]
    assert out["text"] == "Text"


def test_rich_projection_replaces_plain_text_without_spaces():
    out = one(
        {
            "type": "paragraph",
            "text": "old",
            "rich": [{"text": "A"}, {"text": "B"}, {"text": "C"}],
        }
    )
    assert out["text"] == "ABC"
    assert out["rich"] == [{"text": "A"}, {"text": "B"}, {"text": "C"}]


def test_rich_invalid_span_falls_back_to_plain_text():
    out = one(
        {
            "type": "paragraph",
            "text": "keep me",
            "rich": [{"text": ""}, "not a dict", {"text": None}],
        }
    )
    assert out == {"type": "paragraph", "text": "keep me"}


def test_rich_span_cap_500():
    rich = [{"text": "x"} for _ in range(600)]
    assert len(_sanitize_rich(rich)) == MAX_RICH_SPANS
    out = one({"type": "paragraph", "text": "", "rich": rich})
    assert len(out["rich"]) == MAX_RICH_SPANS


def test_rich_char_cap_20000():
    rich = [{"text": "a" * 5000} for _ in range(6)]
    result = _sanitize_rich(rich)
    assert sum(len(span["text"]) for span in result) == MAX_RICH_TEXT
    assert len(result) == 4


def test_rich_is_idempotent():
    block = {
        "type": "paragraph",
        "text": "fallback",
        "rich": [
            {"text": "A", "marks": ["italic", "bold"]},
            {"text": "B", "link": {"href": "/ok", "newTab": True}},
        ],
    }
    once = one(block)
    assert one(once) == once


def test_list_rich_items_override_and_align_items():
    out = one(
        {
            "type": "list",
            "ordered": True,
            "items": ["plain", "second"],
            "richItems": [[{"text": "Rich", "marks": ["bold"]}], []],
        }
    )
    assert out["items"] == ["Rich", "second"]
    assert out["richItems"] == [[{"text": "Rich", "marks": ["bold"]}], []]
    assert one(out) == out


def test_accordion_rich_overrides_answer_text():
    out = one(
        {
            "type": "accordion",
            "items": [
                {
                    "question": "Q",
                    "answer": "plain",
                    "rich": [{"text": "Rich "}, {"text": "answer"}],
                }
            ],
        }
    )
    assert out["items"][0]["answer"] == "Rich answer"
    assert out["items"][0]["rich"] == [{"text": "Rich "}, {"text": "answer"}]


def test_rich_link_stores_real_bool_new_tab_only():
    out = one(
        {
            "type": "paragraph",
            "rich": [
                {"text": "A", "link": {"href": "/ok", "newTab": "true"}},
                {"text": "B", "link": {"href": "/ok", "newTab": True}},
            ],
        }
    )
    assert out["rich"][0]["link"] == {"href": "/ok"}
    assert out["rich"][1]["link"] == {"href": "/ok", "newTab": True}


@pytest.mark.parametrize(
    "href", ["javascript:alert(1)", "data:text/html,x", "//evil.test/x"]
)
def test_rich_rejects_unsafe_links(href):
    out = one(
        {
            "type": "paragraph",
            "text": "x",
            "rich": [{"text": "safe", "link": {"href": href}}],
        }
    )
    assert out["rich"] == [{"text": "safe"}]


# --------------------------------------------------------------------------- #
# §2.1 URL helpers
# --------------------------------------------------------------------------- #

UNSAFE_URLS = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java%73cript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "data:image/svg+xml;base64,AAAA",
    "blob:https://evil.test/x",
    "file:///etc/passwd",
    "ftp://evil.test/x",
    "vbscript:msgbox(1)",
    "//evil.test/x",
    "/\\evil.test/x",
    "",
]


@pytest.mark.parametrize("url", UNSAFE_URLS)
def test_safe_href_rejects_unsafe_urls(url):
    assert safe_href(url) == ""


@pytest.mark.parametrize(
    "url", ["https://example.test/x", "/path", "mailto:a@b.test", "tel:+123456"]
)
def test_safe_href_accepts_page_links(url):
    assert safe_href(url) == url


@pytest.mark.parametrize("url", UNSAFE_URLS)
def test_safe_media_url_rejects_unsafe_urls(url):
    assert safe_media_url(url) == ""


@pytest.mark.parametrize("url", ["https://example.test/v.mp4", "/uploads/v.mp4", "/path"])
def test_safe_media_url_accepts_media(url):
    assert safe_media_url(url) == url


@pytest.mark.parametrize("url", ["mailto:a@b.test", "tel:+1"])
def test_safe_media_url_rejects_page_only_schemes(url):
    assert safe_media_url(url) == ""


@pytest.mark.parametrize("url", UNSAFE_URLS)
def test_safe_image_url_rejects_unsafe_urls(url):
    assert safe_image_url(url) == ""


@pytest.mark.parametrize(
    "url",
    [
        "https://example.test/x.png",
        "/uploads/x.png",
        "data:image/png;base64,AAAA",
        "data:image/jpeg;base64,AAAA",
        "data:image/gif;base64,AAAA",
        "data:image/webp;base64,AAAA",
    ],
)
def test_safe_image_url_accepts_safe_images(url):
    assert safe_image_url(url) == url


def test_safe_image_url_rejects_oversized_data_uri():
    assert safe_image_url("data:image/png;base64," + "A" * 8_000_001) == ""


@pytest.mark.parametrize(
    "url", ["/uploads/x.pdf", "/uploads/nested/x.docx", "/uploads/v.mp4?download=1"]
)
def test_safe_upload_url_accepts_uploads(url):
    assert safe_upload_url(url) == url


@pytest.mark.parametrize(
    "url",
    ["https://example.test/x.pdf", "/x.pdf", "//evil/uploads/x.pdf", "uploads/x.pdf", ""],
)
def test_safe_upload_url_rejects_non_uploads(url):
    assert safe_upload_url(url) == ""


# --------------------------------------------------------------------------- #
# §2.5 Unknown fields / unknown blocks.
# --------------------------------------------------------------------------- #

def test_new_block_extra_keys_preserved_and_denied_removed():
    out = one(
        {
            "type": "button",
            "label": "Go",
            "id": "abc",
            "keep": {"nested": "yes"},
            "style": "color:red",
            "className": "x",
            "dangerouslySetInnerHTML": {"__html": "<script>x</script>"},
            "onclick": "alert(1)",
        }
    )
    assert out["id"] == "abc"
    assert out["keep"] == {"nested": "yes"}
    for denied in ("style", "className", "dangerouslySetInnerHTML", "onclick"):
        assert denied not in out


def test_unknown_block_placeholder_data_preserved():
    out = one(
        {
            "type": "carousel",
            "title": "Future block",
            "slides": [{"src": "/x.jpg"}],
            "layout": {"width": 50},
        }
    )
    assert out == {
        "type": "carousel",
        "title": "Future block",
        "slides": [{"src": "/x.jpg"}],
        "layout": {"width": 50},
    }


def test_unknown_block_deep_denied_keys_removed():
    out = one(
        {
            "type": "carousel",
            "nested": {"__proto__": {"x": 1}, "onload": "x", "keep": "yes"},
        }
    )
    assert out["nested"] == {"keep": "yes"}


# --------------------------------------------------------------------------- #
# §3 content_text extraction
# --------------------------------------------------------------------------- #

CONTENT_TEXT_CASES = [
    (
        {"type": "button", "label": "Button label", "href": "/secret-href"},
        ["Button label"],
        ["secret-href"],
    ),
    (
        {
            "type": "hero",
            "eyebrow": "Eyebrow",
            "title": "Hero title",
            "subtitle": "Hero subtitle",
            "primaryCta": {"label": "Primary CTA", "href": "/secret-primary"},
            "secondaryCta": {"label": "Secondary CTA", "href": "/secret-secondary"},
        },
        ["Eyebrow", "Hero title", "Hero subtitle", "Primary CTA", "Secondary CTA"],
        ["secret-primary", "secret-secondary"],
    ),
    (
        {
            "type": "accordion",
            "heading": "Accordion heading",
            "items": [{"question": "Question", "answer": "Answer"}],
        },
        ["Accordion heading", "Question", "Answer"],
        [],
    ),
    (
        {
            "type": "cards",
            "items": [
                {
                    "title": "Card title",
                    "text": "Card text",
                    "ctaLabel": "Card CTA",
                    "href": "/secret-card",
                }
            ],
        },
        ["Card title", "Card text", "Card CTA"],
        ["secret-card"],
    ),
    (
        {
            "type": "steps",
            "heading": "Steps heading",
            "items": [{"title": "Step title", "text": "Step text"}],
        },
        ["Steps heading", "Step title", "Step text"],
        [],
    ),
    (
        {
            "type": "checklist",
            "title": "Checklist title",
            "items": [{"text": "Checklist text", "note": "Checklist note"}],
        },
        ["Checklist title", "Checklist text", "Checklist note"],
        [],
    ),
    (
        {
            "type": "download",
            "fileSrc": "/uploads/secret-file.pdf",
            "label": "Download label",
            "description": "Download description",
            "fileType": "pdf",
            "fileSizeBytes": 123456789,
        },
        ["Download label", "Download description"],
        ["secret-file", "123456789", "pdf"],
    ),
    (
        {"type": "toc", "title": "TOC title", "minLevel": 2, "maxDepth": 3},
        ["TOC title"],
        ["2", "3"],
    ),
    (
        {
            "type": "references",
            "title": "References title",
            "items": [
                {
                    "text": "Reference text",
                    "publisher": "Publisher",
                    "year": 2024,
                    "url": "/secret-ref-url",
                }
            ],
        },
        ["References title", "Reference text", "Publisher", "2024"],
        ["secret-ref-url"],
    ),
    (
        {
            "type": "video",
            "src": "/uploads/secret-video.mp4",
            "poster": "/uploads/secret-poster.jpg",
            "captionsSrc": "/uploads/secret.vtt",
            "title": "Video title",
        },
        ["Video title"],
        ["secret-video", "secret-poster", "secret.vtt"],
    ),
    (
        {
            "type": "gallery",
            "images": [
                {
                    "src": "/uploads/secret-gallery.jpg",
                    "alt": "Gallery alt",
                    "caption": "Gallery caption",
                }
            ],
        },
        ["Gallery alt", "Gallery caption"],
        ["secret-gallery"],
    ),
    (
        {
            "type": "timeline",
            "items": [{"label": "Timeline label", "title": "Timeline title", "text": "Timeline text"}],
        },
        ["Timeline label", "Timeline title", "Timeline text"],
        [],
    ),
    (
        {
            "type": "stats",
            "items": [
                {
                    "value": "Stat value",
                    "label": "Stat label",
                    "source": "Stat source",
                    "note": "Stat note",
                }
            ],
        },
        ["Stat value", "Stat label", "Stat source", "Stat note"],
        [],
    ),
    (
        {
            "type": "key_facts",
            "title": "Key facts title",
            "items": [{"label": "Fact label", "value": "Fact value"}],
        },
        ["Key facts title", "Fact label", "Fact value"],
        [],
    ),
    (
        {
            "type": "audio",
            "src": "/uploads/secret-audio.mp3",
            "title": "Audio title",
            "transcript": "Audio transcript",
        },
        ["Audio title", "Audio transcript"],
        ["secret-audio"],
    ),
    (
        {
            "type": "testimonial",
            "quote": "Testimonial quote",
            "attribution": "Testimonial attribution",
            "context": "Testimonial context",
            "consentRef": "SECRET-CONSENT-REF",
            "avatarSrc": "/uploads/secret-avatar.jpg",
        },
        ["Testimonial quote", "Testimonial attribution", "Testimonial context"],
        ["SECRET-CONSENT-REF", "secret-avatar"],
    ),
    (
        {
            "type": "map",
            "address": "Map address",
            "label": "Map label",
            "lat": 51.5,
            "lng": -0.1,
            "zoom": 12,
            "staticImageSrc": "/uploads/secret-map.jpg",
            "directionsUrl": "/secret-directions",
        },
        ["Map address", "Map label"],
        ["51.5", "0.1", "12", "secret-map", "secret-directions"],
    ),
    (
        {
            "type": "embed",
            "provider": "youtube",
            "url": "https://www.youtube.com/embed/secretid",
            "title": "Embed title",
        },
        ["Embed title", "youtube"],
        ["secretid"],
    ),
]


@pytest.mark.parametrize(
    "block,present,absent", CONTENT_TEXT_CASES, ids=lambda value: value["type"] if isinstance(value, dict) else ""
)
def test_content_text_per_block(block, present, absent):
    value = text(block)
    for token in present:
        assert token in value
    for token in absent:
        assert token not in value


def test_content_text_table_cells_in_reading_order():
    value = text(
        {
            "type": "table",
            "table": {"header": ["Header one", "Header two"], "rows": [["Cell a", "Cell b"]]},
        }
    )
    assert value == "Header one Header two Cell a Cell b"


def test_content_text_image_alt_only():
    value = text({"type": "image", "src": "/uploads/secret-image.jpg", "alt": "Image alt"})
    assert value == "Image alt"
    assert "secret-image" not in value


def test_content_text_columns_recurse_in_reading_order():
    value = text(
        {
            "type": "columns",
            "columns": [
                [{"type": "paragraph", "text": "First column"}],
                [
                    {"type": "heading", "level": 2, "text": "Second column"},
                    {"type": "paragraph", "text": "Last"},
                ],
            ],
        }
    )
    assert value == "First column Second column Last"


def test_content_text_unknown_block_contributes_nothing():
    assert text({"type": "carousel", "title": "Hidden", "text": "Hidden too"}) == ""


def test_content_text_testimonial_never_includes_consent_ref():
    value = text(
        {
            "type": "testimonial",
            "quote": "Visible quote",
            "attribution": "Visible attribution",
            "consentRef": "CONSENT-DO-NOT-PUBLISH",
        }
    )
    assert "Visible quote" in value
    assert "CONSENT-DO-NOT-PUBLISH" not in value


def test_content_text_gallery_src_never_included():
    value = text(
        {
            "type": "gallery",
            "images": [
                {
                    "src": "/uploads/DO-NOT-PUBLISH.jpg",
                    "alt": "Visible alt",
                    "caption": "Visible caption",
                }
            ],
        }
    )
    assert "Visible alt" in value and "Visible caption" in value
    assert "DO-NOT-PUBLISH" not in value
