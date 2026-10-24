# Medically Complicated — Admin Backend

FastAPI + PostgreSQL backend for the Medically Complicated admin panel.
Pages store their content as JSONB; a clean plain-text version is extracted into
`content_text` on every save (used for search and public rendering).

---

## 1. Prerequisites

- Python 3.12
- PostgreSQL 16 (this project was tested against a cluster on `127.0.0.1:5433`)
- Database name: `mc_admin`

## 2. Setup

### 2.1 Start PostgreSQL

If you are on the dev machine that ships the local PostgreSQL cluster, just run:

```bash
cd backend
./start_pg.sh        # starts PG 16 on 127.0.0.1:5433
```

Otherwise start any PostgreSQL 16 instance and create the `mc_admin` database.

### 2.2 Create the virtualenv and install dependencies

```bash
cd backend
python3 -m venv ../.venv
source ../.venv/bin/activate
pip install -r requirements.txt
```

> **Important:** install from `requirements.txt` (or `pip install .` via Poetry)
> — the venv must contain `fastapi`, `uvicorn`, `python-multipart`, `bcrypt`,
> `pyjwt`, `alembic`, etc. A partial install causes `ModuleNotFoundError`s at
> login time.

### 2.3 Configure environment

Copy `.env.example` to `.env` and adjust if needed:

```bash
cp .env.example .env
```

Default local `.env`:

```
DATABASE_URL=postgresql+asyncpg://postgres:qwerty@127.0.0.1:5433/mc_admin
SECRET_KEY=dev-secret-change-me-8f3a9c1e4b7d2f6a0c5e8b1d4a7f2c9e
```

`app/core/config.py` loads `.env` automatically.

### 2.4 Create tables and seed

```bash
python init_and_seed.py
```

`init_and_seed.py` prints `✓ Database tables created/verified` and creates the
seed data only if it does not already exist.

## 3. Run the server

```bash
source ../.venv/bin/activate
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- Health:        http://127.0.0.1:8000/health
- Swagger UI:    http://127.0.0.1:8000/docs
- ReDoc:         http://127.0.0.1:8000/redoc
- OpenAPI JSON:  http://127.0.0.1:8000/api/v1/openapi.json

---

## 4. Login credentials (seed)

| Role      | Email                 | Password      |
|-----------|-----------------------|---------------|
| Admin     | `admin@example.com`   | `admin123`    |

You can create additional users (e.g. a volunteer) from `POST /admin/users/`.

---

## 5. How to check it works

### Option A — one command smoke test

```bash
cd backend
source ../.venv/bin/activate
PYTHON=../.venv/bin/python ./smoke_test.sh
```

It reads `DATABASE_URL` from `.env`, seeds the DB, starts the server on port
8060, and runs the full workflow:
login → create page → submit → queue → approve → public read.
You should see `SMOKE TEST PASSED` with `content_text = 'Welcome Hello world'`.

### Option B — Swagger UI

1. Open http://127.0.0.1:8000/docs
2. Click **Authorize** (top right) → enter `admin@example.com` / `admin123`
   in the `username` / `password` fields → **Authorize**.
   (This uses the OAuth2 password flow against `/api/v1/auth/login`.)
3. Try `GET /api/v1/auth/me`, `GET /api/v1/auth/verify`, `GET /admin/groups/`,
   then create a page.

> If **Authorize** previously failed, it was because the OAuth2 `tokenUrl`
> pointed at `/admin/auth/login` (which does not exist). It is now correctly
> `/api/v1/auth/login`.

### Option C — curl

```bash
BASE=http://127.0.0.1:8000
TOKEN=$(curl -s -X POST $BASE/api/v1/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@example.com&password=admin123" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -s $BASE/api/v1/auth/me -H "Authorization: Bearer $TOKEN"
curl -s $BASE/admin/groups/ -H "Authorization: Bearer $TOKEN"
```

### Unit tests

```bash
pytest -v
```

---

## 6. API surface

Auth
- `POST /api/v1/auth/login`        (OAuth2 form: `username`, `password`)
- `POST /api/v1/auth/login/json`   (JSON body: `{"email","password"}`)
- `GET  /api/v1/auth/me`           (current user)
- `GET  /api/v1/auth/verify`       (validate Bearer token → `{"valid":true,"user":{...}}`)

Login responses include the JWT plus verifiable identity:

```json
{
  "access_token": "<jwt>",
  "token_type": "bearer",
  "expires_in": 3600,
  "user": {"id": "...", "email": "...", "name": "...", "role": "admin", "is_active": true}
}
```

The JWT payload carries `sub` (user id), `email`, `role`, `name`, and `exp`,
so the token itself can be verified/decoded for authorization.

Admin — users (admin only)
- `GET|POST    /admin/users/`
- `GET|PATCH|DELETE /admin/users/{user_id}`

Admin — groups (tree, unlimited nesting)
- `GET|POST    /admin/groups/`
- `GET|PATCH|DELETE /admin/groups/{group_id}`

Admin — pages (content is JSONB + extracted `content_text`)
- `GET|POST    /admin/pages/`
- `GET         /admin/pages/queue`            (pending approvals)
- `GET|PATCH|DELETE /admin/pages/{page_id}`
- `POST /admin/pages/{page_id}/submit`
- `POST /admin/pages/{page_id}/approve`
- `POST /admin/pages/{page_id}/reject`        (body: `{"reject_note": "..."}`)
- `POST /admin/pages/{page_id}/unpublish`
- `POST /admin/pages/{page_id}/revisions/{rev_id}/restore`
- `POST /admin/pages/{page_id}/translations`  (body: `{"lang": "hr"}`)

Public (published content only)
- `GET /api/v1/homepage?lang=en` → `PagePublic`
- `GET /api/v1/pages?lang=en` → `PagePublic[]` (published, flat)
- `GET /api/v1/pages/{slug}` → `PagePublic`. **The `{slug}` accepts nested slugs containing slashes** (e.g. `bt/diagnosis`, `bt/path/report`) because the route uses a `:path` converter. Returns `404 {"detail":"Page not found"}` for missing/unpublished. (Use `?lang=en` to specify language.)
- `GET /api/v1/navigation?lang=en` → `{ "lang": "en", "groups": [nested tree of {id,name,path,parent_id,position,children}], "pages": [{id,title,slug,group_id,position}] }`

`PagePublic` = `{id,title,slug,lang,content,content_text,excerpt,group_id,contributors,published_at,updated_at,meta_title,meta_description}`. Content shapes: `blocks-v1` (heading/paragraph/list/quote/callout/image/divider) and `home-v1` (`fields`).

---

## 7. Workflow

```
draft ──submit──▶ pending ──approve──▶ published
                    │                      │
                    └──reject──▶ rejected  └──unpublish──▶ draft
```

- Only **admins** may approve, reject, unpublish, and manage users/groups.
- Volunteers can create/edit/draft/submit but cannot publish.
- A page in `pending` is locked against volunteer edits.
- Approving copies current fields into the `live_*` snapshot columns.
