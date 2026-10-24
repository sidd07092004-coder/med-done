# Task: page-designer
- **Status**: COMPLETE
- **Phase**: 5-Report

## Objective
Free-form responsive page designer: per-element alignment / size / position for all block
types, table blocks, callout design persistence — end-to-end across backend, admin frontend
and public site. No feature removal. Repair the homepage regression caused by the `main` pull.

## Calls Made
| Step | Agent | Status | Output |
|------|-------|--------|--------|
| 0 | agent-orchestrator (triage) | DONE | 01-triage.md |
| 1 | @product-manager | DONE | 02-requirements.md (1029 lines) |
| 2 | @prompt-engineer | DONE | 03-prompt.md (2411 lines) |
| 3 | @backend-architect | DONE | sanitize/content_text/schemas/crud/routes + 3 test modules |
| 3 | @frontend-developer (admin) | DONE | types, blockDesign, renderer, editor, arrange mode |
| 3 | @frontend-developer (site) | DONE | types, blockDesign, renderer, css |
| 4 | @code-reviewer | DONE | 05-validation.md — FAIL (B1, B2, B3) |
| 4 | fix pass (B1/B2) | DONE | idempotent `_clean_text`, never-delete block cap |
| 5 | orchestrator | DONE | completion.md |

## Root Cause (fixed)
`backend/app/services/sanitize.py::_sanitize_block` rebuilt each block from a fixed
allow-list → every new field (callout colours/shape/label, table blocks, align/size/pos)
was stripped or the whole block dropped on save. Replaced with **validate-and-keep**,
plus `table` added to `BLOCK_TYPES`.

## Verification (all green)
- `pytest -q` → **97 passed, 86 skipped** (skips = deliberate alias shim; DB suite ran).
- `frontend && npm run build` → clean; `site && npm run build` → clean.
- Canonical block + `blockDesign.ts` → **byte-identical** across both apps.
- Live E2E (uvicorn :8096, real PG): table + styled callout + image sizing + layout survive
  `POST /admin/pages` → `GET /admin/pages/{id}` → submit → approve → `GET /api/v1/pages/{slug}`
  **exactly** (modulo intended HTML sanitisation, now idempotent).
- Homepage: two pages flagged in one language → exactly one remains; `GET /api/v1/homepage`
  → 200, deterministic; volunteers → 403 on flags.
- Oversized list (500×2000) → kept, 130 items; oversized inline image → kept, `src=""`, alt
  preserved. No block is ever silently deleted now.

## Decisions Log
- D1: Backend validator is the source of truth; validate-and-keep, never strip-and-drop.
- D2: All new fields optional; absent ≠ zero → 2 084 legacy pages re-sanitise byte-identically.
- D3: Layout model = flow + width + offsetX + alignment + spacing + colours (responsive), not
  absolute canvas. Added a direct-manipulation **Arrange mode** (drag to move/resize) on top.
- D4: Re-applied the homepage fixes lost in the `main` merge.

## Known caveats (non-blocking, documented)
- B3: `backend/` is a nested git repo whose HEAD lacks `sanitize.py`; the **root repo tracks it**
  (109 backend files). Treat the root repo as the source of truth, or stage backend files in both
  before cutting a release. No commit was made (not requested).
- Pydantic `.dict()` deprecation warning in `routes/pages.py` (pre-existing).
- Admin preview and site use different callout code paths (intentional legacy compatibility).
- The admin shell header has a pre-existing 360px overflow, unrelated to this change.
