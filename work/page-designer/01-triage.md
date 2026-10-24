# Triage — Free-form page designer (alignment / size / position / tables)

## Requested (from user)
- Free-form responsive design for **all** block elements: text alignment, image size, positions
  (image-editor-like: move/resize elements freely, responsive).
- Support the developer's new **table** content + callout colour/design changes.
- Backend must **reflect** the new content (persist + return it).
- **No feature removal.** Improve both frontend and backend. Do not ask for permission — proceed.

## Classification
- Type: FEATURE (multi-repo, backend contract + 2 frontends) with a REGRESSION to repair.
- Priority: HIGH — currently the developer's authored content is silently destroyed on save.
- Complexity: HIGH — shared content schema across 3 codebases (backend, admin frontend, public site).

---

## ROOT CAUSE (confirmed by reading the code)

`backend/app/services/sanitize.py` → `_sanitize_block()` rebuilds every block from a **fixed
allow-list of keys**. Any key the frontend sends that is not explicitly re-emitted is
**silently dropped on save**.

| Block | Backend keeps | Frontend sends (dev's new work) | Result |
|---|---|---|---|
| `callout` | `type`, `variant`, `text` | `label`, `backgroundColor`, `textColor`, `borderColor`, `shape` | **all design fields wiped** |
| `image` | `type`, `src`, `alt` | size / alignment / position | **wiped** |
| `table` | *(block type not in `BLOCK_TYPES`)* | whole table block | **entire block dropped** |
| all | — | `align`, `width`, `position`, … | **wiped** |

- `BLOCK_TYPES` (sanitize.py:33) = `{heading, paragraph, list, quote, callout, image, divider}`
  → a `table` block hits `return None` → removed from the array → *"shows only the blocks and
  elements that you have made"* (i.e. only the original 7 types survive).
- `CALLOUT_VARIANTS` (sanitize.py:34) = `{info, warn, ok, bad}` → a `custom` variant is
  coerced to `info`.
- Root cause is **NOT** the frontend: `frontend/src/api/types.ts` + `frontend/src/components/
  BlockRenderer.tsx` already implement callout colour/shape/label correctly. The data is
  destroyed on the way to the database and the public API then serves the stripped version.

## Secondary finding — REGRESSION from the `main` pull
The user pulled `main` (root HEAD = `f7e364f`, branch `main`). That pull **reverted earlier
homepage fixes** that were on disk before:
- `backend/app/schemas/page.py` → `PageUpdate` **lost** `is_homepage` and `featured`
  (only `PageBase` still has them, so the admin editor cannot toggle them).
- `backend/app/api/v1/routes/pages.py` → **lost** the "unset other homepages in the same
  language" logic → multiple pages can be flagged homepage at once.
- `backend/app/api/v1/routes/public.py` → `GET /api/v1/homepage` back to
  `select(...).where(is_homepage==True ...)` with **no LIMIT** → `MultipleResultsFound` (500)
  when two homepages exist in one language.
- `git status` in the **root** repo is clean → the pull also **silently discarded** other
  uncommitted backend work if any.

## Repo topology gotchas (must be respected by every agent)
- `backend/` is a **nested git repo** with its own `.git` (HEAD `a978cc1`, branch `dev`)
  **and** is tracked by the root repo (109 files). `git status` at root does **not** show
  backend edits reliably → always check with `git -C backend status` AND `git status` at root.
  Editing a backend file is seen by root only if root's index is updated too.
- Root branch is now `main`; `dev` exists locally and on origin. `dev` is **behind** `main`
  for frontend files (main has the newer PageEditorPage/UsersPage work) but `dev` still has
  `init_and_seed.py`, `smoke_test.sh`, `start_pg.sh`, `requirements.txt`, `pyproject.toml`
  and `tests/` that `main` **deleted** — a divergence to be aware of, not to "fix" blindly.
- Backend `content` is JSONB; schema comes from `Base.metadata.create_all` in
  `init_and_seed.py` (NOT Alembic). Alembic is broken locally (env.py ignores DATABASE_URL).
- Sanitisation must stay: no raw HTML in text, URLs restricted to `http(s)://`, `/`, `data:image/`.

## Current state of the three renderers
| Location | callout colour/shape | table | layout (align/size/pos) |
|---|---|---|---|
| `frontend/src/api/types.ts` | ✅ label + bg/text/border + shape | ❌ | ❌ |
| `frontend/src/components/BlockRenderer.tsx` | ✅ (`CALLOUT_SHAPE_STYLES`) | ❌ | ❌ |
| `frontend/src/pages/BlockEditor.tsx` | ✅ colour/shape pickers | ❌ | ❌ |
| `site/src/api/types.ts` | ❌ (variant-only) | ❌ | ❌ |
| `site/src/components/BlockRenderer.tsx` | ❌ | ❌ | ❌ |
| `backend/app/services/sanitize.py` | ❌ strips | ❌ drops | ❌ strips |

→ The public `site/` has never supported the design fields; it must be brought in line.

## Verification baseline
- `cd backend && ../.venv/bin/python -m pytest -q` → **2 passed** (current, pre-change).
- Frontend build: `cd frontend && npm run build`; site: `cd site && npm run build`.
- Live E2E needs local PG on **5433** (pw `qwerty`) — start with `backend/start_pg.sh`.
  NOTE: `main` deleted `start_pg.sh`/`smoke_test.sh`/`init_and_seed.py` → they still exist on
  disk? (verify) — if missing locally, seed by other means.
