# Completion — platform fixes (round 2)

Yes — all four areas are now fixed and verified.

## 1. Duplicate endpoints
Three routers registered the same GET twice (`""` and `"/"`). Removed the redundant
decorator in each, keeping the path the admin client actually calls:

| Endpoint | Kept |
|---|---|
| stats | `GET /admin/stats` |
| audit logs | `GET /admin/audit-logs` |
| media list | `GET /admin/media/` |

Added `tests/test_routes_unique.py`, which fails if any router ever registers the same
path+method twice. OpenAPI shows 25 admin paths, one per endpoint.

## 2. Homepage
- The admin "Homepage" checkbox now truly controls the public homepage.
- **Root bug found:** `GET /api/v1/homepage` preferred a page with `slug="home"` over the
  flagged page, so ticking the box appeared to do nothing. Precedence reversed: flagged
  page wins, `slug="home"` is the fallback.
- One homepage per language (setting a new one clears the previous).
- Admin-only: volunteers receive 403 if they send the flags.
- Deterministic response (two calls return the same page).
- Covered by DB tests + live E2E.

## 3. Group name translations
Groups now carry names in **Croatian, Turkish and Arabic** (English is the base name):
- New `groups.name_translations` JSONB column, added to existing databases by an
  idempotent schema step (verified on the live `mc_admin` DB).
- Validated server-side: only `hr`/`tr`/`ar` accepted, HTML stripped, trimmed, 200-char
  cap, empty values dropped.
- Public `GET /api/v1/navigation?lang=…` returns the localized group name, falling back
  to English when a translation is missing or the language is unknown.
- Admin: a proper **group dialog** (not browser prompts) edits English + all three
  translations at once; create, add-subgroup and edit all use it; tree rows show
  `HR / TR / AR` badges for translated groups.
- Site: **EN / HR / TR / AR language switcher** in the header (and mobile menu) that
  preserves the current page and query string; `<html lang>` and `dir` update, with
  Arabic rendered right-to-left.

## 4. Page editor, creation and all blocks
Verified end to end:
- **Creation**: dialog with title, auto-slug, group and language → creates a draft.
- **All 8 block types** available and working: heading, paragraph, list, quote, callout,
  image, divider, table.
- **Colours and design on every element**: block background, border colour/width/style,
  corner radius, padding, text alignment, width/offset and spacing; callout
  background/text/border + shape; image width/height/alignment/fit/radius; table header
  background, borders, striping and per-column alignment.
- **Live proof**: a page containing all eight types was created, submitted, approved and
  fetched from the public API with the table, callout colours/shape and image sizing intact.

## Final gates
| Check | Result |
|---|---|
| Backend tests | **119 passed**, 86 skipped |
| Admin build | clean |
| Site build | clean |
| Endpoint dedupe | 200s, no duplicates in OpenAPI |
| Group translations | en/hr/tr/ar + fallback verified |
| Homepage | flag wins, single per language, deterministic |
| All 8 blocks | public round-trip verified |

Nothing was committed (not requested). Full detail: `work/platform-fixes/`.
