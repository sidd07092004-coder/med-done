# Triage — platform fixes round 2

## Confirmed findings

### 1. Duplicate endpoints (real)
Each of these registers the same GET twice (empty path + "/"):
- `app/api/v1/routes/stats.py` — `@router.get("")` + `@router.get("/")`
- `app/api/v1/routes/media.py` — `@router.get("")` + `@router.get("/")`
- `app/api/v1/routes/audit_logs.py` — `@router.get("")` + `@router.get("/")`

Client contract (must keep working):
- `GET /admin/stats` (no slash) → keep `""`
- `GET /admin/audit-logs` (no slash) → keep `""`
- `GET /admin/media/` (trailing slash) → keep `"/"`

### 2. Group names have no translations (missing)
`Group` has only `name`. Site nav and breadcrumbs render `g.name` for every language.
Need: `name_translations` (hr/tr/ar) + admin management + localized public nav
(fallback to base name). English is the base `name`; `stats.LANGS = ["hr","tr","ar"]`.

### 3. Homepage — already implemented this session, needs a regression test
Single homepage per language, deterministic public query, admin-only flags.

### 4. Page editor / creation / blocks — present, verify parity
- Creation modal exists (`PagesListPage` → `NewPageDialog`).
- Editor catalogue has all 8 types: paragraph, heading, list, quote, callout, image,
  divider, table.
- Colours: layout background/border, callout (bg/text/border), table (header bg).
- Needs a create→edit→approve→public round-trip assertion covering every block type.

## Assignment (disjoint file ownership)
- BACKEND: 1, 2, 3 backend half, 4 backend tests.
- ADMIN: 2 admin UI + types/client.
- SITE: language switcher + localized nav rendering.
