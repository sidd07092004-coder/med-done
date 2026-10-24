# AGENTS.md

FastAPI + PostgreSQL backend for the "Medically Complicated" admin panel. The real
code is `backend/`; everything else at the repo root is reference material (see
Sources of truth).

## Layout / wiring (non-obvious)
- Entrypoint `backend/app/main.py` → `app.main:app`. It mounts three routers:
  - `app/api/v1/router.py` (`api_router`) at `/api/v1` — **auth only**.
  - `app/api/v1/admin.py` (`admin_router`) at `/admin` — users, groups, pages.
  - `app/api/v1/public_api.py` (`public_router`) at `/api/v1` — public pages.
- **Frontends:** `frontend/` = admin panel (React 18 + Vite 5 + TS, dev port **5173**; Vite proxies `/api`, `/admin`, `/uploads` → `http://127.0.0.1:8000`). `site/` = public website (React 18 + Vite 5 + TS, dev port **5174**; Vite proxies `/api` → `http://127.0.0.1:8000`).
- **Dead file:** `app/api/v1/public.py` is imported by nothing. The live public
  router is `app/api/v1/public_api.py`. Don't edit the dead one.
- **Public API:** the public router now supports **nested slugs** via `:path` converter (e.g. `bt/diagnosis`) on `GET /api/v1/pages/{slug:path}` and exposes `GET /api/v1/navigation?lang=en` returning the site menu tree + flat pages.
- **Two deps modules:** `app/core/deps.py` is the real one; `app/api/deps.py` only
  re-exports it. Route files import `app.api.deps`; `routes/auth.py` imports `app.core.deps`.
- Routers are lazy (`_IncludedRouter`) under FastAPI 0.143 — iterating `app.routes`
  or `router.routes` shows placeholders and makes routes look missing. Verify routes
  by starting the server and reading `/api/v1/openapi.json`, not by introspection.

## Setup & run (run these from `backend/`)
```bash
./start_pg.sh                 # start local PG16 on 127.0.0.1:5433
source ../.venv/bin/activate  # venv is at repo root, NOT backend/
python init_and_seed.py       # create tables + seed admin (idempotent)
python -m uvicorn app.main:app --reload --port 8000
```
- **Must run from `backend/`**: `pydantic-settings` loads `.env` relative to CWD.
- Install deps from `backend/requirements.txt`. `pyproject.toml` is Poetry; the root
  `Pipfile` is stale/incomplete — ignore it.
- `start.sh`, `deploy.sh`, `docker-entrypoint.sh` are Docker-only (`/app` paths, host
  `db:5432`, password `postgres`) and are NOT for local use.
- `init_and_seed.py` hardcodes this machine's absolute repo path for `sys.path`, so it
  only runs at this checkout path.

## Testing
```bash
pytest -v                                   # only / and /health; no DB needed
PYTHON=../.venv/bin/python ./smoke_test.sh  # full E2E on port 8060 (needs PG + seed)
```
`pytest-asyncio` is in strict mode; async tests need `@pytest.mark.asyncio` (there is no
pytest config file).

## Env / credentials gotchas
- Dev DB password is **`qwerty`** → `postgres:qwerty@127.0.0.1:5433/mc_admin`.
  `.env.example`, `alembic.ini`, and the Docker scripts all say `postgres:postgres` and
  are WRONG for local dev.
- `.env` (git-ignored) is required; copy `.env.example` then fix the password.
- Sourcing `.env` in bash corrupts `BACKEND_CORS_ORIGINS` (bash strips the JSON quotes).
  `smoke_test.sh` greps only the keys it needs for this reason.
- `app/db/session.py` uses `echo=True` → all SQL is logged; filter it when reading output.

## Schema / migrations
- Schema comes from `Base.metadata.create_all` in `init_and_seed.py`, **not** Alembic.
- Alembic is present but **broken locally**: `alembic/env.py` ignores `DATABASE_URL` and
  `alembic.ini` hardcodes `postgres:postgres`, so `alembic current/upgrade` fail auth
  (deploy scripts swallow this with `|| true`). If you touch migrations, first wire
  `env.py` to `settings.DATABASE_URL`.
- Content is `content` (JSONB) + derived `content_text` (via `app/services/content_text.py`).
  `docs/backend-plan.md` describes an older `body`/`fields` schema — it is stale; trust the models.

## Domain rules
- Workflow: `draft → submit → pending → approve → published`; `reject` → `rejected`
  (requires `reject_note`); `unpublish` → `draft`. Approve copies current fields into the
  `live_*` snapshot; the public API always serves `live_*`.
- RBAC: only `admin` may approve/reject/unpublish and manage users/groups; `volunteer`
  gets 403 there. Pending pages are locked against volunteer edits.
- Auth: `POST /api/v1/auth/login` (OAuth2 form, field `username`),
  `POST /api/v1/auth/login/json` (`{email,password}`), `GET .../me`, `GET .../verify`.
  JWTs are signed via `app/core/jwt_compat.py` (PyJWT preferred, python-jose fallback) —
  don't reintroduce a hard `import jose`.

## Sources of truth
- `mc-admin-proto-v8_2.html` — original client-only prototype (localStorage, no API
  calls). Source of truth for content shape and workflows.
- `backend/IMPLEMENTATION_PROMPTS.txt` (== root `mc-backend-implementation-prompts.txt`)
  — staged build plan. Stages 1–5 are implemented; **6–8 largely are NOT** (audit-log
  service, media upload, HTML sanitization on save, stats, export/import, sitemap,
  contributors endpoints, comprehensive tests).
- `docs/backend-plan.md` — older design doc; its schema section is outdated.
