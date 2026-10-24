# Requirements — Free-form responsive page designer (layout / image / table / callout)

**Status**: Draft for build
**Author**: Alex (Product Manager)
**Date**: 2026-10-22
**Upstream**: `work/page-designer/01-triage.md` (root cause confirmed there)
**Owners**: Backend specialist (schema + sanitiser), Frontend specialist (admin SPA), Site specialist (public SPA), Validation specialist

> **How to read this document.** Section B is the **contract**. Backend, `frontend/` and `site/`
> implement it *literally*. If a specialist finds an ambiguity, they must not invent one — they
> must raise it. Every field name below is final.

---

## 0. Executive summary

| User's request | Where it is answered | Status |
|---|---|---|
| Per-element text alignment, image size, element positions, responsive | §B.2 (layout model), §B.5 (image model) | In scope, pragmatic flow model |
| Support the developer's **table** block type | §B.6 (table model) | In scope — **must be built** (no branch contains it) |
| Support the developer's callout colour/design options | §B.7 (callout model) | In scope (backend currently destroys them) |
| Backend must persist and return all of it | §B, §C.1 | In scope — **the actual root cause** |
| Do not remove any existing feature | §D, §E.6 | Regression guard |
| Improve frontend **and** backend | §C.2, §C.3, §C.4 | In scope |
| (Also) repair the homepage regression from the `main` pull | §C.5 | In scope |

**The one-line problem:** `backend/app/services/sanitize.py::_sanitize_block()` rebuilds every
block from a fixed allow-list of keys, so every field the developer authors (callout colours,
shape, label, the whole `table` block, and any layout) is silently deleted on save — and the
public site then faithfully renders the stripped content.

---

## A. Problem statement

`backend/app/services/sanitize.py` rebuilds every content block from a hard-coded allow-list of
keys (`_sanitize_block()`, `BLOCK_TYPES` at line 33), so any key the admin frontend sends that is
not explicitly re-emitted is dropped the moment the page is saved: the developer's callout
`label`/`backgroundColor`/`textColor`/`borderColor`/`shape` are wiped, a `table` block is dropped
outright (it is not in `BLOCK_TYPES`), and any future per-element styling field would be wiped
too. The admin SPA already renders callout colours and shapes correctly
(`frontend/src/components/BlockRenderer.tsx`, `CALLOUT_SHAPE_STYLES`) — the data is destroyed in
transit to PostgreSQL, so what an editor sees in the preview is not what is stored, and the
public site (`site/`, which is variant-only and has never supported the design fields) renders
the stripped result. On top of that, the `main` pull reverted three homepage fixes
(`PageUpdate.is_homepage`/`featured`, "unset other homepages in the same language", and the
non-deterministic `GET /api/v1/homepage`), so `GET /api/v1/homepage` can now 500 with
`MultipleResultsFound`.

**Cost of not fixing it:** every minute spent designing in the admin panel is thrown away on
save; content authors lose trust in the tool and fall back to editing JSON by hand; the public
site can never be brought to parity with the admin panel without a content rewrite.

---

## B. The shared content schema — THE CONTRACT

### B.0 Design rules that apply to every block

1. **Additive only.** Every new field is optional. A block that carries no new field must
   serialise, store and render **exactly** as it does today.
2. **Absent ≠ zero.** A missing optional key means *"no override — keep the stylesheet/theme
   value"*. It does **not** mean "use 0". This is what makes 2 099 already-seeded pages (seeded by
   `backend/scripts/import_proto.py`) render unchanged.
3. **The backend never materialises defaults into storage.** The sanitiser *validates and keeps*;
   it does not rewrite the shape of a block. The only fields the sanitiser still writes
   unconditionally are the ones it already writes today (`heading.level`, `heading.text`,
   `paragraph.text`, `list.ordered`, `list.items`, `quote.text`, `callout.variant`,
   `callout.text`, `image.src`, `image.alt`).
4. **Unknown keys are preserved, not deleted.** A known block type carrying an extra key keeps it
   (deep-sanitised). This is the fix for the root cause: the schema must be *forward-compatible*,
   so a newer client talking to this server does not lose data.
5. **All styling is expressed as validated primitives** (numbers, enums, hex colours). No raw CSS
   strings, no `class` names supplied by authors, no `<style>` blocks — ever.

### B.1 Top-level content

Unchanged. Two content formats exist and both keep working:

```jsonc
{ "format": "blocks-v1", "blocks": [ /* … */ ] }
{ "format": "home-v1",   "fields": { "heroBtTitle": "…", /* … */ } }
```

- `blocks-v1` gains the block types and fields defined below.
- `home-v1` is **unchanged**. `layout`, `table`, `image` sizing and callout design do **not** apply
  to homepage fields in this release (the homepage template is fixed). Homepage pages may still
  carry `blocks-v1` content if an author chooses; both formats are rendered as today.

### B.2 The per-block `layout` model

**Decision: layout lives in a nested `layout` object on every block, not in flat keys.**
*Justification:* a single nested namespace gives one allow-list, one validator and one
`layoutToCss()` helper shared by all eight block types and both frontends, it keeps the block's
top level reserved for `type` + type-specific payload, and it is **100 % backwards compatible**
because the 2 099 seeded pages have no `layout` key at all — `block.layout === undefined` renders
byte-identically.

```jsonc
{
  "type": "paragraph",
  "text": "…",
  "layout": {                       // OPTIONAL — omit the whole object for "no override"
    "textAlign": "center",          // "left" | "center" | "right" | "justify"
    "width": 70,                    // % of the column, 0–100
    "offsetX": 0,                   // % of the column, -100–100 (horizontal position)
    "marginTop": 12,                // px, 0–200
    "marginBottom": 8,              // px, 0–200
    "backgroundColor": "#f7f7f8",   // hex colour
    "borderColor": "#d0d7de",       // hex colour
    "borderWidth": 1,               // px, 0–8
    "borderStyle": "solid",         // "none" | "solid" | "dashed" | "dotted"
    "borderRadius": 8,              // px, 0–64
    "padding": 16                   // px, 0–64
  }
}
```

**All eleven `layout` keys are optional.** Rules:

| Key | Type | Range / enum | Meaning when absent |
|---|---|---|---|
| `textAlign` | string | `left` \| `center` \| `right` \| `justify` | stylesheet default (left) |
| `width` | number | 0–100 (% of column) | 100 % (full column) |
| `offsetX` | number | -100–100 (% of column) | 0 (no shift) |
| `marginTop` | number | 0–200 (px) | stylesheet margin |
| `marginBottom` | number | 0–200 (px) | stylesheet margin |
| `backgroundColor` | string | hex colour (§B.9) | transparent / stylesheet |
| `borderColor` | string | hex colour (§B.9) | stylesheet border colour |
| `borderWidth` | number | 0–8 (px) | stylesheet border width |
| `borderStyle` | string | `none` \| `solid` \| `dashed` \| `dotted` | solid (when a width is set) |
| `borderRadius` | number | 0–64 (px) | stylesheet radius |
| `padding` | number | 0–64 (px) | stylesheet padding |

**`layout` → CSS mapping (normative; both frontends implement this identically).**
Layout styles are merged **last** into the block's inline style object, so they win over the
component's own defaults.

| `layout` key | CSS property emitted | Value |
|---|---|---|
| `width` | `width` | `${width}%` (see clamping rule below) |
| `offsetX` | `marginLeft` | `${offsetX}%` (physical; see §F.5 RTL) |
| `marginTop` | `marginTop` | `${marginTop}px` |
| `marginBottom` | `marginBottom` | `${marginBottom}px` |
| `backgroundColor` | `backgroundColor` | the validated colour |
| `borderColor` | `borderColor` | the validated colour (longhand, not shorthand) |
| `borderWidth` | `borderWidth` | `${borderWidth}px` (longhand) |
| `borderStyle` | `borderStyle` | the enum value (longhand) |
| `borderRadius` | `borderRadius` | `${borderRadius}px` |
| `padding` | `padding` | `${padding}px` (shorthand) |
| `textAlign` | `textAlign` | the enum value |

Longhands are used for the border so that an existing component border (e.g. the callout's
`1px solid #b8cce0`) is *refined* rather than replaced: setting `layout.borderWidth: 3` makes the
callout's border 3 px thick while keeping its colour.

**Clamping rule (deterministic, both frontends):**
`effectiveWidth = min(layout.width, max(0, 100 - Math.abs(layout.offsetX)))`
— this makes it impossible to create horizontal page scroll with a width + offset combination.

**`textAlign` is not applied to `image` blocks** (the image's own `align` field owns horizontal
placement there, §B.5). It *is* applied to heading, paragraph, list, quote, callout and divider.
For `table` blocks it is applied to the block's scroll wrapper, but it **does not affect table
cells** — cell alignment is governed exclusively by `table.align` (§B.6).

**No wrapper element.** Layout styles are applied to the block's own root element (`<p>`,
`<h2>`, `<ul>`, `<blockquote>`, the callout `<div>`, the `<figure>`, the `<hr>`, the table's
scroll wrapper). The DOM of legacy blocks does not change, so existing CSS spacing rules
(`.content-body > * + * { margin-top: 1.1rem }`) keep working exactly as before.

### B.3 Per-block-type payload summary

| Block type | Type-specific keys (all existing ones kept) | New keys |
|---|---|---|
| `heading` | `level` (1–4), `text` | `layout` |
| `paragraph` | `text` | `layout` |
| `list` | `ordered` (bool), `items` (string[]) | `layout` |
| `quote` | `text`, `cite` (optional) | `layout` |
| `callout` | `variant`, `text` | `label`, `backgroundColor`, `textColor`, `borderColor`, `shape`, `layout` |
| `image` | `src`, `alt` | `width`, `height`, `align`, `fit`, `radius`, `layout` |
| `divider` | — | `layout` |
| `table` | — | `table` (§B.6), `layout` |

### B.4 Full list of allowed block types after this change

```
heading | paragraph | list | quote | callout | image | divider | table
```

`BLOCK_TYPES` in `backend/app/services/sanitize.py` becomes exactly that set. **Block types that
are not in this list are no longer deleted** — see §B.10.

### B.5 The image model

```jsonc
{
  "type": "image",
  "src": "/uploads/photo.jpg",     // EXISTING — required, safe_url()-restricted
  "alt": "A patient in an MRI room",// EXISTING
  "width": 60,                     // OPTIONAL, % of the block's content width, 1–100
  "height": 240,                   // OPTIONAL, px, 1–4000
  "align": "center",               // OPTIONAL: "left" | "center" | "right"
  "fit": "cover",                  // OPTIONAL: "cover" | "contain" | "fill"
  "radius": 12,                    // OPTIONAL, px, 0–64
  "layout": { /* … */ }            // OPTIONAL
}
```

| Key | Type | Range | Effective default | Notes |
|---|---|---|---|---|
| `width` | number | 1–100 | 100 % | **percent of the block's content box**, not px — keeps it responsive. `image.width` × `layout.width` = width of the column. |
| `height` | number | 1–4000 | auto (natural aspect) | **pixels**. `0` is treated as absent. |
| `align` | string | `left` \| `center` \| `right` | `left` | Horizontal placement of the image inside the figure. |
| `fit` | string | `cover` \| `contain` \| `fill` | `cover` **only when `height` is set**, otherwise no `object-fit` is emitted | CSS `object-fit`. |
| `radius` | number | 0–64 | stylesheet radius (`var(--radius)` / 12 px) | `border-radius` on the `<img>`. |

**Rendering rules (normative, both frontends):**
- `width` → `style.width = '${width}%'` on the `<img>`.
- `height` → `style.height = '${height}px'` on the `<img>`.
- `align` → `style.textAlign` on the `<figure>` (`left` | `center` | `right`); the `<img>` stays
  inline so legacy rendering is untouched.
- `fit` → `style.objectFit` on the `<img>`.
- `radius` → `style.borderRadius` on the `<img>`.
- If `height` is present and `fit` is absent → emit `objectFit: 'cover'` (prevents distortion).
- If the image block also has `layout.width`, the figure gets the layout width and the image
  width is a percentage of that.

### B.6 The table model

**Decision: the table payload is a nested `table` object**, matching the nested `layout` object
so that every block has the shape `{ type, layout?, <type payload> }`. This keeps the validator,
the TypeScript types and the renderers uniform.

```jsonc
{
  "type": "table",
  "table": {
    "header": ["Symptom", "How common", "What to ask"],   // OPTIONAL — the header row
    "rows": [
      ["Headache", "Common", "Should I get a scan?"],
      ["Nausea", "Occasional", "Is this normal?"]
    ],
    "align": ["left", "center", "left"],                   // OPTIONAL — per column
    "headerBackgroundColor": "#eef2f7",                    // OPTIONAL
    "headerTextColor": "#1f2937",                          // OPTIONAL
    "bordered": true,                                      // OPTIONAL
    "striped": false                                       // OPTIONAL
  },
  "layout": { /* … */ }                                   // OPTIONAL
}
```

| Key | Type | Range | Effective default |
|---|---|---|---|
| `header` | string[] | 0–50 cells, each ≤ 2 000 chars | absent → no header row |
| `rows` | string[][] | ≤ 200 rows, ≤ 50 columns, each cell ≤ 2 000 chars | absent → `[]` |
| `align` | string[] | per column: `left` \| `center` \| `right` | `left` for every column |
| `headerBackgroundColor` | string | hex colour (§B.9) | `#eef2f7` |
| `headerTextColor` | string | hex colour (§B.9) | `#1f2937` |
| `bordered` | bool | — | `true` |
| `striped` | bool | — | `false` |

**Normalisation rules (backend, applied on save):**
1. The **column count** is `len(table.header)` when a header exists, otherwise the length of the
   longest row.
2. Rows shorter than the column count are padded with `""`; rows longer are truncated.
3. `align` shorter than the column count is padded with `"left"`; longer is truncated.
4. Cell text is HTML-stripped like all other text (`_clean_text`, cap 2 000 chars). `\n` is
   preserved and rendered as a line break.
5. `header` present but empty (`[]`) → treated as "no header row"; the `<thead>` is not rendered.

**Rendering rules (normative, both frontends):**
```html
<div class="<prefix>-table-wrap" style="{layout styles}">   <!-- overflow-x: auto -->
  <table class="<prefix>-table <prefix>-table--bordered? <prefix>-table--striped?">
    <thead>…<th style="background-color; color; text-align">…</th>…</thead>
    <tbody><tr><td style="text-align">…</td>…</tr>…</tbody>
  </table>
</div>
```
- `<prefix>` = `pv` in `frontend/` (`.pv-table-wrap`, `.pv-table`, `.pv-table--bordered`,
  `.pv-table--striped`) and `content` in `site/` (`.content-table-wrap`, `.content-table`,
  `.content-table--bordered`, `.content-table--striped`).
- The layout styles are applied to the **wrapper** (it is the table block's root element).
- Every `<th>`/`<td>` gets an explicit `text-align` from `table.align[columnIndex]`, defaulting to
  `left`. `layout.textAlign` never reaches the cells (see §B.2).
- Cells with `\n` render as multiple lines (`<br>` in HTML, `<br/>` in JSX).
- The table is horizontally scrollable on narrow viewports — this is the responsive behaviour
  (never a fixed-width table).

### B.7 The callout model

The developer's work in `frontend/src/api/types.ts` and `frontend/src/components/BlockRenderer.tsx`
is the baseline and is **preserved**. The backend must stop destroying it.

```jsonc
{
  "type": "callout",
  "variant": "info",                // EXISTING — "info" | "warn" | "ok" | "bad" | "<custom slug>"
  "text": "…",                      // EXISTING
  "label": "Information",           // OPTIONAL — the label shown above the text
  "backgroundColor": "#eef6ff",     // OPTIONAL — hex colour
  "textColor": "#243447",           // OPTIONAL — hex colour
  "borderColor": "#b8cce0",         // OPTIONAL — hex colour
  "shape": "rounded",               // OPTIONAL — see the list below
  "layout": { /* … */ }             // OPTIONAL
}
```

**Allowed `shape` values — exactly five, no more:**
```
rectangle | rounded | square | oval | circle
```
(These are the five already implemented in `frontend/src/components/BlockRenderer.tsx` →
`CALLOUT_SHAPE_STYLES`. The site must copy that map verbatim.)

| Key | Type | Range | Effective default |
|---|---|---|---|
| `variant` | string | `info` \| `warn` \| `ok` \| `bad` \| custom slug `^[a-z][a-z0-9_-]{0,31}$` | `info` |
| `label` | string | ≤ 200 chars | per-variant default label (below) |
| `backgroundColor` | string | hex colour | `#eef6ff` |
| `textColor` | string | hex colour | `#243447` |
| `borderColor` | string | hex colour | `#b8cce0` |
| `shape` | string | the five values above | `rounded` |

**Default label per variant** (used by both frontends, identical strings):
`info` → "Information", `warn` → "Warning", `ok` → "Good to know", `bad` → "Important",
any custom variant → "Custom callout". An explicitly stored `label` always wins.

**Custom variants must survive.** Today `sanitize.py` coerces any variant outside
`{info,warn,ok,bad}` to `"info"` — that is data loss and must stop. A custom variant is kept
(lowercased) when it matches `^[a-z][a-z0-9_-]{0,31}$`; only genuinely invalid values fall back
to `info`. The variant slug is interpolated into a CSS class name
(`.pv-callout-{variant}` / `.content-callout--{variant}`), so the strict slug regex is also the
CSS-injection guard.

**Rendering parity (normative).** The site must reproduce the admin's callout inline style
*verbatim* — same padding (`18px` for `circle`, otherwise `16px 20px`), same
`border: 1px solid <borderColor>`, same `margin: 12px 0`, same `borderRadius` per shape, same
`boxSizing`, `overflowWrap`, `whiteSpace`, and the same colours — so an editor sees exactly what
the visitor sees. The site emits:

```html
<div class="content-callout content-callout--{variant} content-callout-shape-{shape}" role="note" style="{…}">
  <span class="content-callout__label">{label}</span>
  <div class="content-callout__text">{text}</div>
</div>
```

`layout.marginTop` / `layout.marginBottom` override the callout's `margin: 12px 0` (the layout
longhands are merged after the shorthand, so they win).

### B.8 The list / quote / heading / paragraph / divider models — unchanged

`heading.level` (1–4, clamped), `heading.text`, `paragraph.text`, `list.ordered` (bool),
`list.items` (≤ 500 items, each ≤ 2 000 chars), `quote.text`, `quote.cite` (≤ 512 chars, omitted
when empty), `divider` (no payload). These keep exactly the current normalisation rules; only
`layout` is added.

### B.9 Precise validator rules (the backend's contract)

| Element | Rule |
|---|---|
| **Colour format** | `^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$` **or** the literal `transparent`. Case is preserved as sent. Anything else → the key is dropped. |
| **Numbers** | Out-of-range numbers are **clamped** to the range (not rejected). Non-numeric values → the key is dropped. Booleans are not accepted as numbers. |
| **Enums** | Not in the allowed set → **the key is dropped** (the block and its other fields survive). |
| **`callout.variant`** | Exception to the enum rule: a custom slug matching `^[a-z][a-z0-9_-]{0,31}$` is kept; otherwise it falls back to `"info"`. |
| **Text** | `html.unescape` → `bleach.clean(tags=[], attributes={}, strip=True)` → strip `\x00` → truncate. Caps: 20 000 chars for block text, 2 000 for list items and table cells, 512 for `cite`, 200 for `callout.label`, 1 000 for `alt`. |
| **URLs** | Only `http://`, `https://`, `/` (site-relative) and `data:image/` (≤ 8 MB) via `safe_url()`. Everything else → `""`. An `image` block whose `src` fails `safe_url()` is **dropped entirely** (today's behaviour, unchanged). |
| **Existing limits** | `MAX_BLOCKS = 2000`, `MAX_TEXT = 20000`, `MAX_ITEMS = 500`. |
| **New limits** | `MAX_TABLE_ROWS = 200`, `MAX_TABLE_COLS = 50`, `MAX_CELL_TEXT = 2000`, `MAX_LABEL = 200`. |
| **Unknown extra keys** | Key name must match `^[A-Za-z_][A-Za-z0-9_-]{0,63}$`; string values are `_clean_text`-ed and capped at 20 000 chars; the keys `src`, `url`, `href`, `srcUrl`, `imageUrl` are additionally passed through `safe_url()`; nesting depth ≤ 6; ≤ 500 nodes per block. |
| **Unknown block types** | See §B.10. |

**Invalid values never fail the save.** The admin editor is the only writer and a 422 would
destroy an author's whole edit. The sanitiser normalises (clamps / drops the offending key) and
persists the rest. The editor controls must constrain input so this never occurs in practice
(colour pickers emit valid hex, sliders emit in-range numbers, selects emit valid enums).

### B.10 Unknown block types are preserved, not deleted

Today `_sanitize_block()` returns `None` for an unknown type and `sanitize_content()` drops it
from the array — that is how a whole `table` block disappeared. New rule:

1. `type` (lowercased) must match `^[a-z][a-z0-9_-]{0,31}$`; otherwise the block is dropped.
2. The block's remaining payload is preserved through the deep sanitiser described in §B.9
   (strings HTML-stripped and capped, URL-ish keys restricted, depth/node caps applied).
3. A valid `layout` object is re-attached (same rules as known types).
4. Both frontends render an unknown type as a **neutral placeholder** (a bordered box with the
   block's `text`/`label` if present, and the block type as a caption). They must not crash and
   must not render nothing (silent disappearance is the failure mode we are fixing).

**Consequence:** the backend stops silently deleting content it does not understand. A block whose
type is not in the eight known types survives a save/load cycle.

### B.11 TypeScript types (identical in `frontend/src/api/types.ts` and `site/src/api/types.ts`)

```ts
export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type BorderStyle = 'none' | 'solid' | 'dashed' | 'dotted';
export type CellAlign = 'left' | 'center' | 'right';
export type ImageFit = 'cover' | 'contain' | 'fill';
export type ImageAlign = 'left' | 'center' | 'right';
export type CalloutShape = 'rectangle' | 'rounded' | 'square' | 'oval' | 'circle';

export interface BlockLayout {
  textAlign?: TextAlign;
  width?: number;            // 0-100, %
  offsetX?: number;          // -100..100, %
  marginTop?: number;        // 0-200, px
  marginBottom?: number;     // 0-200, px
  backgroundColor?: string;  // hex
  borderColor?: string;      // hex
  borderWidth?: number;      // 0-8, px
  borderStyle?: BorderStyle;
  borderRadius?: number;     // 0-64, px
  padding?: number;          // 0-64, px
}

export interface TableSpec {
  header?: string[];
  rows: string[][];
  align?: CellAlign[];
  headerBackgroundColor?: string;
  headerTextColor?: string;
  bordered?: boolean;
  striped?: boolean;
}
```

Every block interface gains `layout?: BlockLayout;`. `ImageBlock` gains
`width?`, `height?`, `align?`, `fit?`, `radius?`. `CalloutBlock` keeps its existing
`label?`, `backgroundColor?`, `textColor?`, `borderColor?`, `shape?` and gains `layout?`
(`CalloutShape` already exists in `frontend/src/api/types.ts` and must be kept as-is; `site/`
gains it).
A new `TableBlock { type: 'table'; table: TableSpec; layout?: BlockLayout }` is added to the
`Block` union, and `BlockType` therefore becomes
`'heading' | 'paragraph' | 'list' | 'quote' | 'callout' | 'image' | 'divider' | 'table'`.

The two apps are separate packages with no shared module; the type file is **duplicated**, and
must stay byte-identical in the block/table/layout declarations.

### B.12 Shared renderer helper (both frontends)

Each app gets a local helper with this exact behaviour:

```ts
function layoutToCss(layout?: BlockLayout): CSSProperties
```

It returns an **empty object** when `layout` is undefined/empty, and otherwise only the
properties for the keys that are actually present (per the §B.2 mapping table). It must never
emit a property for an absent key. It is merged **last** into the block's inline style.

Both apps must also export/hold the shared constants:

```ts
const CALLOUT_SHAPES: CalloutShape[] = ['rectangle','rounded','square','oval','circle'];
const CALLOUT_SHAPE_STYLES: Record<CalloutShape, CSSProperties>;  // copied verbatim from
                                                                    // frontend/src/components/BlockRenderer.tsx
const CALLOUT_LABELS: Record<string, string>;   // info/warn/ok/bad/custom defaults (§B.7)
```

---

## C. Scope — IN

### C.1 Backend — the contract lands first (blocking for all frontends)

**C.1.1 `backend/app/services/sanitize.py` — validate-and-keep, not strip-and-drop**
- Add `"table"` to `BLOCK_TYPES` → the set becomes exactly the eight types in §B.4.
- Add the validators for `layout`, the image fields, the callout fields and the table payload,
  implemented exactly per §B.2, §B.5, §B.6, §B.7, §B.9, §B.10.
- **Stop rebuilding blocks from a fixed allow-list.** Known block types keep their existing
  normalisation for the existing fields, plus the new optional fields when present, plus any
  additional keys the client sent (deep-sanitised, §B.9).
- Unknown block types are preserved (§B.10).
- Existing security behaviour is unchanged: HTML stripped from text, `safe_url()` applied to
  URLs, no raw CSS/class strings accepted.
- `BLOCK_TYPES` must no longer be the mechanism by which unknown content is deleted.

**C.1.2 `backend/app/services/content_text.py` — search must see table content**
- `_block_text()` must include `callout.label` (already does) **and** every table header cell and
  every table body cell, so `GET /admin/pages/?q=…` finds text that only exists inside a table.
- `extract_clean_text()` output for legacy content must be unchanged.

**C.1.3 `backend/app/services/sanitize.py::blocks_to_html()` — the HTML export must know the new blocks**
- Render `table` as a real `<table>` (`<thead>`/`<tbody>`), callouts with their label/colour/shape,
  images with their size/alignment, and emit the `layout` as inline `style` attributes built from
  the same validated primitives.
- HTML-escape every text value (as today).

**C.1.4 `backend/app/schemas/page.py`**
- `PageUpdate` regains `is_homepage: Optional[bool] = None` and `featured: Optional[bool] = None`
  (they were lost in the bad merge; `PageBase` still has them at lines 44–45).
- `PageUpdate` also gains no other new fields — `content` stays `Optional[Dict[str, Any]]`.

**C.1.5 `backend/app/crud/crud_page.py`**
- When a page is created or updated with `is_homepage = True`, every **other** page with the same
  `lang` has `is_homepage` set to `False` (one homepage per language). Implement as a single
  helper used by both `create()` and `update()`.
- Note: `GET /api/v1/homepage` still prefers the page whose slug is `home` for that language, with
  the `is_homepage` flag as the fallback (existing convention, preserved by C.1.6). The flag is
  therefore "the homepage candidate for languages that have no `home` slug" — do not re-order the
  lookup in this release.

**C.1.6 `backend/app/api/v1/routes/public.py`**
- `GET /api/v1/homepage` must be deterministic and must never raise `MultipleResultsFound`:
  keep the current order (slug `home` first, then the `is_homepage` flag) but the flag lookup
  must apply `ORDER BY position ASC, created_at ASC` + `LIMIT 1` and use `scalars().first()`.

### C.2 Admin frontend (`frontend/`) — the designer

**C.2.1 `frontend/src/api/types.ts`** — add the types from §B.11 verbatim; add `TableBlock` to the
`Block` union; add `layout?: BlockLayout` to every block interface; add the image fields to
`ImageBlock`.

**C.2.2 `frontend/src/components/BlockRenderer.tsx`** — render the new fields:
- `layout` → merged via `layoutToCss()` into each block's own inline style (last, so it wins).
- `image` → `width`/`height`/`align`/`fit`/`radius` per §B.5.
- `table` → per §B.6.
- `callout` → keep the developer's existing implementation; the site copies it (§B.7).
- Unknown block types → neutral placeholder (§B.10).

**C.2.3 `frontend/src/pages/BlockEditor.tsx`** — the controls:

*A "Design" section on every block* (collapsible, below the type-specific fields):
| Control | Writes | Range in the UI |
|---|---|---|
| Alignment buttons: Left / Center / Right / Justify | `layout.textAlign` | — |
| Width slider + numeric input | `layout.width` | slider 0–100 step 5; input 0–100 |
| Horizontal offset numeric input | `layout.offsetX` | −50…50 step 1 |
| Margin top / margin bottom numeric inputs | `layout.marginTop` / `layout.marginBottom` | 0–200 |
| Background colour (colour picker + hex field) | `layout.backgroundColor` | valid hex |
| Border colour | `layout.borderColor` | valid hex |
| Border width | `layout.borderWidth` | 0–8 |
| Border style select | `layout.borderStyle` | none/solid/dashed/dotted |
| Border radius | `layout.borderRadius` | 0–64 |
| Padding | `layout.padding` | 0–64 |
| "Reset design" button | **removes the `layout` key entirely** | — |

*Image block controls* (in addition to the existing URL / media-picker / alt fields): width (%)
slider + input, height (px) input, alignment buttons (Left/Center/Right), fit select
(cover/contain/fill), radius input.

*Table block editor* (new): a grid where the first row is the header (each cell an input, plus a
per-column alignment select and a "✕ Remove column" button), followed by the body rows (each
cell an input, each row with a "✕ Remove row" button). Toolbar buttons: **+ Add row**,
**+ Add column**, **Header row** toggle (on by default), **Bordered** toggle (on by default),
**Striped** toggle (off by default), header background colour, header text colour. Adding a
column appends an empty cell to the header and to every row; removing a column removes it from
the header and from every row. Turning **Header row** off deletes `table.header` (every row
becomes a body row, and the current header text is moved into a new first body row so nothing is
lost); turning it back on inserts an empty header with the current column count.

*Block-type switching must not destroy design settings:* in `setType()`, the new block must
inherit the previous block's `layout` (the existing "carry over text" behaviour stays).

*`makeBlock('table')`* must create `{ type: 'table', table: { header: ['',''], rows: [['','']] } }`.

**C.2.4 `frontend/src/pages/PageEditorPage.tsx`**
- Expose the restored `is_homepage` and `featured` flags as **admin-only** checkboxes in the
  settings column ("Homepage", "Featured"), and send them in the PATCH payload.
- `PageUpdatePayload` in `frontend/src/api/types.ts` regains `is_homepage?: boolean` and
  `featured?: boolean`.
- Saving must not strip `layout`/`table`/image fields — the editor passes the block array through
  unchanged apart from the existing `normalizeBlocks()` (empty list items removed).

**C.2.5 `frontend/src/index.css`** — new rules for `.pv-table-wrap`, `.pv-table`,
`.pv-table--bordered`, `.pv-table--striped`, and any new editor-control classes. Existing rules
must not be changed in a way that alters the rendering of legacy content.

### C.3 Public site (`site/`) — parity

**C.3.1 `site/src/api/types.ts`** — the same type additions as §B.11, byte-identical declarations.

**C.3.2 `site/src/components/BlockRenderer.tsx`** — render every new field:
- `layout` → same `layoutToCss()` behaviour and the same mapping as the admin.
- `image` → `width`/`height`/`align`/`fit`/`radius`.
- `table` → same markup/classes as the admin (`content-table*` prefix).
- `callout` → the developer's implementation, copied verbatim (colours, shape, label, the five
  shape styles, the identical inline style object).
- Unknown block types → neutral placeholder.

**C.3.3 `site/src/index.css`** — `.content-table-wrap`, `.content-table`,
`.content-table--bordered`, `.content-table--striped`, and the per-shape callout rules.

**C.3.4 The site must not gain a dependency on the admin app.** The shared logic is duplicated
(deliberately); no new workspace package, no path alias across apps.

### C.4 Backend content-text and HTML export

Covered in C.1.2 and C.1.3. Both must understand the `table` block and the `layout` object.

### C.5 Regression repair (must ship with this feature)

- `PageUpdate` regains `is_homepage` / `featured` (C.1.4).
- Unsetting other homepages in the same language (C.1.5).
- Deterministic `GET /api/v1/homepage` with `LIMIT 1` (C.1.6).
- The admin UI exposes both flags again (C.2.4).

### C.6 The `table` block type is REQUIRED

The developer's table work does not exist on any branch. It **must be built** in this release:
backend validator + content-text + HTML export, admin editor + renderer, public renderer + CSS.
It is not optional, not "later", and not conditional on user validation — the user asked for it
explicitly and the schema in §B.6 is final.

---

## D. Scope — OUT

| Not building | Why |
|---|---|
| **True pixel-perfect absolute canvas layout** (free x/y dragging of arbitrary elements with `position:absolute`) | It is fundamentally incompatible with the "responsive" requirement: a fixed x/y is meaningless at another viewport width, it destroys text flow (no reflow on mobile), it breaks RTL (`ar`), and it cannot be produced by an editor whose preview and the public site render at different widths. The pragmatic model implemented here — **flow + width + alignment + spacing + offsets** — delivers the same authorial intent ("move this element over here, make it 60 % wide, centre it, give it breathing room") and stays correct on every viewport. Absolute coordinates would also make every legacy page a special case. |
| Multi-column / nested row layouts (side-by-side blocks) | Requires a grid system, a new nesting model in `content` (blocks inside blocks), and a second pass through the sanitiser, the content-text extractor and both renderers. Out of scope for this release; blocks remain a single vertical flow, which is what "responsive" means for a medical-information site. |
| Drag-and-drop block reordering on a canvas | The editor already reorders blocks with the ↑/↓ buttons (`BlockEditor.tsx`). DnD is an accessibility-heavy UI feature with no bearing on the data-loss bug. The buttons stay. |
| Multi-user real-time collaboration | Different product, different architecture (CRDT/websocket layer). |
| Undo/redo history | The backend already keeps 20 revisions per page with a restore endpoint (`GET /admin/pages/{id}/revisions`, `POST …/revisions/{rev_id}/restore`). That covers "undo" adequately for now. |
| A/B testing / content variants | Needs a variant model in the DB and a router; nothing in the request implies it. |
| PDF / print export, sitemap generation, stats dashboards | Unrelated subsystems; not requested. |
| **Custom CSS injection** (author-supplied `<style>`, class names, raw `style` strings) | A stored-XSS and layout-breaking vector. Styling is expressed exclusively as validated primitives (numbers, enums, hex colours) and translated to CSS by the renderers. |
| Per-cell table alignment (only per-column is supported) | Per-cell alignment multiplies the state space for very little editorial value. |
| The public API serving `live_content` instead of `content` | **Pre-existing behaviour, deliberately not changed here** — see §F.7. Changing it would hide unapproved draft edits (good) but would blank the public site for every published page whose `live_content` is `NULL` (the import path in `backend/app/api/v1/routes/data.py` creates published pages without `live_content`), so it needs a backfill migration first. Recommended as its own piece of work. |
| Removing the stale duplicate backend at the repo root (`app/`) | Out of scope for this feature, but see §F.9 — **edits must never be made there.** A separate cleanup PR should delete it. |
| Media upload, HTML sanitisation of *saved* HTML, audit-log service, export/import | `backend/IMPLEMENTATION_PROMPTS.txt` stages 6–8; unrelated to this feature. |

---

## E. Acceptance criteria

Each item is verifiable by a command or an HTTP request. `BASE=http://127.0.0.1:8000`.

### E.1 Backend test suite

```bash
cd backend && ../.venv/bin/python -m pytest -q
```
- **E.1.1** The suite passes with **0 failures and 0 errors** (baseline today: `2 passed`).
- **E.1.2** New test modules exist and are named exactly:
  `backend/tests/test_sanitize_schema.py` (pure unit tests, no DB) and
  `backend/tests/test_designer_roundtrip.py` (DB-backed; skips cleanly when no database is
  reachable — it must not fail the suite when PG is down).
- **E.1.3** `backend/tests/test_sanitize_schema.py` asserts, at minimum:
  a `table` block survives `sanitize_content()` with its `header`/`rows`/`align` intact;
  a callout keeps `label`/`backgroundColor`/`textColor`/`borderColor`/`shape`;
  a callout with `variant: "medical-note"` keeps that variant;
  a block with `layout` keeps all supplied layout keys;
  `layout.width: 900` is clamped to `100`;
  `layout.textAlign: "middle"` is dropped while the rest of the layout survives;
  `backgroundColor: "red"` is dropped;
  an unknown block type (`{"type":"video","src":"/x.mp4"}`) survives;
  `{"type":"image","src":"javascript:alert(1)"}` is dropped;
  `{"type":"paragraph","text":"<script>alert(1)</script>"}` → `"alert(1)"` with no tags;
  `sanitize_content()` on a legacy content dict returns a value **deep-equal** to the legacy
  output shape (no added `layout` key).

### E.2 Round-trip: nothing is lost on save (the core criterion)

```bash
cd backend && ./start_pg.sh && ../.venv/bin/python init_and_seed.py
cd backend && ../.venv/bin/python -m uvicorn app.main:app --reload --port 8000 &
TOKEN=$(curl -s -X POST $BASE/api/v1/auth/login/json -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin123"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
```
- **E.2.1** `POST /admin/pages/` with a body containing (a) a `table` block with a header and two
  rows, (b) a `callout` with `label`, `backgroundColor`, `textColor`, `borderColor`, `shape:"oval"`,
  (c) a `paragraph` with `layout` (`textAlign:"center"`, `width:70`, `offsetX:5`,
  `marginTop:24`, `marginBottom:12`, `backgroundColor:"#f7f7f8"`, `borderColor:"#d0d7de"`,
  `borderWidth:2`, `borderStyle:"dashed"`, `borderRadius:10`, `padding:16`),
  (d) an `image` with `width:60`, `height:240`, `align:"center"`, `fit:"cover"`, `radius:12`
  → returns **HTTP 200** with a `content.blocks` array whose four blocks carry **every field
  above, unchanged** (deep-equal to the request).
- **E.2.2** `GET /admin/pages/{id}` → `content.blocks` is **deep-equal** to the response of
  E.2.1 and to the request payload (compare parsed JSON, not raw strings — JSONB reorders keys).
- **E.2.3** Publish the page (`POST /admin/pages/{id}/submit` then
  `POST /admin/pages/{id}/approve` with an admin token), then `GET /api/v1/pages/{slug}` →
  **HTTP 200** and `content.blocks` is **deep-equal** to the admin response.
- **E.2.4** `GET /admin/pages/{id}` shows `live_content.blocks` **deep-equal** to
  `content.blocks` (the approve snapshot carries every new field).
- **E.2.5** `GET /admin/pages/{id}/revisions` → the revision's `content` carries the new fields.
- **E.2.6** A translation created via `POST /admin/pages/{id}/translations` with `{"lang":"hr"}`
  carries the new fields in its `content`.
- **E.2.7** `GET /admin/pages/?q=<a string that appears only inside a table cell>` → the page
  appears in the results (content-text extraction sees table cells).

### E.3 Legacy content is untouched

- **E.3.1** For every seeded page (2 099 pages from `backend/scripts/import_proto.py`), the
  stored `content` contains **no** `layout` key, **no** `table` key and **no** new callout/image
  keys after the change. Run either the SQL or the Python form (the Python form does not depend
  on `psql` being installed):
  ```bash
  psql "postgresql://postgres:qwerty@127.0.0.1:5433/mc_admin" -c \
    "SELECT count(*) FROM pages WHERE content::text LIKE '%\"layout\"%' \
        OR content::text LIKE '%\"table\"%' OR content::text LIKE '%\"shape\"%';"
  ```

  ```bash
  # Fallback when psql is not installed:
  cd backend && ../.venv/bin/python - <<'PY'
  import asyncio
  from sqlalchemy import select
  from app.db.session import AsyncSessionLocal
  from app.models.page import Page
  async def main():
      async with AsyncSessionLocal() as db:
          rows = (await db.execute(select(Page.content))).scalars().all()
      bad = [c for c in rows if isinstance(c, dict) and any(
          isinstance(b, dict) and ("layout" in b or b.get("type") == "table"
                                   or "shape" in b or b.get("type") == "image" and "width" in b)
          for b in c.get("blocks", []))]
      print(f"pages={len(rows)} pages_with_new_keys={len(bad)}")
  asyncio.run(main())
  PY
  ```
  → `pages_with_new_keys=0` (both forms).
- **E.3.2** A legacy page saved through `PATCH /admin/pages/{id}` with **no** content change comes
  back with a `content` object that is **deep-equal** to the content before the save (the
  sanitiser neither adds nor removes keys for legacy blocks).
- **E.3.3** `GET /api/v1/pages/{slug}` for a legacy page returns the same content as before the
  change, and the site renders it identically (no wrapper elements, no changed margins).

### E.4 Public site renders the new fields

- **E.4.1** `cd site && npm run build` succeeds.
- **E.4.2** The site renders a page containing a `table` block as a real `<table>` with a
  `<thead>` when a header exists, the per-column `align` applied to the cells, the header colours
  applied to the `<th>`s, and the table inside a horizontally scrollable wrapper.
- **E.4.3** The site renders the callout with the stored `backgroundColor` / `textColor` /
  `borderColor` / `shape` / `label` — verified in the DOM (inline style + class
  `content-callout-shape-<shape>`).
- **E.4.4** The site renders the image with the stored width/height/alignment/fit/radius.
- **E.4.5** The site renders the paragraph with the stored layout (width, alignment, spacing,
  background, border, radius, padding).
- **E.4.6** The admin preview (`frontend/src/components/BlockRenderer.tsx`) and the public site
  produce the **same** structure and the same inline styles for the same content JSON.

### E.5 Admin frontend builds and behaves

- **E.5.1** `cd frontend && npm run build` succeeds (it runs `tsc -b && vite build`).
- **E.5.2** Every block type in §B.4 has a "Design" section with the controls in §C.2.3;
  changing a value and pressing "Save changes" then reloading the page shows the value still
  there (i.e. the backend persisted it — cross-check with E.2).
- **E.5.3** "Reset design" removes the `layout` key from the saved JSON.
- **E.5.4** The table block can be created, a row and a column added and removed, the header row
  toggled, and cells edited; the preview updates live.
- **E.5.5** Switching a block's type keeps its `layout`.
- **E.5.6** The admin-only "Homepage" and "Featured" checkboxes exist and round-trip through
  `PATCH /admin/pages/{id}`.

### E.6 No feature removed

- **E.6.1** The seven original block types (`heading`, `paragraph`, `list`, `quote`, `callout`,
  `image`, `divider`) still work end to end: create → save → publish → render.
- **E.6.2** The workflow `draft → submit → pending → approve → published` and `reject` (with
  `reject_note`) and `unpublish` still behave as before (volunteers still get 403 on approve /
  reject / unpublish and on pending pages).
- **E.6.3** `GET /api/v1/navigation?lang=en` still returns the group tree and the flat page list.
- **E.6.4** The `home-v1` homepage format still renders (site + admin preview).

### E.7 Homepage regression repaired

- **E.7.1** `PATCH /admin/pages/{id}` with `{"is_homepage": true}` is accepted (HTTP 200) — it
  was previously silently ignored because `PageUpdate` had no such field.
- **E.7.2** After setting page A as homepage in language `en`, `GET /admin/pages/{id}` for page A
  shows `is_homepage: true` **and** every other `en` page shows `is_homepage: false`
  (one homepage per language).
- **E.7.3** `PATCH /admin/pages/{id}` with `{"featured": true}` is accepted and round-trips.
- **E.7.4** `GET /api/v1/homepage?lang=en` → **HTTP 200** and exactly one page object (not a
  list, not a 500). For a language that has no homepage at all, the endpoint returns a clean
  **404** `{"detail":"Homepage not found"}` — never a 500.
- **E.7.5** With **two** pages in the same language both flagged `is_homepage = true` (forced in
  the DB) **and no published page with slug `home` in that language** — so the slug lookup cannot
  mask the bug — `GET /api/v1/homepage?lang=hr` still returns **HTTP 200** with exactly one page
  object. No `MultipleResultsFound`, no 500. (Use `hr` rather than `en`, because the seeded `home`
  page is `en` and would otherwise short-circuit the flag query.)
  ```bash
  psql "postgresql://postgres:qwerty@127.0.0.1:5433/mc_admin" -c \
    "UPDATE pages SET is_homepage = true WHERE id IN (SELECT id FROM pages WHERE lang='hr' LIMIT 2);"
  curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/v1/homepage?lang=hr"   # → 200
  ```

### E.8 Security (unchanged guarantees)

- **E.8.1** A paragraph containing `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>`
  is stored with the tags stripped (no `<`/`>` in the text).
- **E.8.2** A callout `backgroundColor` of `"red; background-image:url(javascript:alert(1))"` is
  dropped (invalid colour), not stored.
- **E.8.3** An image `src` of `javascript:alert(1)` → the image block is dropped; an image `src` of
  `https://example.com/a.jpg` → kept; an image `src` of `data:image/png;base64,…` → kept.
- **E.8.4** A `table` cell containing `<script>alert(1)</script>` is stored as `alert(1)`.
- **E.8.5** No renderer ever injects an author-supplied string into a `style` attribute or a class
  name without passing the validator (`callout.variant` is restricted to
  `^[a-z][a-z0-9_-]{0,31}$` before it is used as a class suffix).
- **E.8.6** `GET /api/v1/pages/{slug}` (unauthenticated) exposes nothing that
  `GET /admin/pages/{id}` does not for published pages.

---

## F. Risks & edge cases

**F.1 Empty / null / malformed `layout`.**
`layout: null`, `layout: {}`, `layout: "x"` and `layout: []` all mean *"no layout"*. The
sanitiser drops the key (it does not store an empty object) and the renderers emit no style
properties. `layout` with only one valid key is kept with that one key.

**F.2 Legacy content with unknown keys.**
Known block types carrying extra keys keep them (deep-sanitised), which fixes the root cause for
the *next* schema change too. The cost: the stored JSON can contain keys the frontends do not
render. That is intentional — unknown data must not be destroyed, and the renderers ignore what
they do not understand. A future `content-format` bump (e.g. `blocks-v2`) is the right place to
prune deliberately.

**F.3 Huge tables.**
Limits: 200 rows × 50 columns = 10 000 cells, each ≤ 2 000 chars → a single table block can be
~20 MB of JSON. The sanitiser must therefore also enforce a **per-block payload cap**: if the
serialised block exceeds 256 KB, the table is truncated (rows dropped from the end) before
storage. `MAX_BLOCKS = 2000` stays, so a page cannot be used to store unbounded data. The editor
must warn (not block) above 50 rows.

**F.4 Hex-colour validation.**
Colours are validated server-side *and* in the editor. The renderers must never interpolate an
unvalidated colour into CSS. The validator accepts `#RGB`, `#RRGGBB`, `#RRGGBBAA` and
`transparent`; anything else is dropped. Note that `#RGB` is a valid CSS colour but a 4-digit
form (`#RGBA`) is **not** accepted — this asymmetry is intentional and documented.

**F.5 RTL languages (`hr`, `tr`, `ar`).**
`textAlign` uses physical values (`left`/`right`), not `start`/`end`, as specified by the request;
`offsetX` maps to a physical `margin-left`. An Arabic page can therefore position an element
"to the right" with a positive offset, which is the behaviour of every mainstream editor, but it
is *physical*, not logical. `justify` on a narrow column produces large word gaps — the editor
should not offer `justify` as a default and the site should keep a sensible minimum column
width. `direction: rtl` is inherited from the page/document as today.

**F.6 Sanitiser round-trip fidelity.**
The contract is "validate and keep", so the sanitiser must be **idempotent**:
`sanitize_content(sanitize_content(x)) == sanitize_content(x)` (deep equality). This must be
asserted in `backend/tests/test_sanitize_schema.py` — it is the property that guarantees a
save/load/save cycle never drifts. JSONB does not preserve key order, so all comparisons are on
parsed objects.

**F.7 `live_content` snapshot on approve.**
`POST /admin/pages/{id}/approve` copies the whole `content` dict into `live_content` and
`content_text` into `live_content_text` — so every new field is included automatically (E.2.4).
**Pre-existing behaviour that is deliberately not changed:** the public API
(`GET /api/v1/pages/{slug}`, `GET /api/v1/homepage`) returns `page.content`, **not**
`page.live_content`, so an unapproved edit to a published page is visible on the public site
immediately. Changing that is a behaviour change with a data-migration requirement (the import
path in `backend/app/api/v1/routes/data.py` creates published pages **without** `live_content`,
so switching to `live_content` alone would blank those pages). Recommended as a separate piece
of work: backfill `live_content = content` for published pages with `live_content IS NULL`,
then serve `live_content`. Until then, the public site must keep rendering `content` — no change
in this release.

**F.8 Revisions and translations carry the new fields.**
`PageRevision.content` is a JSONB snapshot of the page content → new fields are carried
automatically; the restore endpoint copies the revision content back verbatim. Translations are
created with `content=sanitize_content(page.content)` → with the new sanitiser the new fields
survive. Note `create_translation` copies `content_text` from the source page rather than
recomputing it — with table content this is still correct (the text is derived from the same
content), but it must be re-verified after the sanitiser change (E.2.6).

**F.9 The nested-git-repo hazard.**
`backend/` is **both** a nested git repository (its own `.git`, HEAD `a978cc1`, branch `dev`)
**and** tracked by the root repository (109 files). Therefore:
- `git status` at the root does **not** show backend edits reliably → check **both**
  `git -C backend status` and `git status` at the root before and after every backend edit.
- A backend edit is only visible to the root repository's history if the root index is updated
  too → stage the change in **both** repositories (or the root commit will not contain it).
- Worse: the **root repository also contains a stale duplicate of the backend at `app/`**
  (73 tracked files, no `app/services/sanitize.py`, older `pages.py`/`public.py`). That copy is
  **dead code** — the running application is `backend/app` (`app.main:app` is served from
  `backend/`). **Every backend edit must be made under `backend/app/…`, never under the root
  `app/`.** Editing the root copy has no effect and will confuse the next reader.
- `__pycache__/*.pyc` files are tracked in both repositories → they show up as noise in every
  `git status`. Ignore them; do not stage them deliberately.

**F.10 Concurrency / workflow.**
A volunteer editing a *pending* page is still blocked (403 / locked). The new fields do not
change the workflow. The one new interaction is `is_homepage`, which is admin-only in the UI —
the API accepts it from any authenticated user, matching `PageCreate`'s existing behaviour
(`PageCreate` inherits `is_homepage` from `PageBase`).

**F.11 Performance.**
The sanitiser runs on every save over up to 2 000 blocks. The deep sanitiser for unknown blocks
is bounded (depth 6 / 500 nodes), so the worst case stays linear. The `table` normalisation is
O(rows × cols) and capped at 10 000 cells.

**F.12 Two apps, one contract.**
`frontend/` and `site/` are separate packages with no shared module, so the type declarations and
the `layoutToCss()` mapping are **duplicated**. Divergence is the main risk: any change to the
mapping table (§B.2) must be applied to both in the same commit. The acceptance criterion E.4.6
is what catches divergence.

---

## G. Ordered delivery plan

Each phase is independently verifiable and leaves the system in a working state. **The backend
contract (Phase 1) lands first so that no frontend work is built against a wrong schema.**

### Phase 1 — Backend contract: the schema, the validator, the exports
**Goal:** nothing is lost on save. The schema in §B is implemented literally.

*Work*
1. `backend/app/services/sanitize.py` — `layout` validator, image fields, callout fields, table
   payload, `BLOCK_TYPES` += `table`, unknown-type preservation, validate-and-keep for known
   types (§B.2, §B.5, §B.6, §B.7, §B.9, §B.10).
2. `backend/app/services/content_text.py` — table cells + callout label in `_block_text()`.
3. `backend/app/services/sanitize.py::blocks_to_html()` — table, callout design, image sizing,
   layout as inline styles.
4. `backend/tests/test_sanitize_schema.py` — the unit tests listed in E.1.3, including the
   idempotence property (F.6).

*Verify*
```bash
cd backend && ../.venv/bin/python -m pytest -q
```
→ all pass; plus a manual `curl` of E.2.1–E.2.2 against a running server (the frontend is not
needed for this).

**Gate:** a `table` block, a styled callout and a `layout` survive `POST /admin/pages/` and
`GET /admin/pages/{id}` byte-for-byte (deep-equal).

### Phase 2 — Backend regression repair (homepage)
**Goal:** the three reverted homepage fixes are back; the public homepage never 500s.

*Work*
1. `backend/app/schemas/page.py` — `PageUpdate` regains `is_homepage` and `featured`.
2. `backend/app/crud/crud_page.py` — unset other homepages in the same language (create + update).
3. `backend/app/api/v1/routes/public.py` — deterministic `GET /api/v1/homepage`
   (`ORDER BY position, created_at` + `LIMIT 1` + `scalars().first()`).

*Verify* — E.7.1 … E.7.5 (`curl`).

**Gate:** one homepage per language; `GET /api/v1/homepage` returns 200 with a single page even
when the DB contains two flagged pages.

### Phase 3 — Admin frontend: the designer
**Goal:** an editor can lay out any block, size images and build tables, and the values survive
a save.

*Work*
1. `frontend/src/api/types.ts` — §B.11 types + `TableBlock` + `PageUpdatePayload.is_homepage`
   and `.featured`.
2. `frontend/src/components/BlockRenderer.tsx` — `layoutToCss()`, image, table, unknown-type
   placeholder.
3. `frontend/src/pages/BlockEditor.tsx` — Design panel, image controls, table editor, `layout`
   survives a type change, `makeBlock('table')`.
4. `frontend/src/pages/PageEditorPage.tsx` — admin-only "Homepage" / "Featured" checkboxes.
5. `frontend/src/index.css` — table + editor-control styles.

*Verify*
```bash
cd frontend && npm run build
```
→ succeeds; then a manual pass in the browser: create a table, style a callout, set a layout,
save, reload, confirm the values are still there (cross-checked against E.2).

**Gate:** the admin SPA can author every field in §B and the saved JSON matches §B exactly.

### Phase 4 — Public site parity
**Goal:** a visitor sees exactly what the editor previewed.

*Work*
1. `site/src/api/types.ts` — the same §B.11 declarations.
2. `site/src/components/BlockRenderer.tsx` — `layoutToCss()`, image, table, callout (copied
   verbatim from the admin), unknown-type placeholder.
3. `site/src/index.css` — `.content-table*` and the per-shape callout rules.

*Verify*
```bash
cd site && npm run build
```
→ succeeds; then E.4.2–E.4.6 in the browser against a published page.

**Gate:** the public DOM matches the admin preview for the same content JSON.

### Phase 5 — End-to-end verification, security and hardening
**Goal:** the whole thing is proven, not assumed.

*Work*
1. `backend/tests/test_designer_roundtrip.py` — the DB-backed round trip (E.2), skipped cleanly
   when no DB is reachable.
2. A scripted E2E check (`backend/scripts/verify_designer.sh` or equivalent) that performs
   E.2.1–E.2.7, E.7.1–E.7.5 and E.8.1–E.8.6 against a live server and prints a pass/fail line
   per check.
3. Re-verify the legacy-content proof (E.3.1–E.3.3) against the seeded database.
4. Update `work/page-designer/STATE.md` and the relevant docs.

*Verify*
```bash
cd backend && ../.venv/bin/python -m pytest -q
cd frontend && npm run build
cd site && npm run build
./backend/scripts/verify_designer.sh
```
→ all green.

**Gate:** every acceptance criterion in §E has a green check.

---

## H. Decision log (final, for the record)

| # | Decision | Rationale |
|---|---|---|
| D1 | Layout is a **nested `layout` object** on every block | One namespace, one validator, one helper; 100 % backwards compatible with the 2 099 seeded pages that have no `layout` key |
| D2 | Absent key = **"no override"**, never "0" | The only way to guarantee legacy content renders unchanged in both apps |
| D3 | The backend **validates and keeps**; it never materialises defaults into storage | Fixes the root cause; keeps the stored JSON faithful to what the editor sent |
| D4 | Unknown block types are **preserved** (deep-sanitised) | Silent deletion is the failure mode being fixed; `table` was lost exactly this way |
| D5 | The table payload is a **nested `table` object** | A table is a matrix (header + rows + per-column alignment) — one cohesive sub-object keeps the block flat and the cell data validated as a unit |
| D6 | Image `width` is a **percentage**, `height` is **pixels** | Percent keeps it responsive; px height is needed for crop-style sizing |
| D7 | `textAlign` (layout) and `align` (image) are **different fields** | One aligns text, the other places an image — reusing one name would be a bug factory |
| D8 | Physical `left`/`right`/`margin-left` (not logical `start`/`end`) | Matches the request wording; documented as a known RTL trade-off (F.5) |
| D9 | No absolute/free x-y canvas | Incompatible with the "responsive" requirement and with RTL and text flow; the flow + width + alignment + spacing + offset model delivers the intent (D-section) |
| D10 | The public API keeps serving `content` (not `live_content`) | Pre-existing behaviour; changing it needs a backfill migration for imported pages (F.7) |
| D11 | The `table` block type **must be built** in this release | Explicitly requested; the schema is final |
| D12 | Backend contract (Phase 1) lands before any frontend work | No frontend may be built against an unverified schema |

---

## I. Open questions

**None.** Every decision needed to implement this is made above. If a specialist finds a genuine
ambiguity (a field that cannot be expressed in the schema, a rendering conflict), they must
raise it with the PM rather than inventing a third interpretation of the contract.
