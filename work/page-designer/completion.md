# Completion — Free-form responsive page designer

**Status: DONE.** All blocking issues resolved; all automated gates green.

## What was wrong
The developer's authored content was being destroyed on save. `backend/app/services/sanitize.py`
rebuilt every block from a fixed key allow-list:

- `callout` → kept only `{type, variant, text}`; dropped `label`, `backgroundColor`,
  `textColor`, `borderColor`, `shape`
- `image` → dropped width/height/align/fit/radius
- `table` → not in `BLOCK_TYPES` → **whole block deleted**
- `layout` (alignment/position) → not modelled at all

So the editor saved correctly, the backend stripped it, and the next fetch showed "only the
blocks and elements that you had made". A bad `main` merge had also reverted the homepage fixes.

## What was built
### Backend
- `sanitize.py` rewritten to **validate-and-keep**: per-block `layout` (textAlign, width,
  offsetX, marginTop/Bottom, colours, border, radius, padding), image sizing
  (`width`/`height`/`align`/`fit`/`radius`), full callout design (`label` + three colours +
  `shape`), and a `table` block (`header`, `rows`, per-column `align`, header colours,
  `bordered`, `striped`). Unknown block types and extra keys are preserved.
- Security unchanged: HTML stripped, URLs allow-listed, hex/number/enum validated.
- `_clean_text` now folds the whole unescape+strip pipeline to a **fixed point** (idempotent).
- Over-cap blocks are **shrunk, never deleted** (list items / table rows / inline data URLs).
- `content_text` extracts table + label text; `blocks_to_html` renders the new shapes.
- Homepage repair: `PageUpdate.is_homepage`/`featured` restored, single homepage per language,
  deterministic `GET /api/v1/homepage`, volunteers get 403 on the flags.

### Admin frontend
- Canonical schema in `api/types.ts`; shared `lib/blockDesign.ts`; renderer applies all layout.
- Block editor: layout panel for every block, image controls, full **table editor**
  (rows/cols/header/cells/alignment), existing callout design preserved.
- **Arrange mode**: drag a block to set `offsetX`, drag its right handle to set `width`
  (pointer + touch + keyboard nudge), with legacy layout staying absent until dragged.
- Admin-only homepage/featured checkboxes; `isHome` → `isHomeFormat` shadowing bug fixed.

### Public site
- Types, renderer and CSS brought to **full parity** (callout design, tables, image sizing,
  layout), keeping the "headings start at h2" rule. Negative offsets clipped to prevent
  horizontal page scroll.

## Verification
| Check | Result |
|---|---|
| `pytest -q` | 97 passed, 86 skipped |
| `frontend npm run build` | clean |
| `site npm run build` | clean |
| canonical schema / `blockDesign.ts` parity | byte-identical |
| live admin round-trip (table/callout/image/layout) | exact |
| live public API after approve | exact |
| homepage uniqueness + determinism | PASS |
| volunteer flag writes | 403 |
| legacy pages re-sanitised | byte-identical |

## Notes for the next session
- **Do not commit before reviewing**: the working tree contains this feature plus unrelated
  pre-existing modifications in `backend/` (audit/media/stats/etc.).
- `backend/` is both a nested git repo and tracked by root; root is authoritative here.
- Full detail: `01-triage.md`, `02-requirements.md`, `03-prompt.md`, `05-validation.md`.
