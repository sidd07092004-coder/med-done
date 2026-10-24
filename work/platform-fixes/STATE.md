# Task: platform-fixes (round 2)
- **Status**: COMPLETE
- **Phase**: 5-Report

## Objective
Close the remaining platform gaps: duplicate endpoints, full homepage management,
translated group names, and verified page creation/editor/block coverage.

## Calls Made
| Step | Agent | Status | Output |
|------|-------|--------|--------|
| 0 | orchestrator (triage) | DONE | 01-triage.md |
| 1 | @backend-architect | DONE | dedupe + group translations + homepage tests |
| 2 | @frontend-developer (admin) | DONE | GroupDialog + translation badges |
| 2 | @frontend-developer (site) | DONE | language switcher + RTL |
| 3 | @backend-architect | DONE | homepage precedence fix |
| 4 | orchestrator | DONE | this report |

## Results

### 1. Duplicate endpoints — FIXED
Each GET was registered twice (`""` + `"/"`):
- `stats.py` → kept `""` (`/admin/stats`)
- `audit_logs.py` → kept `""` (`/admin/audit-logs`)
- `media.py` → kept `"/"` (`/admin/media/`)
`tests/test_routes_unique.py` now asserts no duplicate `(path, methods)` in any router.
OpenAPI confirms one entry per endpoint.

### 2. Homepage — FIXED + tested
- `PageUpdate.is_homepage` / `featured` restored; admin-only (volunteer → 403).
- Exactly one homepage per language (`_unset_other_homepages`).
- **Precedence bug fixed**: `GET /api/v1/homepage` now serves the page flagged
  `is_homepage`; the `slug="home"` page is only a fallback. Previously the slug always
  won, which made the admin checkbox look broken.
- Deterministic ordering; verified live (`serves flagged page: True`, deterministic).
- Admin UI: checkbox + sidebar entry (`fetchHomepagePage`).

### 3. Group name translations — DONE
- `groups.name_translations` JSONB (`hr`, `tr`, `ar`), English stays in `name`.
- Idempotent `ensure_schema` adds the column to existing DBs (verified on `mc_admin`).
- Server validates: only hr/tr/ar, HTML-stripped, trimmed, 200-char cap, blanks dropped.
- `GET /api/v1/navigation?lang=xx` localizes group names with English fallback.
- Admin: `GroupDialog` manages English + Croatian + Turkish + Arabic in one modal;
  tree rows show `HR/TR/AR` badges; create/subgroup/edit all use it.
- Site: EN/HR/TR/AR language switcher preserves the route and query; `<html lang/dir>`
  is set (`ar` → `rtl`); nav and breadcrumbs render localized names.

### 4. Page creation / editor / blocks — VERIFIED
- Creation modal: title, slug (auto), group, language → draft.
- Editor supports all **8** block types: heading, paragraph, list, quote, callout,
  image, divider, table.
- Colours/design verified for every element: block background/border/border-width/style/
  radius/padding; text alignment/width/offset/spacing; callout bg/text/border + shape;
  image size/align/fit/radius; table header background, borders, striping, per-column align.
- Live round-trip: all 8 types survive create → submit → approve → `GET /api/v1/pages/{slug}`
  with table, callout and image data intact.

## Verification
| Gate | Result |
|---|---|
| `pytest -q` | **119 passed, 86 skipped** |
| `frontend npm run build` | clean |
| `site npm run build` | clean |
| `/admin/stats`, `/admin/audit-logs`, `/admin/media/` | 200, no duplicates |
| OpenAPI admin paths | 25, one per endpoint |
| Group translations live (create/get/patch/nav hr/tr/ar/en/unknown) | PASS |
| All 8 block types public round-trip | PASS |
| Homepage flag wins + deterministic | PASS |

## Caveats
- No commit made (not requested). Working tree still contains this round plus earlier work.
- `backend/` nested-git hazard still applies (root repo is authoritative).
- Docker unavailable locally, so no container build was run.
