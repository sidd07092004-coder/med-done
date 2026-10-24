# Implementation Spec — Free-form responsive page designer (v1)

**Spec version:** `v1` — 2026-10-22
**Inputs:** `work/page-designer/02-requirements.md` (contract), `work/page-designer/01-triage.md`.
**Status:** build-ready. No open questions. Every ambiguity found in §B is resolved in §1.14.

> **How the three agents use this file.** There are exactly three implementers and they do not
> talk to each other. This file is the only cross-agent agreement. Each agent owns the files in
> §0.1 and must not edit anything outside its column. If this file contradicts the code, this
> file wins for this feature; if this file is silent, follow `02-requirements.md`; if both are
> silent, follow the existing code style. **Do not invent a fourth interpretation.**

---

## 0. Agent boundaries, forbidden edits, definition of done

### 0.1 File ownership (exclusive)

| Agent | Owns these files | Must not edit |
|---|---|---|
| **BACKEND** | `backend/app/services/sanitize.py`, `backend/app/services/content_text.py`, `backend/app/schemas/page.py`, `backend/app/crud/crud_page.py`, `backend/app/api/v1/routes/pages.py` (flag guard only, §2.14), `backend/app/api/v1/routes/public.py`, `backend/tests/test_content_schema.py`, `backend/tests/test_sanitize_schema.py`, `backend/tests/test_designer_roundtrip.py` | any `frontend/` or `site/` file; root `app/`; `work/page-designer/02-requirements.md` |
| **ADMIN** | `frontend/src/api/types.ts`, `frontend/src/lib/blockDesign.ts` (new), `frontend/src/components/BlockRenderer.tsx`, `frontend/src/pages/BlockEditor.tsx`, `frontend/src/pages/PageEditorPage.tsx`, `frontend/src/index.css` | `backend/`; `site/`; `frontend/src/api/client.ts` (no change needed); root `app/` |
| **SITE** | `site/src/api/types.ts`, `site/src/lib/blockDesign.ts` (new), `site/src/components/BlockRenderer.tsx`, `site/src/index.css` | `backend/`; `frontend/`; root `app/` |

**Dead duplicate:** the root `app/` directory is a stale, unused copy of the backend. The running
application is `backend/app`. **Never edit root `app/`.** It has no effect and pollutes review.

**Nested git:** `backend/` is its own git repo and is also tracked by the root repo. Before and
after backend edits, run both `git -C backend status` and `git status` at the repo root. Stage in
both repositories if the user asks for a commit. Ignore `__pycache__/*.pyc` noise.

### 0.2 Global rules

1. **Additive only.** No existing block type, callout variant style, workflow state, endpoint,
   navigation response, or `home-v1` rendering may be removed or renamed.
2. **No new npm/pip dependencies.** Both apps are separate packages; no shared workspace.
3. **No raw author CSS/HTML/class names.** Styling is only validated numbers, enums and hex
   colours translated by the renderers. `dangerouslySetInnerHTML` is forbidden in both apps.
4. **No `live_content` switch.** The public API keeps serving `page.content` (F.7). Do not “fix”
   that in this release.
5. **No absolute-canvas layout**, no nested rows, no drag-and-drop. The model is flow + width +
   alignment + spacing + offset (§D).
6. **Tests must pass without a database** for the pure-function suite. Async tests need
   `@pytest.mark.asyncio` (`pytest-asyncio` is strict; there is no pytest config file).
7. **Canonical type block:** the block between `// [BEGIN CANONICAL BLOCK SCHEMA]` and
   `// [END CANONICAL BLOCK SCHEMA]` in `frontend/src/api/types.ts` and `site/src/api/types.ts`
   must be **byte-identical**. `frontend/src/lib/blockDesign.ts` and
   `site/src/lib/blockDesign.ts` must be **byte-identical**. These two diffs are the parity gate.

### 0.3 Definition of done (all agents)

```bash
cd backend && ../.venv/bin/python -m pytest -q          # 0 failures, 0 errors
cd frontend && npm run build                            # tsc -b && vite build
cd site && npm run build                                # tsc --noEmit && vite build
```

Plus the live round-trip in §6 and the two parity diffs in §6.2. The feature is not done if any
legacy page’s saved JSON changes shape (§2.9 guarantee) or if either build fails.

### 0.4 Success criteria (measurable)

| Metric | Target | How it is measured |
|---|---|---|
| New-field retention | **100 %** of `layout` / table / callout-design / image-sizing keys survive a save→reload round trip | §6.3 live curl + `test_roundtrip_all_new_blocks` |
| Legacy JSON stability | **0** changed blocks across the 2 099 seeded pages | golden fixtures (§2.15 tests 1–9) + §6.4 step 5 visual check |
| Sanitiser idempotency | `sanitize(sanitize(x)) == sanitize(x)` for all fixtures | §2.15 tests 9, 10, 11 |
| Test pass rate | **100 %** of the new suite (DB tests may *skip*, never fail) | `pytest -q` |
| Cross-app parity | canonical block and `blockDesign.ts` **byte-identical** | §6.2 diff + extraction script |
| Build health | `tsc` + `vite build` clean in both apps, **0** `@ts-ignore` added | §6.1 |
| Responsive safety | **0** horizontal page scroll at 360 px; tables scroll inside their wrapper | §6.4 step 3 |
| Permission safety | volunteer create/PATCH with flags → **403** | §2.17 test 8 + §6.3 |
| Homepage determinism | `/api/v1/homepage` returns the same page on repeated calls | §6.3 |

---

## 1. Canonical schema registry (the contract)

This section reproduces §B of `02-requirements.md`. It is normative. Read §1.14 before coding:
the resolutions there are part of the registry.

### 1.1 Design rules that apply to every block (§B.0, verbatim)

1. **Additive only.** Every new field is optional. A block that carries no new field must
   serialise, store and render **exactly** as it does today.
2. **Absent ≠ zero.** A missing optional key means *“no override — keep the stylesheet/theme
   value”*. It does **not** mean “use 0”. This is what makes 2 099 already-seeded pages (seeded by
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

### 1.2 Top-level content (§B.1)

Unchanged. Two content formats exist and both keep working:

```jsonc
{ "format": "blocks-v1", "blocks": [ /* … */ ] }
{ "format": "home-v1",   "fields": { "heroBtTitle": "…", /* … */ } }
```

- `blocks-v1` gains the block types and fields defined below.
- `home-v1` is **unchanged**. `layout`, `table`, image sizing and callout design do **not** apply
  to homepage fields in this release (the homepage template is fixed). Homepage pages may still
  carry `blocks-v1` content if an author chooses; both formats are rendered as today.

### 1.3 Per-block `layout` model (§B.2)

Layout lives in a nested `layout` object on every block, not in flat keys.

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
Layout styles are merged **last** into the block’s inline style object, so they win over the
component’s own defaults.

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

Longhands are used for the border so that an existing component border (e.g. the callout’s
`1px solid #b8cce0`) is *refined* rather than replaced: setting `layout.borderWidth: 3` makes the
callout’s border 3 px thick while keeping its colour.

**Clamping rule (deterministic, both frontends):**
`effectiveWidth = min(layout.width, max(0, 100 - Math.abs(layout.offsetX)))`
— this makes it impossible to create horizontal page scroll with a width + offset combination.

**`textAlign` is not applied to `image` blocks** (the image’s own `align` field owns horizontal
placement there, §B.5). It *is* applied to heading, paragraph, list, quote, callout and divider.
For `table` blocks it is applied to the block’s scroll wrapper, but it **does not affect table
cells** — cell alignment is governed exclusively by `table.align` (§B.6).

**No wrapper element.** Layout styles are applied to the block’s own root element (`<p>`,
`<h2>`, `<ul>`, `<blockquote>`, the callout `<div>`, the `<figure>`, the `<hr>`, the table’s
scroll wrapper). The DOM of legacy blocks does not change, so existing CSS spacing rules
(`.content-body > * + * { margin-top: 1.1rem }`) keep working exactly as before.

### 1.4 Per-block-type payload summary and allowed types (§B.3, §B.4)

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

The complete allowed list after this change is exactly:

```
heading | paragraph | list | quote | callout | image | divider | table
```

`BLOCK_TYPES` in `backend/app/services/sanitize.py` becomes exactly that set. Unknown block
types are no longer deleted — see §1.10.

### 1.5 Image model (§B.5)

```jsonc
{
  "type": "image",
  "src": "/uploads/photo.jpg",       // EXISTING — required, safe_url()-restricted
  "alt": "A patient in an MRI room", // EXISTING
  "width": 60,                       // OPTIONAL, % of the block's content width, 1–100
  "height": 240,                     // OPTIONAL, px, 1–4000
  "align": "center",                 // OPTIONAL: "left" | "center" | "right"
  "fit": "cover",                    // OPTIONAL: "cover" | "contain" | "fill"
  "radius": 12,                      // OPTIONAL, px, 0–64
  "layout": { /* … */ }              // OPTIONAL
}
```

| Key | Type | Range | Effective default | Notes |
|---|---|---|---|---|
| `width` | number | 1–100 | 100 % | **percent of the block’s content box**, not px — keeps it responsive. `image.width` × `layout.width` = width of the column. |
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

### 1.6 Table model (§B.6)

The table payload is a nested `table` object, matching the nested `layout` object so that every
block has the shape `{ type, layout?, <type payload> }`.

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
5. `header` present but empty (`[]`) → treated as “no header row”; the `<thead>` is not rendered.

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
- The layout styles are applied to the **wrapper** (it is the table block’s root element).
- Every `<th>`/`<td>` gets an explicit `text-align` from `table.align[columnIndex]`, defaulting to
  `left`. `layout.textAlign` never reaches the cells.
- Cells with `\n` render as multiple lines (`<br>` in HTML, `<br/>` in JSX).
- The table is horizontally scrollable on narrow viewports — this is the responsive behaviour
  (never a fixed-width table).

### 1.7 Callout model (§B.7)

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

| Key | Type | Range | Effective default |
|---|---|---|---|
| `variant` | string | `info` \| `warn` \| `ok` \| `bad` \| custom slug `^[a-z][a-z0-9_-]{0,31}$` | `info` |
| `label` | string | ≤ 200 chars | per-variant default label (below) |
| `backgroundColor` | string | hex colour | `#eef6ff` |
| `textColor` | string | hex colour | `#243447` |
| `borderColor` | string | hex colour | `#b8cce0` |
| `shape` | string | the five values above | `rounded` |

**Default label per variant** (identical strings in both frontends):
`info` → `Information`, `warn` → `Warning`, `ok` → `Good to know`, `bad` → `Important`,
any custom variant → `Custom callout`. An explicitly stored `label` always wins.

**Custom variants must survive.** A custom variant is kept (lowercased) when it matches
`^[a-z][a-z0-9_-]{0,31}$`; otherwise it falls back to `info`. The variant slug is interpolated
into a CSS class name (`.pv-callout-{variant}` / `.content-callout--{variant}`), so the strict
slug regex is also the CSS-injection guard.

**Rendering parity (normative).** The site reproduces the admin’s callout inline style
*verbatim* — same padding (`18px` for `circle`, otherwise `16px 20px`), same
`border: 1px solid <borderColor>`, same `margin: 12px 0`, same `borderRadius` per shape, same
`boxSizing`, `overflowWrap`, `whiteSpace`, and the same colours. The site emits:

```html
<div class="content-callout content-callout--{variant} content-callout-shape-{shape}" role="note" style="{…}">
  <span class="content-callout__label">{label}</span>
  <div class="content-callout__text">{text}</div>
</div>
```

`layout.marginTop` / `layout.marginBottom` override the callout’s `margin: 12px 0` (the layout
longhands are merged after the shorthand, so they win).

**Shape → layout / border-radius / padding (exact values; these are the values already in
`frontend/src/components/BlockRenderer.tsx` and must not be “improved”):**

| `shape` | `display` / `width` | `borderRadius` | `padding` |
|---|---|---|---|
| `rectangle` | `block` / `100%` | `6px` | `16px 20px` |
| `rounded` | `block` / `100%` | `16px` | `16px 20px` |
| `square` | `block` / `100%` | `0` | `16px 20px` |
| `oval` | `inline-block` / `fit-content`, `maxWidth: 100%` | `9999px` | `16px 20px` |
| `circle` | `inline-flex` / `160px`, `minHeight: 160px`, `aspectRatio: 1 / 1`, centred | `50%` | `18px` |

`rectangle` and `square` share a box model but differ in corner radius; `oval` and `circle`
differ in box model. They are distinct stored values; do not collapse them in the sanitiser or the
editor.

**Legacy/admin note (R15):** the admin already applies the inline callout style to *every*
callout, including legacy ones. Keep that behaviour exactly, so no existing admin preview changes.
The **site** keeps its variant CSS for callouts that have none of `label`,
`backgroundColor`, `textColor`, `borderColor`, `shape` or `layout`; a callout with **any** of
those keys gets the full inline style below. This is the only intentional admin/site difference
for legacy content.

### 1.8 Shared helper `blockDesign.ts` (§B.8)

Both apps add `src/lib/blockDesign.ts`, **byte-identical**. It is pure, has no React imports, and
exports exactly:

```ts
export const CALLOUT_SHAPES = ["rectangle", "rounded", "square", "oval", "circle"] as const;
export type CalloutShape = (typeof CALLOUT_SHAPES)[number];

export const CALLOUT_SHAPE_STYLES: Record<CalloutShape, CSSProperties>;
export function calloutLabel(variant: string): string;
export function tableColumnCount(table: BlockTable): number;
export function layoutToCss(layout?: BlockLayout): CSSProperties;
```

Implementation requirements:

- `CALLOUT_SHAPE_STYLES` holds the exact five rows in §1.7 (including `display`, `width`,
  `maxWidth`, `padding`, `borderRadius`, and the circle layout keys). It is spread **before** the
  colour/border/margin keys in both callout renderers.
- `calloutLabel` lowercases the variant and maps `info`, `warn`, `ok`, `bad`; anything else returns
  `"Custom callout"` (R6). It never returns an empty string.
- `tableColumnCount` returns `table.header && table.header.length > 0 ? table.header.length : Math.max(0, ...table.rows.map(r => r.length))`.
  An empty table returns `0`; `header: []` falls back to the rows (R4).
- `layoutToCss` returns `{}` for `undefined`, and otherwise emits **only the keys that are
  present** using the mapping table in §1.3, including the effective-width clamp. Never emit
  `undefined` values. Never emit a default for an absent key.
- Use `import type { CSSProperties } from "react";` so the file stays identical across apps.
- No other exports. The file must not import from `../api/types` (that would create a runtime
  cycle); reference the types with `import type { BlockTable, BlockLayout } from "../api/types";`.
  These types live in the canonical block, so they are identical in both apps.

### 1.9 Admin editor requirements (§B.8)

The editor is an **inline design panel per block**, opened from the existing block toolbar. The
existing content editing controls stay where they are; the panel adds only the new controls.

- A “Design” toggle (`aria-expanded`, button text `Design` / `Hide design`) reveals a `<details>`
  panel below the block’s content controls. It does not replace the content controls.
- Panel fields, in this order:
  1. **Layout:** align select (`—` / left / center / right / justify), width slider 0–100, offset
     slider -100–100, top/bottom margin number inputs 0–200, background/border colour inputs
     (`<input type="color">` plus “clear”), border width 0–8, border style select (none/solid/
     dashed/dotted), radius 0–64, padding 0–64.
  2. **Image:** width slider 1–100, height number 1–4000 (empty = auto), align select, fit select,
     radius 0–64.
  3. **Callout:** label text input (placeholder = the variant’s default label), background/text/
     border colour inputs, shape select with the five labels.
  4. **Table:** a compact grid editor — add/remove column, add/remove row, header row toggle,
     per-cell text inputs, per-column align selects, header background/text colours, bordered and
     striped checkboxes.
- Every control writes through the existing immutable block update pattern:
  `onChange({ ...block, layout: nextLayout })` where `nextLayout` is built by copying and then
  **deleting** keys the author clears. Never write `undefined`, `null`, `0`-as-absent, or an empty
  `layout` object. `layoutToCss`-style clean-up:
  `const next = { ...layout }; delete next.width;` (or `delete (next as any).width`).
- When the last layout key is removed, delete the whole `layout` key. Same for `table` only when
  the author removes the last row **and** clears the header (otherwise keep `table` with
  `rows: []` per R13).
- The panel must be usable at 360 px wide (single column) and must not add horizontal scroll to
  the editor page.
- Table editor limits mirror the sanitiser: stop “Add column” at 50, “Add row” at 200, and set
  `maxLength={2000}` on every cell input. Disable (not hide) the buttons at the limits and show a
  short hint.
- Colour inputs: the `<input type="color">` cannot be empty. Pair it with a text input
  (`#rrggbb`, `maxLength={7}`) and a “Clear” button. Only a valid `#rgb`/`#rrggbb` value is
  written; text is normalised to lowercase `#rrggbb`. Invalid text never updates the block.
- Number inputs: `min`/`max`/`step` exactly as §1.3/§1.5. Empty input means “delete the key”.
  Values are clamped client-side too (`clamp(value, min, max)`); the backend is still the
  authority.
- `PageEditorPage` gains **two checkboxes, admin only**: `is_homepage` (“Use as homepage for this
  language”) and `featured` (“Featured”). They are rendered only when `user?.role === "admin"`.
  Volunteer payloads must omit the keys entirely (not send `false`). This matches the existing
  admin-only PATCH behaviour (R22).
- No drag/drop, no absolute positioning, no nested design panels, no live preview pane. The
  existing preview is enough.

### 1.10 Sanitiser rules (§C)

`backend/app/services/sanitize.py` is the security boundary. It must remain defence-in-depth:
even if a malicious client bypasses the UI, stored JSON must be safe.

- `BLOCK_TYPES = {"heading", "paragraph", "list", "quote", "callout", "image", "divider", "table"}`.
- `sanitize_content()` keeps handling `home-v1` exactly as today (fields, `heroImage`,
  `heroSecondaryImage` via `safe_url`, `_clean_text`).
- For `blocks-v1`, `_sanitize_block()` keeps the existing validation for legacy keys and adds the
  new validators. It must **copy unknown keys through** (`out[k] = _sanitize_extra(k, v)`), except
  for a documented denylist: `__proto__`, `constructor`, `prototype`, `dangerouslySetInnerHTML`,
  `className`, `style`, `on*` keys, and `type`/`layout`/new payload keys which have their own
  validators. Extra keys are deep-sanitised: strings through `_clean_text`, lists/dicts
  recursively, at most 8 levels deep and at most 200 keys per object; anything else becomes a
  string.
- Unknown **block types** are preserved as `{"type": "<slug>", "layout"?: …, …clean payload…}` with
  max 50 keys, or dropped if `type` is not a string matching `^[a-z][a-z0-9_-]{0,31}$`. They are
  rendered as the unknown-block placeholder (§1.12) — never as HTML.
- `_hex_color(value)`: accepts `#rgb` or `#rrggbb`, case-insensitive; returns lowercase `#rrggbb`
  (expanding `#abc` → `#aabbcc`); returns `None` for anything else. Never raises.
- `_int_in(value, lo, hi)`: accepts ints and numeric strings (`" 12 "` → 12); rejects bools,
  floats with a fractional part, NaN/inf; clamps to `[lo, hi]`. `None` means “absent” and is not
  written.
- `_enum(value, allowed)`: lowercases strings; returns `None` if not allowed.
- `_bool(value)`: accepts real bools, `0`/`1`, `"true"`/`"false"`; returns `None` otherwise.
- `_slug(value)`: `^[a-z][a-z0-9_-]{0,31}$` after lowercasing; returns `None` otherwise.
- `_string_list(value, max_items, max_chars)`: list of strings; each through `_clean_text` then
  truncated to `max_chars`; non-list → `None`.
- `_table_payload(value)`: implements §1.6 normalisation. `rows` non-list → `[]`; each row must
  be a list of strings (non-strings are coerced with `str()` then cleaned); pad/truncate to the
  column count; `header` non-list → absent; `align` only `left|center|right`. `bordered`/`striped`
  only when present. **Do not materialise defaults.**
- `MAX_BLOCK_BYTES = 262_144` (256 KiB). After sanitising a block, serialise with
  `json.dumps(block, ensure_ascii=False)`. If it exceeds the cap: for a table, drop rows from the
  end until it fits (keeping the header); if it still does not fit (or it is not a table), drop
  the block. This is R14. The existing overall content cap in `sanitize_content` stays as-is and
  is checked after block-level truncation.
- The function still returns the same top-level `{"format": ..., ...}` shape and never mutates
  its input.

**Legacy-output guarantee (§2.9).** For every block that has no new keys, the sanitised output
must be equal to the current implementation’s output **including key order** after
`json.dumps(..., sort_keys=True)`. The new code must not add `layout: {}`, `table: {...defaults}`,
`label`, image defaults, or reorder existing keys. Tests in §2.12 enforce this with frozen
fixtures.

### 1.11 Sanitiser order of operations (deterministic)

1. Validate `type` (string). If unknown, build a preserved unknown block or drop it (§1.10).
2. Switch on the known type and rebuild the **existing** payload keys using the existing code.
3. Validate `layout` (if present) and attach it **after** the legacy keys, only if at least one
   valid key remains.
4. Validate the type’s new payload (`image` sizing; `callout` design; `table`) and attach it.
5. Deep-copy-preserve extra keys not already written.
6. Enforce `MAX_BLOCK_BYTES`, then append to the output list.

This ordering matters: layout is always the last legacy key group, so a legacy block’s key order
is unchanged and new keys appear after it. Both frontends access by key, never by iteration order,
so this is safe.

### 1.12 Derived text and HTML (§C.4)

`backend/app/services/content_text.py`:

- `_block_text()` adds a table branch: header cells, then every row cell, joined with `" "` (the
  existing whitespace-collapsing code collapses runs). Empty cells are skipped.
- Callout `_block_text()` includes `label` alongside `text` when present (the existing generic
  `label` loop already does this; keep it).
- Image blocks contribute only `alt` (unchanged). Divider contributes nothing (unchanged).

`backend/app/services/sanitize.py::blocks_to_html()` (export/preview only; not the public site):

- table → the same `<div class="content-table-wrap"><table class="content-table …">` shape as
  the site, with escaped text and `\n` → `<br>`; **no** inline layout styles.
- callout → include `label` as a `<strong>` prefix when present (escaped).
- image → apply width/height/align/fit/radius as inline styles (escaped numbers only).
- layout → **not applied** in export HTML (keeps export deterministic and independent of the
  designer).
- unknown block → skip (no HTML), and `_block_text` extracts nothing from it.
- HTML output is escaped with `html.escape`. Do not pass author strings through
  `bleach.clean(..., tags=...)` in `blocks_to_html` (that is the sanitiser’s job); escape instead.

### 1.13 Homepage flag and deterministic fallback (§C.5, §C.6, §C.7)

- `PageUpdate` restores:

```python
is_homepage: Optional[bool] = None
featured: Optional[bool] = None
```

  The route already uses `.dict(exclude_unset=True)`, so omitted keys stay omitted and an explicit
  `false`/`null` is distinguishable from “not sent”. Do not add validator logic that turns `None`
  into `False` in the API layer.
- `CRUDPage` gains:

```python
def _unset_other_homepages(self, db: Session, *, lang: str, keep_id: Optional[int]) -> None:
    q = db.query(Page).filter(Page.lang == lang, Page.is_homepage.is_(True))
    if keep_id is not None:
        q = q.filter(Page.id != keep_id)
    q.update({Page.is_homepage: False}, synchronize_session=False)
```

  Call it **after** the create/update has a concrete `id` and **only when** the incoming
  `is_homepage` is `True` (`is not None and is_homepage is True`); never when it is `False` or
  absent. Wrap create/update + unset in the existing transaction style (the routes commit; the
  CRUD must not add a second commit).
- `routes/public.py` homepage fallback becomes deterministic:

```python
page = (
    db.query(Page)
    .filter(Page.status == "published", Page.lang == lang, Page.is_homepage.is_(True))
    .order_by(Page.position.asc(), Page.created_at.asc(), Page.id.asc())
    .limit(1)
    .scalars()
    .first()
)
```

  If none, keep the existing oldest-published fallback, also ordered by
  `position.asc(), created_at.asc(), id.asc()`. Do not change the response schema. Do not touch
  `live_content` (F.7).

### 1.14 Ambiguity resolutions — the numbered decisions

These are normative. Tests reference them. If an implementer disagrees, they still implement
these and raise it in review; the spec is the tiebreaker.

| # | Ambiguity | Resolution |
|---|---|---|
| **R1** | `layout.borderWidth` set but `borderStyle` absent | Emit `borderWidth` only; **do not** synthesise `solid` in storage or CSS. The browser’s initial `border-style` is `none`, so nothing appears until the author picks a style. Editor shows `solid` as the **placeholder**, not as a stored value. |
| **R2** | Table defaults (`bordered`, colours, align) | Renderer-level only. Storage keeps only keys the author set. Absent `bordered` renders bordered (default `true`); absent `striped` renders not striped. |
| **R3** | `table.align` shorter/longer than columns | Pad with `"left"`, truncate. Never omit per-cell `text-align`; every cell gets an explicit value. |
| **R4** | `header: []` | Preserve as `[]` if it was explicitly sent, but render **no** `<thead>` (`len(header) === 0`). Do not delete the key in the sanitiser. |
| **R5** | `table` missing / `rows` missing / non-list | Normalise to `{ "table": { "rows": [] } }` (R13). The block still renders as an empty table wrapper, not the unknown placeholder. |
| **R6** | Custom callout label | Default `"Custom callout"`, never the raw slug and never a per-slug CSS label. An explicit `label` wins, including an explicit empty string (which renders no label element). |
| **R7** | Empty `label: ""` | Stored if explicitly sent; renderer omits the label element entirely when `label === ""` after trim. Do not inject the variant default in that case. |
| **R8** | Numeric strings / floats | Numeric strings accepted for numbers (`"12"`, `" 12 "`); floats with a fractional part rejected as if absent; clamp in range. Booleans are not numbers. |
| **R9** | Enum/colour case | Enums lowercased; hex colours lowercased and expanded to 6 digits. `#ABC` → `#aabbcc`. Invalid colour → key omitted (not black). |
| **R10** | Empty `layout` object | Dropped entirely (`{}` is not stored). Same for a `layout` whose every key is invalid/absent. |
| **R11** | `_clean_text` idempotency | Fixed-point `html.unescape` (≤ 10 iterations) **before** `bleach.clean`; then clean. This makes `sanitize(sanitize(x)) == sanitize(x)` for encoded entities without changing plain text. Keep the existing `bleach.clean` arguments. |
| **R12** | Conflicting `layout.width` and `image.width` | They multiply: the figure gets `layout.width` of the column; the image gets `image.width` of the figure’s content box. Neither overrides the other. |
| **R13** | Empty table rows | Keep `table.rows: []`; render the empty `<table>`/wrapper (with header if present). Do not turn the block into `paragraph` or the unknown placeholder. |
| **R14** | Huge table/block | 256 KiB per-block cap; truncate table rows from the end first; drop the block if still too big. Never truncate mid-JSON-string. |
| **R15** | Callout variants vs designed callouts | **Compatibility carve-out:** a callout with **only** `variant` + `text` (no `label`, no design keys, no `layout`) renders exactly as today on **both** apps, using the existing per-variant CSS. A callout with any design key renders the full B.7 inline style. The site must not change legacy callout colours/spacing. |
| **R16** | Contract names two test files | Canonical pure-function tests live in `backend/tests/test_content_schema.py`. `backend/tests/test_sanitize_schema.py` is a 3-line shim: `from tests.test_content_schema import *  # noqa: F401,F403` (plus a module docstring explaining the alias). This satisfies both names without duplicating tests. |
| **R17** | Image `fit` default | Only `cover` when `height` is set AND `fit` absent. If no height, emit no `object-fit` (preserve legacy natural rendering). |
| **R18** | Newlines in table cells | Preserved by `_clean_text`; render `<br>` / `<br/>`. Do not collapse to spaces. |
| **R19** | Width + offset overflow | `effectiveWidth = min(width, max(0, 100 - abs(offsetX)))` in both renderers. Storage keeps the author’s raw `width`/`offsetX`. |
| **R20** | Unknown block rendering | A neutral placeholder: dashed bordered box, muted text `Unsupported block type: <type>`, `role="note"`, no raw payload, no HTML. Same text/classes in both apps (`pv-unknown-block` / `content-unknown-block`). |
| **R21** | Site heading levels | Preserve legacy: the site renders `heading.level` but never below `<h2>` (min level 2). Admin renders the stored level 1–4 as-is. This is an existing site rule; do not change it. |
| **R22** | Homepage/featured permissions | Admin-only UI **and** admin-only API. Volunteers never see the controls and never send the keys; the backend rejects a non-admin create/PATCH that contains `is_homepage` or `featured` with **403** (§2.14.1). The CRUD layer does not repeat the role check — the route owns authorisation. |
| **R23** | Where to unset other homepages | In `CRUDPage` create/update, not in the route and not in the model. One helper, called once. |
| **R24** | Non-string table cells | Coerce with `str()` only for scalars; `None` → `""`; nested list/dict → `"[invalid cell]"` before cleaning. Never `json.dumps` arbitrary structures into a cell. |
| **R25** | `table` + `layout.textAlign` | Applies to the wrapper only; never to `<th>`/`<td>`. Cell alignment comes from `table.align` (R3). |
| **R26** | HTML export class prefix | `blocks_to_html` always uses `content-*` (the public/export prefix), never `pv-*`, even when called from the admin app. |
| **R27** | `home-v1` and new fields | Untouched. `home-v1` content renders via the existing template; no new fields are read. A `home-v1` page that is also `is_homepage` still works. |
| **R28** | Public content source | Keep serving `page.content`, not `live_content` (F.7). Do not add a flag. |
| **R29** | Bad `layout` shape (string/array) | Treat as absent; do not raise; do not preserve. Same for bad `table` shape. |
| **R30** | Editor “clear” semantics | Clearing a control deletes its key; it never writes `0`, `""`, `false`, or a default. The only exception is a table, which keeps `rows: []` (R13) and a callout with an explicit empty label (R7). |

## 2. BACKEND — exact changes

**Files:** `backend/app/services/sanitize.py`, `backend/app/services/content_text.py`,
`backend/app/schemas/page.py`, `backend/app/crud/crud_page.py`,
`backend/app/api/v1/routes/pages.py` (flag guard only — §2.14),
`backend/app/api/v1/routes/public.py`, plus the three test files in §0.1.
**Do not change anything else** in `routes/pages.py`: it already forwards
`PageUpdate.dict(exclude_unset=True)` into `crud_page.update`, and `_changed()` only inspects
title/slug/group/content, which is exactly right — a homepage-only change is not a content
revision.

### 2.1 `sanitize.py` — imports, constants, helpers

Add `from sqlalchemy`? No — `sanitize.py` must stay free of DB imports. Add only stdlib:
`import json`, `import math` (for finite checks), and `Iterable`/`Tuple` as needed.

Module constants:

```python
BLOCK_TYPES = {"heading", "paragraph", "list", "quote", "callout", "image", "divider", "table"}
CALLOUT_VARIANTS = {"info", "warn", "ok", "bad"}          # kept for legacy fallback docs
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
```

Helper contracts (all pure, all return `None` for “absent/invalid”):

```python
def _clean_text(value: Any, limit: int = MAX_TEXT) -> str:
    # 1. value None -> ""
    # 2. text = str(value)
    # 3. fixed-point html.unescape: repeat up to 10 times while it changes
    # 4. bleach.clean(text, tags=[], attributes={}, strip=True)
    # 5. remove "\x00"; return text[:limit]
```

The fixed-point loop is the R11 fix. Keep the existing `bleach.clean` arguments and the
`\x00` removal. Do not call `html.unescape` after bleach (that would reintroduce entities).

```python
def _hex_color(value: Any) -> str | None
def _int_in(value: Any, lo: int, hi: int) -> int | None
def _bool_or_none(value: Any) -> bool | None
def _enum(value: Any, allowed: set[str]) -> str | None
def _slug(value: Any) -> str | None
def _string_list(value: Any, *, max_items: int, max_chars: int) -> list[str] | None
def _clean_row(value: Any) -> list[str]        # see R24
def _sanitize_extra(value: Any, depth: int = 0) -> Any
def _sanitize_layout(value: Any) -> dict | None
def _sanitize_table(value: Any) -> dict | None
def _sanitize_image_fields(block: dict, out: dict) -> None
def _sanitize_callout_fields(block: dict, out: dict) -> None
```

Exact helper behaviour:

- `_hex_color`: `str(value).strip()`, require `^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`; expand
  3-digit; lowercase. Anything else (including named colours, `rgb()`, `#ffff`, empty) → `None`.
- `_int_in`: reject `bool` explicitly (`isinstance(value, bool)` → `None`); accept `int`; accept
  `float` only when `.is_integer()` and finite; accept `str` when `int(s.strip())` succeeds;
  then clamp `lo..hi`. `None`/empty string → `None`.
- `_bool_or_none`: `True`/`False` → themselves; `0`/`1` (int, not bool) → bool; strings
  `"true"/"false"` case-insensitive → bool; else `None`.
- `_enum`: `str(value).strip().lower()` and membership; no aliases. **Callout variant is the one
  exception:** if valid slug (custom) keep it, else `"info"`; see §2.5.
- `_string_list`: only `list`/`tuple`; clean each scalar through `_clean_text(..., max_chars)`;
  drop `None`; cap at `max_items`. A string input is **not** split (the legacy `list.items`
  branch keeps its own string-splitting behaviour).
- `_clean_row`: only a list/tuple is a valid row; each element: `None` → `""`; `str`/`int`/
  `float`/`bool` → `_clean_text(str(v), MAX_CELL_CHARS)`; nested list/dict → `"[invalid cell]"`;
  cap row at `MAX_TABLE_COLS`; pad later. Non-list row → skip (do not turn it into one cell).
- `_sanitize_extra`: strings → `_clean_text`; bool/int/float/None → as-is; list → recurse first
  200 items; dict → recurse first 200 keys, string keys only, skip the global denylist; depth > 8
  → `None`. Never call `setattr`; return plain data.
- Denylist for extra keys: `{"__proto__", "constructor", "prototype", "dangerouslySetInnerHTML",
  "className", "style"}` plus any key whose lowercase form starts with `on`. This is checked at
  every dict level.

### 2.2 `_sanitize_block()` — exact control flow

Rewrite it, preserving the legacy branches verbatim where possible:

```python
def _sanitize_block(block: Any) -> Dict[str, Any] | None:
    if not isinstance(block, dict):
        return None
    btype = str(block.get("type", "")).strip().lower()

    if btype in KNOWN:                    # existing branches below
        ...
    else:
        out = _sanitize_unknown_block(block, btype)
        return out                     # may be None
```

Known branches:

- `heading`: unchanged (`level` int clamp 1–4, `text`).
- `paragraph`: unchanged.
- `list`: unchanged, including the legacy `items` string split by `"\n"` and `MAX_ITEMS`.
- `quote`: unchanged (`text`, optional `cite` only when non-empty).
- `callout`:
  ```python
  variant = _slug(block.get("variant")) or "info"   # custom slugs survive; invalid -> info
  out = {"type": "callout", "variant": variant, "text": _clean_text(block.get("text"))}
  _sanitize_callout_fields(block, out)              # sets variant again (same value) + new keys
  ```
  Do **not** use the legacy `variant not in CALLOUT_VARIANTS → info` coercion here; that would
  delete custom variants. The `_slug` regex is the only variant gate.
- `image`: existing `src = safe_url(...)`; if no `src` return `None`; `alt`; then
  `_sanitize_image_fields(block, out)`.
- `divider`: `{"type": "divider"}`.
- `table`: build `{"type": "table"}`; `table = _sanitize_table(block.get("table"))`; attach only
  when the author supplied a `table` key. If `table` is missing/invalid, attach
  `{"rows": []}` (R5/R13). Then extras/layout.

After the type-specific payload (and **before** extras), attach layout:

```python
layout = _sanitize_layout(block.get("layout"))
if layout:
    out["layout"] = layout
```

Then merge extras:

```python
reserved = {"type", "layout"} | KNOWN_PAYLOAD_KEYS[btype]
for k, v in block.items():
    if not isinstance(k, str) or k in reserved or _is_denied_key(k):
        continue
    if len(out) >= 50 + len(reserved):     # hard bound
        break
    out[k] = _sanitize_extra(v)
```

`KNOWN_PAYLOAD_KEYS` = `{"heading": {"level","text"}, "paragraph": {"text"}, "list":
{"ordered","items"}, "quote": {"text","cite"}, "callout": {"variant","text","label",
"backgroundColor","textColor","borderColor","shape"}, "image": {"src","alt","width","height",
"align","fit","radius"}, "divider": set(), "table": {"table"}}`.

**Ordering:** legacy keys first (in their current order), then `layout`, then new payload keys,
then extras. For callout/image the new payload is attached **after** layout per §1.11; for table
the payload exists before layout, so the final order is `type, table, layout`. Key order is not
semantic; the legacy-order test uses legacy blocks only.

### 2.3 `_sanitize_layout()`

```python
def _sanitize_layout(value: Any) -> dict | None:
    if not isinstance(value, dict):
        return None
    out = {}
    # each assignment only if the helper returns a non-None value
    # textAlign -> TEXT_ALIGNS, width/offsetX/margins/borderWidth/radius/padding -> _int_in
    # backgroundColor/borderColor -> _hex_color
    # borderStyle -> BORDER_STYLES
    return out or None
```

Exact ranges: `width 0–100`, `offsetX -100–100`, `marginTop/Bottom 0–200`,
`borderWidth 0–8`, `borderRadius 0–64`, `padding 0–64`. Note: `width: 0` is a legitimate stored
value (unlike absent); `_int_in` returns `0`, and the `if is not None` check keeps it.

### 2.4 `_sanitize_image_fields()`

```python
width = _int_in(block.get("width"), 1, 100)
height = _int_in(block.get("height"), 1, 4000)
align = _enum(block.get("align"), IMAGE_ALIGNS)
fit = _enum(block.get("fit"), IMAGE_FITS)
radius = _int_in(block.get("radius"), 0, 64)
# attach each only when not None
```

`height: 0` is invalid (1–4000), so it is treated as absent. `radius: 0` is stored. Do **not**
add `fit: "cover"` when only `height` is present — that is a renderer default (R17), not storage.

### 2.5 `_sanitize_callout_fields()`

```python
variant = _slug(block.get("variant")) or "info"
# NOTE: built-in variants are valid slugs, so this accepts info/warn/ok/bad/custom.
out["variant"] = variant          # replaces the legacy branch's value
label = _clean_text(block.get("label"), 200) if "label" in block else None
if label is not None:
    out["label"] = label          # explicit "" is preserved (R7)
for key, helper in (("backgroundColor", _hex_color), ...):
    v = helper(block.get(key))
    if v is not None:
        out[key] = v
shape = _enum(block.get("shape"), CALLOUT_SHAPES)
if shape is not None:
    out["shape"] = shape
```

**Variant compatibility:** the legacy branch currently coerces unknown variants to `info`. The
new branch must **not** do that for valid custom slugs. `_slug` lowercases. Invalid variant
(e.g. `"Info!"`, `"../../x"`) → `info`. Built-in variants stay exactly `info|warn|ok|bad`.

### 2.6 `_sanitize_table()`

```python
def _sanitize_table(value: Any) -> dict | None:
    if not isinstance(value, dict):
        return None
    out: dict[str, Any] = {}
    if "header" in value:
        header = _string_list(value.get("header"), max_items=MAX_HEADER_CELLS,
                              max_chars=MAX_CELL_CHARS)
        if header is not None:
            out["header"] = header          # explicit [] preserved (R4)
    raw_rows = value.get("rows")
    rows = []
    if isinstance(raw_rows, list):
        for row in raw_rows[:MAX_TABLE_ROWS]:
            cleaned = _clean_row(row)
            if cleaned is not None:
                rows.append(cleaned)
    out["rows"] = rows                      # always present (R13)

    cols = len(out.get("header") or [])
    if cols == 0:
        cols = max((len(r) for r in rows), default=0)
    for i, row in enumerate(rows):
        rows[i] = (row + [""] * cols)[:cols]
    if cols:
        aligns = _string_list(value.get("align"), max_items=MAX_TABLE_COLS, max_chars=16) or []
        aligns = [
            a.strip().lower() if a.strip().lower() in {"left", "center", "right"} else "left"
            for a in aligns
        ]
        aligns = (aligns + ["left"] * cols)[:cols]
        # store align only if the author supplied it; padded values are renderer defaults
        if "align" in value:
            out["align"] = aligns
    for key in ("headerBackgroundColor", "headerTextColor"):
        v = _hex_color(value.get(key))
        if v is not None:
            out[key] = v
    for key in ("bordered", "striped"):
        v = _bool_or_none(value.get(key))
        if v is not None:
            out[key] = v
    return out
```

- `cols == 0` with `rows: []` is valid; keep `{"rows": []}`.
- If `header` is longer than 50 → truncated to 50 by `_string_list`. If a row is longer than the
  column count → truncated. If rows are longer than the header → truncated to header length.
- If `align` is supplied but there are zero columns, store `[]` only if explicitly supplied.
- `bordered`/`striped` are `None` when absent → not stored (R2).

### 2.7 Unknown block types

```python
def _sanitize_unknown_block(block: dict, btype: str) -> dict | None:
    if not _SLUG_RE.match(btype):
        return None
    out = {"type": btype}
    for k, v in block.items():
        if k in ("type", "layout") or _is_denied_key(k):
            continue
        out[k] = _sanitize_extra(v)
        if len(out) > UNKNOWN_BLOCK_KEYS + 1:
            break
    layout = _sanitize_layout(block.get("layout"))
    if layout:
        out["layout"] = layout
    return out
```

Unknown keys are preserved and deep-sanitised (§1.10). They are **not** interpreted. They are
never rendered as HTML, only as the R20 placeholder. Do not preserve an unknown block whose
`type` is `""`, non-string-ish, or fails the slug regex.

### 2.8 `MAX_BLOCK_BYTES` enforcement

Add a helper used by `sanitize_content` after `_sanitize_block`:

```python
def _enforce_block_cap(block: dict) -> dict | None:
    if len(json.dumps(block, ensure_ascii=False, default=str)) <= MAX_BLOCK_BYTES:
        return block
    table = block.get("table") if block.get("type") == "table" else None
    if isinstance(table, dict):
        rows = table.get("rows")
        while isinstance(rows, list) and rows:
            rows.pop()
            if len(json.dumps(block, ensure_ascii=False, default=str)) <= MAX_BLOCK_BYTES:
                return block
    return None
```

Call it in the `sanitize_content` loop:

```python
sb = _sanitize_block(b)
if sb is not None:
    sb = _enforce_block_cap(sb)
if sb is not None:
    clean_blocks.append(sb)
```

The overall `MAX_BLOCKS` slice stays first. Do not change `sanitize_content`'s return shape for
either format. For `home-v1`, nothing changes except that its field values now use the
fixed-point `_clean_text`.

### 2.9 Legacy-output guarantee and golden fixtures

The legacy branches must not gain fields. In particular:

- `heading` still emits exactly `type, level, text`.
- `paragraph` exactly `type, text`.
- `list` exactly `type, ordered, items`.
- `quote` exactly `type, text` (+ `cite` only when non-empty).
- `callout` legacy input still emits exactly `type, variant, text` — **unless** it already had
  one of the new keys, which no legacy page has.
- `image` exactly `type, src, alt` for legacy input.
- `divider` exactly `type`.
- `sanitize(sanitize(x)) == sanitize(x)` for all fixtures (R11).

Write a parameterised golden test in `test_content_schema.py` that freezes the expected dicts
above and asserts equality. This is the regression net for the 2 099 seeded pages.

### 2.10 `content_text.py`

`_block_text()` currently already collects `text`, `alt`, `cite`, `items`, and
`title/caption/description/label`. Add:

```python
table = block.get("table")
if isinstance(table, dict):
    header = table.get("header")
    if isinstance(header, list):
        parts.extend(str(c) for c in header if c)
    for row in table.get("rows") or []:
        if isinstance(row, list):
            parts.extend(str(c) for c in row if c)
```

Callout label: the existing `label` loop already handles it, **but** move the table extraction
before the generic field loop or after — no semantic difference. Keep joining with `" "`; the
final `strip_html()` collapses runs. Do not include `layout` values, colours, `bordered`,
`striped`, `width`, `height`, `fit`, `radius`, or `shape` (decorative metadata must not pollute
search text). Do not add unknown-block payload text (unknown blocks contribute nothing, which is
consistent with “not rendered”).

`extract_clean_text` itself is unchanged.

### 2.11 `blocks_to_html()` (in `sanitize.py`)

This function is for export/preview, not the public site. Extend the existing loop:

- `table`:
  ```python
  table = b.get("table") or {}
  header = table.get("header") or []
  rows = table.get("rows") or []
  cols = len(header) or max((len(r) for r in rows), default=1)
  thead = ""
  if header:
      thead = "<thead><tr>" + "".join(f"<th>{html.escape(str(c))}</th>" for c in header) + "</tr></thead>"
  body = "<tbody>" + "".join(
      "<tr>" + "".join(f"<td>{html.escape(str(c)).replace(chr(10), '<br>')}</td>" for c in row) + "</tr>"
      for row in rows
  ) + "</tbody>"
  classes = "content-table" + (" content-table--bordered" if table.get("bordered", True) else "")
  out.append(f'<div class="content-table-wrap"><table class="{classes}">{thead}{body}</table></div>')
  ```
  (Use `html.escape`; `\n` → `<br>`; no inline styles.)
- `callout`: if `label` (non-empty after trim) prefix
  `<strong>{html.escape(label)}</strong> ` inside the existing `<p class="callout ...">`.
  Keep the legacy `<p class="callout {variant}">` shape so exports do not change for legacy
  callouts.
- `image`: add `style="width:{w}%;height:{h}px;border-radius:{r}px"` for present numeric fields,
  and `style="text-align:{align}"` on a wrapping `<figure>` when `align` is present. If only
  legacy fields exist, emit exactly the current `<img src alt>` (no wrapper). Escape all
  attributes.
- layout: do **not** apply layout styles in export HTML (keep it simple and deterministic). The
  inline styles above are the only new ones. R26: always use `content-*`.
- Unknown block: skip.

### 2.12 Schemas

In `backend/app/schemas/page.py`, add to `PageUpdate` after `lang` (order irrelevant):

```python
is_homepage: Optional[bool] = None
featured: Optional[bool] = None
```

Do **not** add them to `PagePublic`; they are already absent there and the public payload must not
gain flags. No other schema change.

### 2.13 CRUD homepage exclusivity (async)

Imports: `from sqlalchemy import update` (keep existing `select`, `func`, …).

```python
async def _unset_other_homepages(
    self, db: AsyncSession, *, lang: str, keep_id: UUID
) -> None:
    await db.execute(
        update(Page)
        .where(
            Page.lang == lang,
            Page.is_homepage.is_(True),
            Page.id != keep_id,
        )
        .values(is_homepage=False)
    )
```

`create()`:

```python
db.add(db_obj)
await db.flush()                                  # id is populated
if db_obj.is_homepage is True:
    await self._unset_other_homepages(db, lang=db_obj.lang, keep_id=db_obj.id)
await db.commit()
await db.refresh(db_obj)
```

`update()`:

```python
for field, value in update_data.items():
    setattr(db_obj, field, value)
db.add(db_obj)
if update_data.get("is_homepage") is True:
    await db.flush()
    await self._unset_other_homepages(db, lang=db_obj.lang, keep_id=db_obj.id)
await db.commit()
await db.refresh(db_obj)
```

Rules:

- Trigger only when the incoming value is exactly `True` (R23). Explicit `False` unsets this page
  only; absent does nothing.
- Compare after setting: if the page was already homepage `True` and the payload repeats `True`,
  running the unset is harmless (it excludes itself) and idempotent.
- The helper does not commit. The existing single commit per CRUD call stays.
- `synchronize_session` is not needed; no other `Page` objects are assumed loaded in that session.
- Do not touch `get_multi_filtered`’s homepage exclusion, `get_by_slug`, or the workflow methods.

### 2.14 Route guard for flags; public homepage determinism

#### 2.14.1 Admin-only `is_homepage` / `featured`

The existing `create_page` and `update_page` routes authenticate **any** active user, so adding
the fields to `PageUpdate` without a guard would let a volunteer set the homepage or featured
flag. R22 requires admin-only. Add these checks (and nothing else) in
`backend/app/api/v1/routes/pages.py`:

In `create_page`, before `data = page_in.dict()` is used:

```python
if user.role != "admin" and (page_in.is_homepage or page_in.featured):
    raise HTTPException(
        status_code=403,
        detail="Only admins can set is_homepage or featured",
    )
```

In `update_page`, immediately after `update_data = page_in.dict(exclude_unset=True)`:

```python
if user.role != "admin" and (
    "is_homepage" in update_data or "featured" in update_data
):
    raise HTTPException(
        status_code=403,
        detail="Only admins can change is_homepage or featured",
    )
```

This rejects even an explicit `false` from a volunteer (presence is the signal), which matches
the UI contract that volunteers omit the keys. Admins keep the existing permissions. Do not
change any other route logic, response model, or workflow guard.

#### 2.14.2 Deterministic public homepage

Replace only the fallback `select(...)` in `get_homepage`:

```python
result = await db.execute(
    select(crud_page.model)
    .where(
        crud_page.model.is_homepage.is_(True),
        crud_page.model.status == "published",
        crud_page.model.lang == lang,
    )
    .order_by(
        crud_page.model.position.asc(),
        crud_page.model.created_at.asc(),
        crud_page.model.id.asc(),
    )
    .limit(1)
)
page = result.scalars().first()
```

Keep the first attempt (`slug="home"`) unchanged. If the first attempt and the fallback both
miss, keep the 404. Do not add a `live_content` read (R28). No other file in `routes/public.py`
changes.

### 2.15 Pure-function test suite — `backend/tests/test_content_schema.py`

No database, no network. Import only:

```python
from app.schemas.page import PageUpdate
from app.services.content_text import extract_clean_text
from app.services.sanitize import (
    MAX_BLOCK_BYTES, blocks_to_html, sanitize_content,
)
```

Use small module-level helpers:

```python
def blocks(*items): return {"format": "blocks-v1", "blocks": list(items)}
def one(block): return sanitize_content(blocks(block))["blocks"][0]
def text(block): return extract_clean_text(blocks(block))
```

**Required tests (parametrise where noted).** Each name is a test function; group related
assertions but do not merge unrelated failure modes into one giant test.

| # | Test name | Input / assertion |
|---|---|---|
| 1 | `test_legacy_heading_unchanged` | `{"type":"heading","level":2,"text":"Hi"}` → exactly `{"type","level","text"}`, no `layout`. |
| 2 | `test_legacy_paragraph_unchanged` | exact dict. |
| 3 | `test_legacy_list_unchanged` | exact dict including `ordered=False`. |
| 4 | `test_legacy_list_string_items_split` | `items="a\nb"` → `["a","b"]` (existing behaviour). |
| 5 | `test_legacy_quote_unchanged` | no `cite` key when absent/empty; `cite` kept when present. |
| 6 | `test_legacy_callout_unchanged` | `variant=info,text` → exactly 3 keys; no label/design keys. |
| 7 | `test_legacy_image_unchanged` | exact 3 keys; no sizing keys. |
| 8 | `test_legacy_divider_unchanged` | exactly `{"type":"divider"}`. |
| 9 | `test_legacy_golden_roundtrip` | `sanitize(sanitize(x)) == sanitize(x)` for every fixture in tests 1–8. |
| 10 | `test_encoded_entities_idempotent` | `&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;`; output contains no `<script`, and second sanitise equals first (R11). |
| 11 | `test_ampersand_escaped_and_idempotent` | `"A & B"` → `"A &amp; B"` (existing `bleach` behaviour); `"&amp;"` → `"&amp;"`; second sanitise equals first. Do **not** assert that `&` is stored unescaped. |
| 12 | `test_layout_all_fields` | all 11 keys valid → all present, colours normalised, numbers clamped. |
| 13 | `test_layout_absent_not_materialised` | paragraph without `layout` has no `layout` key (R10/§B.0). |
| 14 | `test_layout_empty_dropped` | `layout: {}` and all-invalid layout → no `layout` key. |
| 15 | `test_layout_zero_width_kept` | `width: 0` stored as `0`, not dropped. |
| 16 | `test_layout_ranges` | `width: 101` → `100`; `offsetX: -101` → `-100`; `padding: 65` → `64`; negative margins → `0`. |
| 17 | `test_layout_numeric_strings` | `"12"` → `12`; `"12.5"` → absent; `True` → absent. |
| 18 | `test_layout_colors` | `#ABC` → `#aabbcc`; `red`/`#ffff`/`rgb(0,0,0)` → absent. |
| 19 | `test_layout_border_style_absent_no_solid` | `borderWidth: 3` only → `borderStyle` not stored (R1). |
| 20 | `test_image_sizing_valid` | `{src,alt,width:60,height:240,align:"center",fit:"contain",radius:12}` → all stored. |
| 21 | `test_image_defaults_not_stored` | `{src,alt}` → exactly 3 keys (R17). |
| 22 | `test_image_invalid_sizing` | width 0/101, height 0/4001, bad align/fit, radius 65 → keys absent; `src` invalid → block dropped. |
| 23 | `test_callout_legacy_not_upgraded` | legacy input gets no `label`/design keys (R15 data half). |
| 24 | `test_callout_design_fields` | label, 3 colours, shape stored; `shape="oval"` accepted. |
| 25 | `test_callout_custom_variant_preserved` | `variant="insurance-note"` stays; invalid `"Info!"` → `info`. |
| 26 | `test_callout_empty_label_preserved` | explicit `label: ""` stays `""` (R7). |
| 27 | `test_callout_shape_enum` | all five accepted; `"pill"` absent; uppercase `"ROUNDED"` → `rounded`. |
| 28 | `test_table_basic` | header + 2 rows preserved with values and no defaults (`bordered`/colours absent). |
| 29 | `test_table_pads_and_truncates_rows` | header 3 cols, row 1 cell → padded `["x","",""]`; 4-cell row → 3. |
| 30 | `test_table_align_padding` | `align:["center"]` with 3 cols → `["center","left","left"]`; invalid → `left`. |
| 31 | `test_table_header_empty_preserved` | `header: []` kept, `rows` intact (R4). |
| 32 | `test_table_missing_table_payload` | `{"type":"table"}` → `{"type","table":{"rows":[]}}` (R5/R13). |
| 33 | `test_table_non_list_rows_dropped` | rows `[["a"], "bad", {"x":1}]` → only `["a"]` row. |
| 34 | `test_table_cell_newlines_preserved` | `"a\nb"` stays; `extract_clean_text` collapses to `"a b"` (search text). |
| 35 | `test_table_cell_coercion` | `None→""`, `1→"1"`, `True→"True"`, nested list → `"[invalid cell]"` (R24). |
| 36 | `test_table_limits` | 51 header cells → 50; 201 rows → 200; cell 2001 chars → 2000. |
| 37 | `test_table_bools_and_colors` | `bordered:false`, `striped:"true"`, `headerBackgroundColor:"#EEE"` stored; bad bool absent. |
| 38 | `test_table_bytes_cap_truncates_rows` | build rows with large cells to exceed 256 KiB → rows dropped from end, header kept, output serialises ≤ cap (R14). |
| 39 | `test_unknown_block_preserved` | `{"type":"carousel","slides":[{"src":"x"}],"layout":{"width":50}}` → type/keys/layout preserved, text cleaned. |
| 40 | `test_unknown_block_invalid_type_dropped` | `type="Bad Type"` / `""` / non-string → block dropped. |
| 41 | `test_unknown_block_forbidden_keys` | `style`, `className`, `dangerouslySetInnerHTML`, `onclick` are not copied. |
| 42 | `test_extra_keys_on_known_block_preserved` | paragraph with `id:"x"` keeps `id`; `style` does not. |
| 43 | `test_content_text_table` | header and all cells appear in `extract_clean_text`; colours/widths do not. |
| 44 | `test_content_text_callout_label` | label + text both present; missing label still works. |
| 45 | `test_content_text_decorative_fields_excluded` | `layout`, `bordered`, `shape`, `fit`, `radius` values never appear. |
| 46 | `test_blocks_to_html_table` | `<div class="content-table-wrap"><table class="content-table">`, header/body cells escaped, `\n` → `<br>`. |
| 47 | `test_blocks_to_html_callout_label` | `<strong>Warning</strong>` prefix; legacy callout HTML otherwise unchanged. |
| 48 | `test_blocks_to_html_image_sizing` | width/height/radius/align emitted only when present; legacy `<img>` unchanged. |
| 49 | `test_blocks_to_html_escapes_xss` | text `"<script>alert(1)</script>"` (post-sanitise) never yields a script tag. |
| 50 | `test_page_update_flags` | `PageUpdate(is_homepage=True).dict(exclude_unset=True)` has the key; `PageUpdate().dict(exclude_unset=True)` does not. |
| 51 | `test_page_update_flags_false_explicit` | explicit `False` is present in `exclude_unset` output; distinguishes absent vs false. |
| 52 | `test_top_level_shape_unchanged` | non-dict → `{"format":"blocks-v1","blocks":[]}`; `home-v1` unchanged; >2000 blocks truncated. |

Use `pytest.mark.parametrize` for the legacy table (tests 1–8) and for layout/image/table range
cases. Do not assert on dict *ordering* except in `test_legacy_*` where the exact dict equality is
the guarantee. For the byte-cap test, assert `len(json.dumps(out, ensure_ascii=False)) <=
MAX_BLOCK_BYTES` and that `out["table"]["header"]` is still the original header.

### 2.16 Compatibility shim — `backend/tests/test_sanitize_schema.py`

Exactly this (R16), so both filenames from the contract exist and pytest collects the tests once:

```python
"""Compatibility alias: the canonical suite lives in test_content_schema.py."""

from tests.test_content_schema import *  # noqa: F401,F403
```

If the package-relative import fails when pytest is invoked from `backend/`, use the same import
form as the rest of the suite (`from test_content_schema import *`) — but check that it does not
double-collect. The acceptable outcome is: **the pure suite runs once, under the canonical file
name**, and `pytest --collect-only` lists `test_content_schema.py` plus a shim with no duplicate
node IDs. If duplication is unavoidable, keep the shim but mark it
`pytestmark = pytest.mark.skip(reason="alias")` — do **not** delete it; the contract names it.

### 2.17 DB-backed round-trip tests — `backend/tests/test_designer_roundtrip.py`

These tests need the local PG16 at `127.0.0.1:5433` with password `qwerty`. They **skip, not
fail**, when it is unreachable, so `pytest -q` remains green on a bare checkout.

```python
import os, uuid
import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.crud.crud_page import crud_page
from app.models.group import Group
from app.models.page import Page
from app.schemas.page import PageCreate, PageUpdate
from app.services.sanitize import sanitize_content

pytestmark = pytest.mark.asyncio

@pytest_asyncio.fixture
async def db():
    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:                       # noqa: BLE001
        await engine.dispose()
        pytest.skip(f"PostgreSQL not available: {exc}")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()

@pytest_asyncio.fixture
async def group(db):
    g = Group(id=uuid.uuid4(), name=f"spec-{uuid.uuid4().hex[:8]}", path=None, position=0)
    db.add(g)
    await db.commit()
    yield g
    # Delete pages first; revisions/contributors cascade from the Page relationship.
    pages = (await db.execute(select(Page).where(Page.group_id == g.id))).scalars().all()
    for p in pages:
        await db.delete(p)
    await db.delete(g)
    await db.commit()
```

Required DB tests:

1. **`test_roundtrip_all_new_blocks`** — `crud_page.create(PageCreate(... content=blocks))` with
   one of each block including a designed table/callout/image; assert the persisted
   `page.content` equals `sanitize_content(content)` and `page.content_text` contains the table
   cells + callout label. This proves the save path does not drop the new keys (the original bug).
2. **`test_roundtrip_update_keeps_new_fields`** — update a page with `PageUpdate(content=...)`;
   assert the new block fields survive and `content_text` is refreshed.
3. **`test_homepage_exclusive_on_create`** — create page A (en, `is_homepage=True`), then page B
   (en, `is_homepage=True`). Refresh A; assert `A.is_homepage is False`, `B True`. Create a
   Croatian homepage and assert English is untouched (language-scoped).
4. **`test_homepage_update_unsets_previous`** — create A and B both false; update A via
   `PageUpdate(is_homepage=True)`, then update B the same way; assert A false, B true.
5. **`test_homepage_explicit_false_does_not_unset_others`** — A true, B false; update B with
   `is_homepage=False`; assert A stays true.
6. **`test_public_homepage_fallback_deterministic`** — insert two published `is_homepage=True`
   pages with the same lang and **no `home` slug** (legacy duplicate state), different `position`
   and `created_at`; call the `get_homepage` coroutine directly with `lang="en", db=db` twice;
   assert both calls return the lower `position`, then lower `created_at`, then lower `id` (R23
   ordering). Clean up both pages.
7. **`test_public_page_serves_content_not_live`** — create a published page whose
   `content` and `live_content` differ; call `get_public_page` and assert the response’s
   `content` is `page.content` (R28/F.7). Do not change the production code to make this pass.

Notes:

- `PageCreate` also accepts `is_homepage`/`featured` (inherited from `PageBase`), so create-page
  tests can set them directly.
- `crud_page.create/update` commits internally. Do not wrap these tests in a transaction and
  expect rollback; use the unique group fixture cleanup.
- The `group` fixture must run after `db`; `pytest-asyncio` resolves this automatically.
- Never point these tests at production. `settings.DATABASE_URL` loads `backend/.env`; run pytest
  from `backend/` (AGENTS.md) so the `.env` is found.
- If `PageUpdate(is_homepage=True)` is passed to `crud_page.update` directly, it is a Pydantic
  model; the CRUD handles `.dict(exclude_unset=True)`. The route does the same.

8. **`test_volunteer_flags_forbidden`** — call the `update_page` route coroutine with
   `PageUpdate(is_homepage=True)` and a non-admin user; assert it raises `HTTPException(403)` and
   that the page’s `is_homepage` is unchanged (§2.14.1). Same for `create_page` with a
   non-admin and `is_homepage=True`. Use `pytest.raises(HTTPException)`.

These route tests need the DB (the guard reads `user.role` before touching the DB in the PATCH
case, but they still construct a real page). Keep them in the DB-backed file so the pure suite
stays DB-free.

### 2.18 Backend acceptance commands

```bash
cd backend
../.venv/bin/python -m pytest -q                       # includes skip when PG is down
../.venv/bin/python -m pytest -q tests/test_content_schema.py
../.venv/bin/python - <<'PY'
from app.services.sanitize import sanitize_content
x = {"format":"blocks-v1","blocks":[{"type":"table","table":{"header":["a"],"rows":[["b"]]}}]}
print(sanitize_content(x))
PY
```

The last command must print the table payload, not `{}`. This is the one-line proof that the
original allow-list bug is fixed.

## 3. ADMIN frontend — exact changes

**Files:** `frontend/src/api/types.ts`, `frontend/src/lib/blockDesign.ts` (new),
`frontend/src/components/BlockRenderer.tsx`, `frontend/src/pages/BlockEditor.tsx`,
`frontend/src/pages/PageEditorPage.tsx`, `frontend/src/index.css`.
**No changes** to `frontend/src/api/client.ts`, the router, auth, or the media picker.

### 3.1 Canonical TypeScript block — `frontend/src/api/types.ts`

Delete the current content-shape section from `export type HeadingLevel = 1 | 2 | 3 | 4;`
through `export type BlockType = Block['type'];` (inclusive) and replace it with the block below.
Keep everything before and after it (`PublicPage`, `BlocksContent`, `HomeContent`,
`isBlocksContent`, etc.) unchanged.

```ts
// [BEGIN CANONICAL BLOCK SCHEMA]
export type HeadingLevel = 1 | 2 | 3 | 4;

export type BlockAlign = 'left' | 'center' | 'right';
export type BlockTextAlign = BlockAlign | 'justify';
export type BlockImageFit = 'cover' | 'contain' | 'fill';
export type BlockBorderStyle = 'none' | 'solid' | 'dashed' | 'dotted';

export interface BlockLayout {
  textAlign?: BlockTextAlign;
  width?: number;          // 0–100
  offsetX?: number;        // -100–100
  marginTop?: number;      // 0–200
  marginBottom?: number;   // 0–200
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;    // 0–8
  borderStyle?: BlockBorderStyle;
  borderRadius?: number;   // 0–64
  padding?: number;        // 0–64
}

export interface BlockTable {
  header?: string[];
  rows: string[][];
  align?: BlockAlign[];
  headerBackgroundColor?: string;
  headerTextColor?: string;
  bordered?: boolean;
  striped?: boolean;
}

export type CalloutVariant = 'info' | 'warn' | 'ok' | 'bad' | (string & {});
export type CalloutShape = 'rectangle' | 'rounded' | 'square' | 'oval' | 'circle';

export interface HeadingBlock {
  type: 'heading';
  level: HeadingLevel;
  text: string;
  layout?: BlockLayout;
}
export interface ParagraphBlock {
  type: 'paragraph';
  text: string;
  layout?: BlockLayout;
}
export interface ListBlock {
  type: 'list';
  ordered: boolean;
  items: string[];
  layout?: BlockLayout;
}
export interface QuoteBlock {
  type: 'quote';
  text: string;
  cite?: string;
  layout?: BlockLayout;
}
export interface CalloutBlock {
  type: 'callout';
  variant: CalloutVariant;
  text: string;
  label?: string;
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  shape?: CalloutShape;
  layout?: BlockLayout;
}
export interface ImageBlock {
  type: 'image';
  src: string;
  alt: string;
  width?: number;          // 1–100 (%)
  height?: number;         // 1–4000 (px)
  align?: BlockAlign;
  fit?: BlockImageFit;
  radius?: number;         // 0–64
  layout?: BlockLayout;
}
export interface DividerBlock {
  type: 'divider';
  layout?: BlockLayout;
}
export interface TableBlock {
  type: 'table';
  table: BlockTable;
  layout?: BlockLayout;
}

export interface UnknownBlock {
  type: string;
  layout?: BlockLayout;
  [key: string]: unknown;
}

export type KnownBlock =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | QuoteBlock
  | CalloutBlock
  | ImageBlock
  | DividerBlock
  | TableBlock;

export type Block = KnownBlock | UnknownBlock;
export type BlockType = KnownBlock['type'];

export const KNOWN_BLOCK_TYPES = [
  'heading',
  'paragraph',
  'list',
  'quote',
  'callout',
  'image',
  'divider',
  'table',
] as const;

export function isKnownBlock(block: Block): block is KnownBlock {
  return (KNOWN_BLOCK_TYPES as readonly string[]).includes(block.type);
}
// [END CANONICAL BLOCK SCHEMA]
```

The **site** copies this block byte-for-byte. The only difference between the two files outside
the markers is the surrounding page/API types.

### 3.2 `frontend/src/lib/blockDesign.ts` (new)

Use exactly the exports and rules in §1.8. Include `CALLOUT_SHAPE_STYLES` with the five rows from
§1.7. `layoutToCss`:

```ts
export function layoutToCss(layout?: BlockLayout): CSSProperties {
  if (!layout) return {};
  const css: CSSProperties = {};
  if (layout.textAlign !== undefined) css.textAlign = layout.textAlign;
  if (layout.width !== undefined) {
    const offset = layout.offsetX ?? 0;
    css.width = `${Math.min(layout.width, Math.max(0, 100 - Math.abs(offset)))}%`;
  }
  if (layout.offsetX !== undefined) css.marginLeft = `${layout.offsetX}%`;
  if (layout.marginTop !== undefined) css.marginTop = `${layout.marginTop}px`;
  if (layout.marginBottom !== undefined) css.marginBottom = `${layout.marginBottom}px`;
  if (layout.backgroundColor !== undefined) css.backgroundColor = layout.backgroundColor;
  if (layout.borderColor !== undefined) css.borderColor = layout.borderColor;
  if (layout.borderWidth !== undefined) css.borderWidth = `${layout.borderWidth}px`;
  if (layout.borderStyle !== undefined) css.borderStyle = layout.borderStyle;
  if (layout.borderRadius !== undefined) css.borderRadius = `${layout.borderRadius}px`;
  if (layout.padding !== undefined) css.padding = `${layout.padding}px`;
  return css;
}
```

Note: `border` longhands must be emitted separately (not `border: '1px solid …'`) so a component
border is refined. `marginLeft` is physical (RTL note in §F.5; no logical properties in this
release).

### 3.3 `BlockRenderer.tsx`

Imports:

```ts
import type { Block, KnownBlock, PageContent } from '../api/types';
import { isBlocksContent, isHomeContent, isKnownBlock } from '../api/types';
import { CALLOUT_SHAPE_STYLES, calloutLabel, layoutToCss, tableColumnCount } from '../lib/blockDesign';
```

Delete the local `CALLOUT_LABEL` and `CALLOUT_SHAPE_STYLES` constants (they move to the helper).
Keep `Multiline` as-is.

`CalloutView`:

```tsx
const shape = block.shape ?? 'rounded';
const variant = block.variant || 'info';
const explicitLabel = typeof block.label === 'string' ? block.label.trim() : undefined;
const label = explicitLabel !== undefined ? explicitLabel : calloutLabel(block.variant);
const styles: CSSProperties = {
  ...CALLOUT_SHAPE_STYLES[shape],
  backgroundColor: block.backgroundColor || '#eef6ff',
  color: block.textColor || '#243447',
  borderColor: block.borderColor || '#b8cce0',
  borderStyle: 'solid',
  borderWidth: '1px',
  overflowWrap: 'anywhere',
  whiteSpace: 'normal',
  boxSizing: 'border-box',
  margin: '12px 0',
  ...layoutToCss(block.layout),   // layout wins, including margin overrides
};
```

The label span keeps the current markup and `pv-callout-label` class. Render the label **only
when `label !== ''`** (R7); when the author explicitly clears it, there is no span. Keep
`role="note"`, the `pv-callout pv-callout-${variant} pv-callout-shape-${shape}` classes and the
current inline typography. Legacy callouts therefore render exactly as today (R15 admin half).

`BlockView`:

```tsx
export function BlockView({ block }: { block: Block }) {
  if (!isKnownBlock(block)) {
    return (
      <div className="pv-unknown-block" role="note">
        Unsupported block type: {block.type}
      </div>
    );
  }
  const layout = layoutToCss(block.layout);
  switch (block.type) { ... }
}
```

For every known case, apply `style={layout}` to the **root** element, except `image` (see below)
and `callout` (merges layout inside `CalloutView`):

- `heading`: `<h1|h2|h3|h4 className={cls} style={layout}>`.
- `paragraph`: `<p className="pv-p" style={layout}>`.
- `list`: `<ol|ul className="pv-list" style={layout}>`.
- `quote`: `<blockquote className="pv-quote" style={layout}>`.
- `divider`: `<hr className="pv-divider" style={layout} />`.
- `image`:
  ```tsx
  const { textAlign: _ignored, ...imageLayout } = layout;  // image ignores layout.textAlign
  const figureStyle: CSSProperties = {
    ...(block.align ? { textAlign: block.align } : {}),
    ...imageLayout,
  };
  const imgStyle: CSSProperties = {
    ...(block.width !== undefined ? { width: `${block.width}%` } : {}),
    ...(block.height !== undefined ? { height: `${block.height}px` } : {}),
    ...(block.height !== undefined && block.fit === undefined ? { objectFit: 'cover' as const } : {}),
    ...(block.fit !== undefined ? { objectFit: block.fit } : {}),
    ...(block.radius !== undefined ? { borderRadius: `${block.radius}px` } : {}),
  };
  ```
  Render `<figure className="pv-figure" style={figureStyle}><img src alt loading="lazy" style={imgStyle} />…`.
  With no sizing keys, `imgStyle` is `{}` and the DOM/visual output is unchanged.
- `table`:
  ```tsx
  const table = block.table;
  const header = table.header ?? [];
  const rows = table.rows ?? [];
  const cols = tableColumnCount(table);
  const aligns = Array.from({ length: cols }, (_, i) => table.align?.[i] ?? 'left');
  const cell = (text: string, i: number, th: boolean) =>
    th
      ? <th key={i} style={{ textAlign: aligns[i], backgroundColor: table.headerBackgroundColor ?? '#eef2f7', color: table.headerTextColor ?? '#1f2937' }}>{renderCell(text)}</th>
      : <td key={i} style={{ textAlign: aligns[i] }}>{renderCell(text)}</td>;
  ```
  `renderCell` splits on `\n` and joins with `<br />`, returning a fragment (no
  `dangerouslySetInnerHTML`). Root:
  `<div className={'pv-table-wrap' + …} style={layout}>`; table class
  `pv-table` + (`pv-table--bordered` when `table.bordered !== false`) +
  (`pv-table--striped` when `table.striped === true`). Render `<thead>` only when
  `header.length > 0`. `layout.textAlign` stays on the wrapper; cell `textAlign` is only from
  `table.align` (R25). If `rows` is empty, render an empty `<tbody>` (R13).

Keep `HomeFields` exactly as-is. `BlockRenderer` remains the same wrapper (`preview-body`) and
still renders `HomeContent` unchanged.

### 3.4 `BlockEditor.tsx`

Imports from types/helper:

```ts
import type { Block, BlockType, BlockTable, CalloutShape, HeadingLevel, KnownBlock, UnknownBlock } from '../api/types';
import { isKnownBlock } from '../api/types';
import { CALLOUT_SHAPES, calloutLabel } from '../lib/blockDesign';
```

`makeBlock`:

```ts
case 'callout':
  return { type: 'callout', variant: 'info', text: '' };   // no design keys (R15)
case 'image':
  return { type: 'image', src: '', alt: '' };               // no sizing keys
case 'table':
  return {
    type: 'table',
    table: { header: ['Column 1', 'Column 2'], rows: [['', '']] },
  };
```

Add `{ type: 'table', label: 'Table' }` to the local `BLOCK_TYPES` toolbar array (after
`divider` or before it; order is not semantic). The type select gains the same option. The
existing “best-effort carry over text” in `setType` stays, but it must not copy `layout` or a
type-specific payload between incompatible types.

**Design panel.** Add a `BlockDesignPanel` component in this file:

```tsx
function BlockDesignPanel({ block, disabled, onChange }: {
  block: KnownBlock;
  disabled: boolean;
  onChange: (next: KnownBlock) => void;
}) {
  const [open, setOpen] = useState(false);
  ...
}
```

Render it for every known block except `divider` (divider still gets layout controls — include
divider; the requirement is every block can carry layout). Actually include **all** known
blocks, including divider and table. The panel is `<details>`-like; use a button with
`aria-expanded` and a `<div hidden={!open}>`:

```tsx
<button type="button" className="btn small" onClick={() => setOpen(v => !v)} disabled={disabled} aria-expanded={open}>
  {open ? 'Hide design' : 'Design'}
</button>
{open && <div className="block-design-panel">…</div>}
```

The panel updates the block with immutable copies, using a local `updateLayout(patch)`:

```ts
const nextLayout = { ...(block.layout ?? {}), ...patch };
(Object.keys(nextLayout) as (keyof typeof nextLayout)[]).forEach((k) => {
  if (nextLayout[k] === undefined) delete nextLayout[k];
});
onChange({ ...block, layout: Object.keys(nextLayout).length ? nextLayout : undefined });
```

When `layout` becomes empty, omit the key entirely (`const { layout, ...rest } = next; onChange(rest as KnownBlock)`).

Layout controls (exact ranges/labels):

| Control | Element | Notes |
|---|---|---|
| Align | `<select>` options `—`, Left, Center, Right, Justify | `—` deletes `textAlign` |
| Width | `<input type="range" min=0 max=100 step=1>` + number input | show `%`, empty number deletes |
| Offset | range `-100..100` + number | show `%`, empty deletes |
| Margin top | number `0..200` | px, empty deletes |
| Margin bottom | number `0..200` | px |
| Background | colour + text + Clear | see colour control |
| Border colour | colour + text + Clear | |
| Border width | number `0..8` | px, empty deletes |
| Border style | select `—`, None, Solid, Dashed, Dotted | `—` deletes |
| Radius | number `0..64` | px |
| Padding | number `0..64` | px |

Add a reusable `ColorControl` (within this file):

```tsx
function ColorControl({ label, value, onChange, disabled }: {...}) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value ?? '');
  const picker = valid ? value! : '#ffffff';
  // <input type="color" value={picker} onChange={e => onChange(e.target.value)} />
  // <input type="text" value={value ?? ''} placeholder="#rrggbb" maxLength={7}
  //   onChange={e => { const v = e.target.value.trim(); onChange(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v.toLowerCase() : undefined); }} />
  // <button type="button" onClick={() => onChange(undefined)}>Clear</button>
}
```

`onChange(undefined)` means delete the key. Never write an invalid value to the block; the text
input may hold transient invalid text in local component state, but only valid values propagate.
Simplest compliant approach: keep a local `draft` state per text input and call `onChange` only
when valid; Clear calls `onChange(undefined)`.

**Image controls:** width range 1–100 + number (empty deletes, `0` invalid), height number
1–4000 (empty deletes; placeholder `Auto`), align select (`—`/Left/Centre/Right), fit select
(`—`/Cover/Contain/Fill), radius number 0–64. `image.width` etc. are top-level block keys, not
inside `layout`; update with `{ ...block, width: n }` or delete the key.

**Callout controls:** keep the existing variant select and custom-variant text input, but change
the label preview/default to `calloutLabel(block.variant)` (so any custom variant shows
`Custom callout`, not the raw slug). Add a `Label` text input bound to `block.label` (empty →
delete the key, do **not** store `""` from the editor; explicit empty is only possible via API).
Use `ColorControl` for the three colours. Shape select uses `CALLOUT_SHAPES` and labels:
Rectangle, Rounded, Square, Oval, Circle. New callouts start with no design keys; choosing a
shape writes `shape`, and clearing (a `—` option) deletes it. Because `rounded` is the renderer
default, a new callout with no `shape` still looks rounded.

**Table editor:**

- Local helpers operate on `block.table` and always write a **new** `table` object:
  `onChange({ ...block, table: nextTable })`.
- Header toggle: when turning on, create `header` with the current column count filled with
  `Column {i+1}` (or `""` if columns already contain data); when turning off, delete the `header`
  key entirely.
- `Add column`: append `""` to every row and to `header` when present; stop at 50.
- `Remove column`: remove the last cell from every row and from `header`; stop at 0; if `rows`
  becomes `[]` keep `rows: []`.
- `Add row`: append an array of `""` of length `tableColumnCount(table)`; stop at 200.
- `Remove row`: remove that row; allow `rows: []`.
- Cell inputs: `<textarea rows={2} maxLength={2000}>` or `<input maxLength={2000}>`; `\n`
  allowed. Write the whole row array immutably.
- Align select per column: `left|center|right`, always writes the full `align` array of length
  `cols` (padding with `left`); changing a cell/header that changes the column count re-pads
  `align`.
- Header colours use `ColorControl`; `bordered`/`striped` checkboxes write booleans (including
  `false`).
- Table editor respects `disabled` (the whole editor can be locked).

**Wire-up:** in `BlockCard`, render
`<BlockDesignPanel block={block} disabled={disabled} onChange={(next) => onChange(index, next)} />`
after the type-specific fields (for `table`, after the table editor).

**Unknown blocks (must not be destroyed).** `BlockEditor` receives `Block[]`, which can contain
`UnknownBlock` values from a newer client/server. In the list map:

```tsx
{isKnownBlock(block) ? (
  <BlockCard key={i} block={block} ... />
) : (
  <UnknownBlockCard key={i} block={block} index={i} total={value.length}
    disabled={disabled} onMove={move} onRemove={remove} />
)}
```

Type `BlockCard`’s `block` prop as `KnownBlock` and `onChange` as `(index, next: KnownBlock) => void`
(the parent `update` still accepts `Block`). `UnknownBlockCard` is a read-only `<fieldset
className="block-card">` with the same legend/toolbar markup (move up/down, remove) and:

```tsx
<p className="muted small">
  Unsupported block type <code>{block.type}</code>. It is preserved when you save; editing it is
  not supported in this version.
</p>
```

No type select, no content fields, no design panel for unknown blocks. Do **not** include the
unknown payload in the DOM (it may contain future/hostile strings). Moving/removing is allowed;
otherwise the block object is passed through untouched by `normalizeBlocks` and
`currentContent`.

### 3.5 `PageEditorPage.tsx`

**Rename the content-format state** to avoid a collision with the homepage flag:

```ts
const [isHomeFormat, setIsHomeFormat] = useState(false);
const [isHomepage, setIsHomepage] = useState(false);
const [featured, setFeatured] = useState(false);
```

- Initialisation effect: `setIsHomepage(page.is_homepage)`, `setFeatured(page.featured)`, and
  `setIsHomeFormat(isHomeContent(page.content))` / set blocks otherwise.
- `currentContent` uses `isHomeFormat`.
- The `isHome ? <HomeFieldsEditor …> : <BlockEditor …>` render uses `isHomeFormat`.
- `dirty` adds `isHomepage !== page.is_homepage || featured !== page.featured` **only when
  `isAdmin`**.
- Save payload:
  ```ts
  if (isAdmin) {
    payload.is_homepage = isHomepage;
    payload.featured = featured;
  }
  ```
  For volunteers, do **not** add either key, even if the states are initialised from the page
  (R22). Do not send `false` for volunteers.
- Sidebar, immediately after the Language field (and before Reviewer), render when `isAdmin`:
  ```tsx
  <label className="inline-field">
    <input type="checkbox" checked={isHomepage} onChange={e => setIsHomepage(e.target.checked)} disabled={locked} />
    <span>Use as homepage for this language</span>
  </label>
  <label className="inline-field">
    <input type="checkbox" checked={featured} onChange={e => setFeatured(e.target.checked)} disabled={locked} />
    <span>Featured</span>
  </label>
  ```
  Add a `small.muted` hint: “Saving a homepage unsets the previous homepage for this language.”
- `PageUpdatePayload` gains `is_homepage?: boolean; featured?: boolean` (§3.1 file, payload
  section).
- The save mutation’s `onSuccess` already resets from the server response, so the flags are
  re-read from `updated.is_homepage`/`updated.featured`.

### 3.6 `frontend/src/index.css`

Append near the existing `.pv-*` block styles (before the public-page section), using the existing
CSS variables. Do not rename or remove any existing rule. Minimum required:

```css
.pv-table-wrap {
  margin: 18px 0;
  max-width: 100%;
  overflow-x: auto;
}
.pv-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92rem;
  color: inherit;
}
.pv-table th,
.pv-table td {
  padding: 8px 10px;
  vertical-align: top;
  text-align: left;
}
.pv-table th {
  font-weight: 700;
}
.pv-table td {
  white-space: normal;
  overflow-wrap: anywhere;
}
.pv-table--bordered th,
.pv-table--bordered td {
  border: 1px solid var(--line, #d8dee8);
}
.pv-table--striped tbody tr:nth-child(even) {
  background: var(--panel-soft, #f7f8fa);
}
.pv-unknown-block {
  margin: 12px 0;
  padding: 14px 16px;
  border: 1px dashed var(--line-strong, #b8c0cc);
  border-radius: 10px;
  background: var(--panel-soft, #f7f8fa);
  color: var(--muted, #667085);
  font-size: 0.9rem;
}
.pv-block-design {
  margin-top: 10px;
}
.pv-block-design-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px 14px;
}
.pv-table-editor {
  display: grid;
  gap: 8px;
  overflow-x: auto;
  max-width: 100%;
}
.pv-table-editor table {
  border-collapse: collapse;
  min-width: 100%;
}
.pv-table-editor th,
.pv-table-editor td {
  border: 1px solid var(--line, #d8dee8);
  padding: 4px;
  vertical-align: top;
}
```

Use `pv-block-design` / `pv-block-design-grid` / `pv-table-editor` class names in the editor, or
the existing `.block-fields` layout if it already fits — but the table editor must not force the
whole page wider than the viewport. Add a `@media (max-width: 640px)` rule if needed so the design
grid is one column; `auto-fit/minmax` already handles it.

### 3.7 Admin build/acceptance

```bash
cd frontend
npm run build        # tsc -b && vite build; must be clean
```

Manual checks (after SITE is built too): add a table, a designed callout, an image with
width/height/align, and a layout with width + offset; save; reload; the working-draft preview
shows exactly the same design. The public preview shows the same new design (legacy callouts
still use the old variant colours).

## 4. SITE — exact changes

**Files:** `site/src/api/types.ts`, `site/src/lib/blockDesign.ts` (new),
`site/src/components/BlockRenderer.tsx`, `site/src/index.css`.
**Mirror only; do not change** `site/src/pages/*`, `site/src/lib/api.ts`, or navigation code.

### 4.1 Canonical TypeScript block — `site/src/api/types.ts`

Replace the block-content types section from `export interface HeadingBlock {` through
`export type Block = ...` with the **same byte sequence** as the canonical block in
`frontend/src/api/types.ts` (§3.1), including the markers:

```ts
// [BEGIN CANONICAL BLOCK SCHEMA]
…
// [END CANONICAL BLOCK SCHEMA]
```

Keep `Contributor`, `BlocksContent`, `HomeContent`, `HomeFields`, `PageContent`, `PagePublic`,
navigation types, and `isBlocksContent`/`isHomeContent` exactly as they are. Widen the site’s
`isBlocksContent` guard so it still checks `Array.isArray`; the block union now includes
`UnknownBlock`, so no cast is needed at the call site.

### 4.2 `site/src/lib/blockDesign.ts` (new)

**Byte-identical** to `frontend/src/lib/blockDesign.ts` (§1.8/§3.2). Same imports, same exports,
same implementation. No site-specific imports.

### 4.3 `BlockRenderer.tsx`

Imports:

```ts
import type { CSSProperties } from 'react'
import type { Block } from '../api/types'
import { isKnownBlock } from '../api/types'
import { CALLOUT_SHAPE_STYLES, calloutLabel, layoutToCss, tableColumnCount } from '../lib/blockDesign'
```

Delete the local `CALLOUT_LABEL`. Keep `Multiline`; add the same `renderCell` helper described in
§3.3.

`BlockView` starts with the unknown guard:

```tsx
if (!isKnownBlock(block)) {
  return (
    <div className="content-unknown-block" role="note" style={layoutToCss(block.layout)}>
      Unsupported block type: {block.type}
    </div>
  )
}
```

Then the switch:

- `heading`: level `Math.max(block.level, 2)` (R21); `<h2|h3|h4>` with
  `className={'content-heading content-heading--' + level}` and `style={layout}`. Preserve the
  existing tag-cast pattern.
- `paragraph`: `<p className="content-paragraph" style={layout}>`.
- `list`: `<ol|ul className="content-list" style={layout}>`.
- `quote`: `<blockquote className="content-quote" style={layout}>`.
- `divider`: `<hr className="content-divider" style={layout} />`.
- `image`:
  ```tsx
  const { textAlign: _ignored, ...imageLayout } = layoutToCss(block.layout); // R: image ignores layout.textAlign
  const figureStyle: CSSProperties = {
    ...(block.align ? { textAlign: block.align } : {}),
    ...imageLayout,
  };
  const imgStyle: CSSProperties = {
    ...(block.width !== undefined ? { width: `${block.width}%` } : {}),
    ...(block.height !== undefined ? { height: `${block.height}px` } : {}),
    ...(block.height !== undefined && block.fit === undefined ? { objectFit: 'cover' as const } : {}),
    ...(block.fit !== undefined ? { objectFit: block.fit } : {}),
    ...(block.radius !== undefined ? { borderRadius: `${block.radius}px` } : {}),
  };
  ```
  Render the existing `.content-figure` structure and `<img … style={imgStyle} />`. When no
  sizing keys exist, `imgStyle` is `{}` and legacy output is unchanged.
- `table`: mirror §3.3 exactly, but with `content-*` classes:
  `content-table-wrap`, `content-table`, `content-table--bordered`,
  `content-table--striped`. Root gets `style={layout}`. Header colour defaults `#eef2f7` /
  `#1f2937`; cell align defaults `left`; `<thead>` only when `header.length > 0`; empty tbody
  when `rows` is empty. Use `renderCell` for `\n` → `<br />`.
- `callout`: **two paths**, per R15.
  ```tsx
  const variant = block.variant || 'info';
  ```
  - `hasDesign` is true if **any** of `label`, `backgroundColor`, `textColor`, `borderColor`,
    `shape`, `layout` is present (`!== undefined`). A callout with only `variant` + `text` is
    legacy.
  - **Legacy path:** keep the current markup and variant CSS:
    ```tsx
    <div className={`content-callout content-callout--${variant}`} role="note">
      <span className="content-callout__label">{legacyLabel}</span>
      <div className="content-callout__text"><Multiline text={block.text} /></div>
    </div>
    ```
    `legacyLabel` = explicit `block.label` if present (impossible in pure legacy, but harmless),
    else `calloutLabel(variant)`. For built-ins that is exactly the old map; for a custom
    variant-only callout it is `"Custom callout"` (R6). **No inline style**, no shape class — old
    built-in pages look exactly as today.
  - **Designed path:** full inline parity with the admin:
    ```tsx
    const shape = block.shape ?? 'rounded';
    const explicitLabel = typeof block.label === 'string' ? block.label.trim() : undefined;
    const label = explicitLabel !== undefined ? explicitLabel : calloutLabel(block.variant);
    const styles: CSSProperties = {
      ...CALLOUT_SHAPE_STYLES[shape],
      backgroundColor: block.backgroundColor || '#eef6ff',
      color: block.textColor || '#243447',
      borderColor: block.borderColor || '#b8cce0',
      borderStyle: 'solid',
      borderWidth: '1px',
      overflowWrap: 'anywhere',
      whiteSpace: 'normal',
      boxSizing: 'border-box',
      margin: '12px 0',
      ...layoutToCss(block.layout),
    };
    ```
    Precedence: the shape’s radius/padding come from `CALLOUT_SHAPE_STYLES`; `layoutToCss` is
    spread last, so an explicit `layout.borderRadius` / `layout.padding` wins. Do not re-apply
    the shape values after the layout spread.
  - Render:
    ```tsx
    <div
      className={`content-callout content-callout--${variant} content-callout-shape-${shape}`}
      role="note"
      style={styles}
    >
      {label !== '' && <span className="content-callout__label">{label}</span>}
      <div className="content-callout__text"><Multiline text={block.text} /></div>
    </div>
    ```
  - Custom variant slugs are kept in the class name; the backend slug regex has already
    guaranteed CSS safety. Built-in variants still get their existing CSS as a fallback, but the
    inline background/border wins on the designed path.

Keep `BlockRenderer({ blocks }: { blocks: Block[] })` and its wrapper exactly as-is. The
homepage `HomeContent` path is untouched.

### 4.4 `site/src/index.css`

Append after the `.content-callout--bad` rules and before `.content-figure` (or after
`.content-image-missing`; keep it grouped with the block styles). Do not remove or rename any
existing rule. Minimum required:

```css
.content-table-wrap {
  margin: 1.5rem 0;
  max-width: 100%;
  overflow-x: auto;
}
.content-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 1rem;
}
.content-table th,
.content-table td {
  padding: 0.5rem 0.65rem;
  vertical-align: top;
  text-align: left;
}
.content-table th {
  font-weight: 600;
}
.content-table td {
  overflow-wrap: anywhere;
}
.content-table--bordered th,
.content-table--bordered td {
  border: 1px solid var(--line);
}
.content-table--striped tbody tr:nth-child(even) {
  background: var(--paper-soft);
}
.content-unknown-block {
  margin: 1rem 0;
  padding: 0.9rem 1.1rem;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  background: var(--paper-soft);
  color: var(--muted);
  font-size: 0.95rem;
}
.content-callout-shape-rectangle { border-radius: 6px; }
.content-callout-shape-rounded { border-radius: 16px; }
.content-callout-shape-square { border-radius: 0; }
.content-callout-shape-oval { border-radius: 9999px; }
.content-callout-shape-circle { border-radius: 50%; }
```

The shape classes are a no-JS fallback; the designed path’s inline style is authoritative. Legacy
callouts never receive a shape class, so their existing variant CSS is untouched.

### 4.5 Site build/acceptance

```bash
cd site
npm run build        # tsc --noEmit && vite build; must be clean
```

Manual checks: open a page with each new block; at 360 px wide the table scrolls inside its
wrapper (no page-level horizontal scroll), images scale, the designed callout matches the admin
side-by-side, and an old page’s callout still shows the pre-change variant colours. An unknown
block shows the placeholder, not a blank space or raw JSON.

## 5. Integration contract (all three agents)

### 5.1 Field-by-field parity table

| Feature | Backend stores | Admin reads/writes | Site reads/renders |
|---|---|---|---|
| `layout` | `_sanitize_layout`, only valid present keys; `{}` dropped | design panel; `layoutToCss` on block root | `layoutToCss` on block root |
| `layout.width` + `offsetX` | raw values kept (ranges 0–100 / -100–100) | clamps width to `100 - abs(offset)` for CSS | same clamp |
| `layout.borderWidth` + `borderStyle` | independent; absence never synthesised | two separate controls | longhand CSS only when present |
| `image.width/height` | 1–100 / 1–4000; only if present | width range + height number | `%` / `px` styles |
| `image.align` | `left|center|right` | select | `figure.textAlign`; ignores `layout.textAlign` |
| `image.fit` | `cover|contain|fill` | select | `objectFit`; implicit `cover` only when `height` set |
| `image.radius` | 0–64 | number | `borderRadius` on `<img>` |
| `callout.variant` | built-ins or lowercased custom slug; invalid → `info` | variant/custom input | class suffix; legacy path uses variant CSS |
| `callout.label` | ≤ 200 chars; explicit `""` preserved | text input; empty deletes key | label element only when non-empty; default from `calloutLabel` |
| callout colours | hex only, lowercase 6-digit | colour control | inline on designed path; legacy path untouched |
| `callout.shape` | five enums only | five-option select | shape CSS + inline styles on designed path |
| `table.header` | ≤ 50 strings × 2 000 chars; `[]` preserved | header toggle + inputs | `<thead>` only if length > 0 |
| `table.rows` | ≤ 200 × 50, padded/truncated to column count | grid editor | `<tbody>`, always rows array |
| `table.align` | per column, padded with `left` only if supplied | per-column select | explicit `text-align` on every cell |
| `table` colours/bools | hex / real bools, only if supplied | colour controls + checkboxes | defaults `#eef2f7`, `#1f2937`, `bordered=true`, `striped=false` |
| unknown block | slug-valid type + deep-sanitised extras | not creatable in UI; type preserved | placeholder `Unsupported block type: <type>` |
| `is_homepage` | `PageUpdate` accepts; CRUD unsets siblings on `True` | admin-only checkbox | `/homepage` fallback deterministic |
| `featured` | `PageUpdate` accepts | admin-only checkbox | not rendered by this feature (existing behaviour) |

### 5.2 Cross-agent invariants

1. The canonical block and `blockDesign.ts` are byte-identical (§6.2). If one agent adds an
   export “just for their app”, parity fails; put app-specific code outside these files.
2. Backend never writes renderer defaults. Frontends never invent missing data during save; they
   only delete keys on clear or write user-selected values.
3. `layout` is the **last** style spread on every root element (except image, where `textAlign`
   is deliberately dropped, and legacy callout, which has no inline style on the site).
4. Legacy callout rendering is frozen on **both** apps: admin inline style as today; site variant
   CSS as today. No new shape class on the legacy path.
5. No raw HTML: all text is JSX-escaped; only `\n` → `<br>` is synthesised.
6. The public API keeps serving `content`; `live_content` is untouched (F.7/R28).

### 5.3 Parallel work order

All three agents can start immediately:

- BACKEND: §2.
- ADMIN: §3 (types first, then helper, renderer, editor, page flags, CSS).
- SITE: §4 (types first, then helper, renderer, CSS).

Merge order does not matter for compilation because no app imports backend code. Run §6 after all
three are merged. If only one agent is available, do BACKEND first (it unblocks the live
round-trip), then SITE, then ADMIN.

---

## 6. Verification playbook

### 6.1 Static gates

```bash
# from repo root
cd backend && ../.venv/bin/python -m pytest -q
cd ../frontend && npm run build
cd ../site && npm run build
```

Expected: pytest `0 failed` (DB tests may `s`), both builds exit `0`. `tsc` must not emit
`any`-suppression errors; do not add `// @ts-ignore` to silence the canonical block.

### 6.2 Parity gates (must be empty)

```bash
cd /home/aut007/Downloads/medically_complicated_admin_panel
diff -u frontend/src/lib/blockDesign.ts site/src/lib/blockDesign.ts
python - <<'PY'
import pathlib, re, sys
def block(path):
    text = pathlib.Path(path).read_text()
    m = re.search(r"// \[BEGIN CANONICAL BLOCK SCHEMA\](.*?)// \[END CANONICAL BLOCK SCHEMA\]", text, re.S)
    if not m:
        sys.exit(f"markers missing in {path}")
    return m.group(1)
a = block("frontend/src/api/types.ts")
b = block("site/src/api/types.ts")
if a != b:
    sys.exit("canonical block differs between frontend and site")
print("canonical block identical:", len(a), "chars")
PY
```

### 6.3 Backend unit/live smoke

```bash
cd backend
./start_pg.sh
source ../.venv/bin/activate
python init_and_seed.py
../.venv/bin/python -m pytest -q tests/test_content_schema.py
```

Then, in another terminal (also from `backend/` so `.env` loads):

```bash
python -m uvicorn app.main:app --port 8000
```

**Proof the allow-list bug is fixed (no DB):**

```bash
cd backend && ../.venv/bin/python - <<'PY'
from app.services.sanitize import sanitize_content
from app.services.content_text import extract_clean_text
content = {"format":"blocks-v1","blocks":[
  {"type":"table","table":{"header":["Symptom","Ask"],"rows":[["Headache","Scan?"]]}},
  {"type":"callout","variant":"custom-note","label":"Note","shape":"oval","backgroundColor":"#eef6ff","text":"Hello"},
  {"type":"image","src":"/uploads/x.jpg","alt":"x","width":60,"height":200,"align":"center"},
  {"type":"paragraph","text":"Body","layout":{"width":70,"offsetX":10,"borderWidth":2}},
]}
out = sanitize_content(content)
assert out["blocks"][0]["table"]["rows"] == [["Headache","Scan?"]]
assert out["blocks"][1]["shape"] == "oval"
assert out["blocks"][2]["width"] == 60
assert out["blocks"][3]["layout"]["width"] == 70
assert "Headache" in extract_clean_text(out)
assert sanitize_content(out) == out            # idempotent
print("OK", out)
PY
```

**Live admin round-trip** (requires seed; `jq` installed):

```bash
BASE=http://127.0.0.1:8000
TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login/json" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin123"}' | jq -r .access_token)
[ -n "$TOKEN" ] && [ "$TOKEN" != null ] || { echo "login failed"; exit 1; }
AUTH="Authorization: Bearer $TOKEN"

GROUP=$(curl -s "$BASE/admin/groups" -H "$AUTH" | jq -r '.[0].id')
SLUG="spec-table-$(date +%s)"
BODY=$(jq -n --arg g "$GROUP" --arg s "$SLUG" '{
  title:"Spec table", slug:$s, group_id:$g, lang:"en", status:"published",
  content:{format:"blocks-v1",blocks:[
    {type:"table",table:{header:["A","B"],rows:[["one","two"]],align:["left","center"]}},
    {type:"callout",variant:"custom-note",label:"Note",shape:"oval",text:"hello"},
    {type:"image",src:"/uploads/demo.jpg",alt:"demo",width:50,height:120,align:"center",fit:"cover"}
  ]}
}')
CREATED=$(curl -s -X POST "$BASE/admin/pages" -H "$AUTH" -H 'Content-Type: application/json' -d "$BODY")
ID=$(echo "$CREATED" | jq -r .id)
echo "$CREATED" | jq -e '
  (.content.blocks[] | select(.type=="table" and .table.rows[0][0]=="one" and .table.align[1]=="center")) and
  (.content.blocks[] | select(.type=="callout" and .label=="Note" and .shape=="oval")) and
  (.content.blocks[] | select(.type=="image" and .width==50 and .height==120))
' >/dev/null || { echo "round-trip lost data"; exit 1; }

curl -s "$BASE/api/v1/pages/$SLUG?lang=en" | jq -e '.content.blocks[0].table.rows[0][0]=="one"' >/dev/null
curl -s "$BASE/admin/pages/$ID" -H "$AUTH" | jq -e '.content_text | contains("one")' >/dev/null
echo "round-trip OK (page $ID)"
```

**Homepage exclusivity + deterministic fallback:**

```bash
# Create two published homepages in the same language; the first must become false.
mk() { jq -n --arg g "$GROUP" --arg s "$1" --arg t "$2" '{title:$t,slug:$s,group_id:$g,lang:"en",status:"published",is_homepage:true,content:{format:"blocks-v1",blocks:[]}}'; }
H1=$(curl -s -X POST "$BASE/admin/pages" -H "$AUTH" -H 'Content-Type: application/json' -d "$(mk "home-a-$(date +%s)" "Home A")" | jq -r .id)
H2=$(curl -s -X POST "$BASE/admin/pages" -H "$AUTH" -H 'Content-Type: application/json' -d "$(mk "home-b-$(date +%s)" "Home B")" | jq -r .id)
[ "$(curl -s "$BASE/admin/pages/$H1" -H "$AUTH" | jq -r .is_homepage)" = false ] || { echo "H1 not unset"; exit 1; }
[ "$(curl -s "$BASE/admin/pages/$H2" -H "$AUTH" | jq -r .is_homepage)" = true ] || { echo "H2 not set"; exit 1; }
A=$(curl -s "$BASE/api/v1/homepage?lang=en" | jq -r .id)
B=$(curl -s "$BASE/api/v1/homepage?lang=en" | jq -r .id)
[ "$A" = "$B" ] || { echo "homepage fallback not deterministic"; exit 1; }
echo "homepage OK ($A)"
```

**403 / permissions checks:** log in as a volunteer and assert
`PATCH /admin/pages/{id}` with `{"is_homepage":true}` is rejected with **403** by the new flag
guard (§2.14.1), that `POST /admin/pages` with `is_homepage: true` is rejected with 403, and
that a pending page is locked for volunteer edits. Do not weaken any guard to make the UI pass.

### 6.4 UI smoke (manual, 10 minutes)

1. Admin: create a draft page; add table, designed callout, image (width 60, height 200, align
   centre), paragraph with layout width 70 + offset 10 + border. Save and reload. Values persist;
   nothing resets to defaults.
2. Admin: clear each design control. The key disappears; the block falls back to defaults. Clear a
   callout’s shape → no `shape` key, still renders rounded.
3. Admin: table 3×3 with header, per-column align, bordered off, striped on. Public preview shows
   the same. At 360 px the table scrolls inside the wrapper only.
4. Admin: admin-only homepage/featured checkboxes are absent for a volunteer login; saving as a
   volunteer does not unset the language’s homepage.
5. Site: load a legacy seeded page. Callout colours/spacing are unchanged; headings still start at
   `<h2>`; no visual diff in paragraphs/lists/images.
6. Site: unknown block (insert one directly in DB or via API) shows the placeholder, not raw JSON.
7. Run both builds once more after the manual pass; no generated files committed (`dist/`,
   `node_modules/`, `__pycache__/`).

### 6.5 Process safety

- **Never `pkill -f uvicorn`** (it can kill unrelated processes). Find the PID with
  `ss -ltnp | grep ':8000'` and `kill <pid>`.
- Dev ports: backend `8000`, admin `5173`, site `5174`. Do not reuse or reassign them.
- Postgres is on `127.0.0.1:5433`, user `postgres`, password `qwerty`, database `mc_admin`.
  `backend/.env` is required; run commands from `backend/` so Pydantic finds it.
- Do not commit `.env`, uploads, `dist/`, or generated caches. Check both git roots
  (`git status` and `git -C backend status`) before handing off.
- Root `app/` is dead. If a fix “doesn’t take effect”, confirm you edited `backend/app/…`.

---

## 7. Risk register / known limitations (ship with these documented)

| Risk | Impact | Mitigation / decision |
|---|---|---|
| Legacy callouts differ between admin and site | Pre-existing visual difference | R15 freezes both current behaviours; designed callouts are parity-tested. Do not “unify” legacy styling in this release. |
| Two concurrent homepage creates both set `True` | Two homepages in one language | CRUD unsets sequentially and public fallback is deterministic (R23). A DB partial unique index is **out of scope**; note it as follow-up. |
| Designer JSON grows large | DB row bloat / slow editor | 256 KiB per-block cap, 200×50 table cap, row truncation from the end (R14). Overall content cap remains. |
| Unknown blocks preserved forever | Junk accumulates | Only slug-valid types, 50 keys, deep-sanitised, never rendered as HTML. Cleanup is a future admin tool. |
| Public serves working `content`, not `live_content` | Unapproved edits can be public | This is existing F.7 behavior and explicitly out of scope (R28). Do not “fix” it here. |
| Inline styles vs strict CSP | Style attributes may be blocked by a future CSP | Current app already uses inline styles for callouts; no CSP change in this release. A class-based styling system is a future project. |
| `offsetX` is physical `marginLeft` | RTL pages shift the “wrong” way | Explicitly out of scope (§F.5). Do not invent logical-property behavior. |
| Table cell `\n` vs HTML export | Export is text-ish, not styled | `blocks_to_html` converts `\n` → `<br>` and escapes everything; no layout styling in export. |
| Numeric strings / floats | API clients may send odd JSON | Sanitiser coerces/validates/clamps; renderers assume sanitised data but still use `??` defaults for legacy/unknown. |
| Admin new-callout factory | New callouts start with no design keys | Intentional (R15): a fresh callout is legacy-compatible until the author changes a design control. |
| Test file naming conflict | Contract names two files | R16 shim; canonical suite runs once. Do not duplicate fixtures. |
| No migration | Existing rows untouched | JSONB is schemaless; no Alembic change. Confirm 2 099 seeded pages still render in §6.4 step 5. |

**Out of scope, unchanged:** absolute canvas/drag positioning, nested rows/columns, per-block
custom CSS, video/embed blocks, `live_content` switching, Alembic repair, media upload changes,
HTML sanitisation of `home-v1`, export/import formats, and any redesign of the public navigation.

---

## Appendix A — One-page agent checklist

**BACKEND**
- [ ] `BLOCK_TYPES` + helpers + table/callout/image/layout sanitising
- [ ] unknown blocks + extras preserved, denylist enforced
- [ ] fixed-point `_clean_text`, 256 KiB cap
- [ ] `extract_clean_text` table/callout; `blocks_to_html` table/callout/image
- [ ] `PageUpdate.is_homepage/featured`; route 403 guard for non-admins; CRUD async homepage unset; deterministic public fallback
- [ ] `test_content_schema.py`, shim, DB round-trip tests
- [ ] `pytest -q` green; live curl round-trip green

**ADMIN**
- [ ] canonical block + `blockDesign.ts`
- [ ] renderer: layout/table/callout/image/unknown
- [ ] editor: design panel, image controls, table grid, callout controls, table type
- [ ] `PageEditorPage`: rename `isHome` → `isHomeFormat`; admin-only flags; payload omission for volunteers
- [ ] CSS `pv-table*`, `pv-unknown-block`, editor layout
- [ ] `npm run build` clean; parity diff clean

**SITE**
- [ ] canonical block + byte-identical `blockDesign.ts`
- [ ] renderer parity: layout/table/callout (legacy + designed)/image/unknown; h2 minimum
- [ ] CSS `content-table*`, `content-unknown-block`, shape fallbacks
- [ ] `npm run build` clean; parity diff clean

**INTEGRATION**
- [ ] both parity diffs empty
- [ ] live round-trip loses no new field
- [ ] legacy seeded page unchanged visually
- [ ] homepage exclusivity + deterministic `/homepage`
- [ ] no source edits outside ownership; both git roots reviewed

<!-- END OF SPEC -->

