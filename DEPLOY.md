# DEPLOY.md — Deploying the separated frontend + backend

This document covers deploying the **backend** (`backend/` → FastAPI + PostgreSQL)
and how it fits together with the separately deployed **frontend** (`frontend/` →
React admin panel). The backend and frontend are built and shipped as two
independent images and two independent GitLab CI pipelines that meet on a shared
Docker network.

> Backend build details live in [`DOCKER.md`](DOCKER.md) (compose / DB bootstrap)
> and [`backend/README.md`](backend/README.md) (app + local dev). The backend image
> is the consolidated, self-contained `backend/Dockerfile` + `backend/docker-entrypoint.sh`.

---

## 1. Architecture at a glance

```
                        host (GitLab runner / server)
                        ┌───────────────────────────────────────────────┐
                        │  docker network: mc-admin-net                  │
                        │                                               │
   :1009  ── frontend ──┤  Medically-Complicated-admin-frontend-v2       │
   (host)   nginx       │    └─ nginx proxies /api, /admin, /uploads ─┐ │
                        │                                             │ │
   :1008  ── backend ───┤  Medically-Complicated-admin-backend-v2      │ │
   (host)   uvicorn     │    (alias: mc-admin-backend:8000) ◀──────────┘ │
                        │              │                                  │
                        └──────────────┼──────────────────────────────────┘
                                       ▼
                          EXTERNAL PostgreSQL (mc-admin server)
                          postgresql+asyncpg://…@<host>:5432/mc_admin
```

| Item           | Frontend pipeline                               | Backend pipeline                               |
|----------------|-------------------------------------------------|------------------------------------------------|
| Container name | `Medically-Complicated-admin-frontend-v2`       | `Medically-Complicated-admin-backend-v2`       |
| Image name     | `medically-complicated-admin-frontend-image-v2` | `medically-complicated-admin-backend-image-v2` |
| Host port      | `1009`                                          | `1008`                                         |
| Internal port  | `80` (nginx)                                    | `8000` (uvicorn)                               |
| Network alias  | —                                               | `mc-admin-backend`                             |
| Pipeline file  | `.gitlab-ci.frontend.yml`                       | `.gitlab-ci.backend.yml`                       |

Both containers join the shared Docker network **`mc-admin-net`**; the frontend
reaches the backend purely by its **network alias** (no host loopback, no
hardcoded host port), so the host port `1008` is for external clients only.

---

## 2. Required GitLab CI/CD variables

Set these under **Settings → CI/CD → Variables** (mark secrets as *Masked* and,
if applicable, *Protected*). **Never commit them.**

### 2.1 Backend pipeline (`.gitlab-ci.backend.yml`)

| Variable            | Required | Example / notes                                                        |
|---------------------|----------|------------------------------------------------------------------------|
| `DATABASE_URL`      | **yes**  | `postgresql+asyncpg://postgres:<pw>@<mc-admin-host>:5432/mc_admin`      |
| `SECRET_KEY`        | **yes**  | Long random JWT signing key; generate a fresh one per environment       |
| `BACKEND_CORS_ORIGINS` | no    | JSON list, e.g. `["https://admin.example.org"]`. Defaults to localhost. |

The pipeline fails fast (in `before_script`) if `DATABASE_URL` or `SECRET_KEY`
is unset. Everything else (image name, ports, network/alias, context) is a
pipeline variable in the file and normally does not need overriding.

### 2.2 Frontend pipeline (owned by the frontend team)

The frontend build must know the backend's public URL only if it does **not**
rely on the nginx same-origin proxy. When using the nginx proxy below, no
backend URL is needed at build time.

---

## 3. The shared network + alias contract

The contract is intentionally minimal so the two pipelines never need to know
each other's host ports:

1. Both pipelines run, on the same Docker host:
   ```bash
   docker network create mc-admin-net || true     # idempotent
   ```
2. The backend container joins it with an alias:
   ```bash
   docker run -d \
     --name Medically-Complicated-admin-backend-v2 \
     --restart unless-stopped \
     --network mc-admin-net \
     --network-alias mc-admin-backend \
     -p 1008:8000 \
     medicines/…back…
   ```
3. The frontend container joins the **same** network and proxies to the alias.

Within `mc-admin-net`, DNS resolves `mc-admin-backend` → the backend container
on port `8000`. This is independent of the host port (`1008`).

> **Deploy order does not matter.** The frontend nginx resolves `mc-admin-backend`
> at *request* time (via Docker's embedded DNS `127.0.0.11`) rather than at
> startup, so the frontend container starts cleanly even if the backend is not up
> yet, and it re-resolves the backend IP roughly every 10s (so backend redeploys
> pick up the new container without restarting the frontend).

### Frontend nginx snippet

```nginx
resolver 127.0.0.11 valid=10s ipv6=off;   # request-time resolution

location /api/     { set $backend http://mc-admin-backend:8000; proxy_pass $backend$request_uri; }
location /admin/   { set $backend http://mc-admin-backend:8000; proxy_pass $backend$request_uri; }
location /uploads/ { set $backend http://mc-admin-backend:8000; proxy_pass $backend$request_uri; }
```

(A variable in `proxy_pass` is what forces per-request resolution; a literal
hostname would be resolved once at startup and cached. The public `site/` SPA
only needs `/api/`.) See [`DOCKER.md`](DOCKER.md) §5 for the full SPA-serving notes.

---

## 4. Pointing the backend at the existing `mc-admin` Postgres

The DB is **external** to the backend container. `DATABASE_URL` must use the
SQLAlchemy async driver (`postgresql+asyncpg://`) and be reachable from the
backend container (use the DB host/IP, not `localhost`, unless the DB is in the
same container/network).

```bash
# GitLab CI/CD variable (masked):
DATABASE_URL = postgresql+asyncpg://postgres:<password>@<mc-admin-host>:5432/mc_admin
```

If the password contains URL-unsafe characters (`@ : / # ? %`), percent-encode
them. To create the dedicated `mc_admin` database/role on the shared server
(idempotent, non-destructive), use `scripts/init-db.sh` — see
[`DOCKER.md`](DOCKER.md) §2.2.

At container start the entrypoint waits for the DB (honouring `DB_WAIT_TIMEOUT`,
default 60s), then runs migrations via `python bootstrap.py`
(`alembic upgrade head` + idempotent seed). **Migration failures abort the
container** — nothing is swallowed.

---

## 5. First-run caveat for a pre-existing database

`bootstrap.py` applies Alembic migrations. A database that was previously
created with `Base.metadata.create_all` (e.g. via `init_and_seed.py`) has the
tables but **no `alembic_version` row**, so `alembic upgrade head` would try to
re-create existing tables and fail.

**One-time fix** — stamp the existing schema as already at head (run against
the target DB *before* the first Docker deploy):

```bash
cd backend
export DATABASE_URL="postgresql+asyncpg://postgres:<pw>@<mc-admin-host>:5432/mc_admin"
python -m alembic stamp head        # records head in alembic_version; no DDL
```

For a **fresh/empty** database, do nothing — `bootstrap.py` creates everything.

> Verify afterwards: `SELECT version_num FROM alembic_version;` must equal the
> current head revision (see `backend/alembic/versions/`).

---

## 6. Deploying

1. Ensure `mc-admin-net` exists (the pipeline does this idempotently).
2. Set the CI/CD variables from §2.1.
3. Push to the backend branch; the `build-and-deploy` stage:
   - creates the network, builds `backend/` into the image,
   - removes the old container (`docker rm -f`),
   - runs the new container on `mc-admin-net` with alias `mc-admin-backend`,
   - publishes `1008:8000`,
   - polls `http://127.0.0.1:1008/health` (up to 30 × 2s) and fails the job
     with container logs if it never becomes healthy.
4. Deploy the frontend pipeline the same way (port `1009`, same network).

Local, compose-based alternative (single host, all services):

```bash
cp .env.example .env    # set POSTGRES_PASSWORD + SECRET_KEY
docker compose up --build -d
curl -fsS http://127.0.0.1:8000/health
```

---

## 7. Rollback

Images are tagged both with the commit SHA and `latest`; the SHA tag is the
rollback handle.

```bash
# List recent backend images/tags
docker images medically-complicated-admin-backend-image-v2

# Roll back to a known-good SHA
docker rm -f Medically-Complicated-admin-backend-v2
docker run -d \
  --name Medically-Complicated-admin-backend-v2 \
  --restart unless-stopped \
  --network mc-admin-net --network-alias mc-admin-backend \
  -p 1008:8000 \
  -e DATABASE_URL="$DATABASE_URL" -e SECRET_KEY="$SECRET_KEY" \
  -e BACKEND_CORS_ORIGINS="$BACKEND_CORS_ORIGINS" -e ENVIRONMENT=production \
  medically-complicated-admin-backend-image-v2:<known-good-sha>

# Verify, then investigate logs from the failed container if still present
curl -fsS http://127.0.0.1:1008/health
docker logs --tail 200 Medically-Complicated-admin-backend-v2
```

Notes:

- **Database migrations are not auto-reverted.** If a release added a schema
  migration, rolling the *image* back does not downgrade the DB. Prefer
  forward-compatible migrations (additive columns/tables). To downgrade
  explicitly: `python -m alembic downgrade -1` from `backend/` with
  `DATABASE_URL` pointing at the target DB — after confirming it is safe.
- Rolling back the frontend is independent (its own image tags / port `1009`).
- The `uploads` volume is untouched by container replacement.

---

## 8. Files owned by the backend deployment

| Path                              | Role                                                              |
|-----------------------------------|-------------------------------------------------------------------|
| `backend/Dockerfile`              | Self-contained backend image (context = `backend/`)               |
| `backend/docker-entrypoint.sh`    | wait-for-DB → `bootstrap.py` → uvicorn (self-contained)           |
| `backend/start.sh` / `backend/deploy.sh` | dev (`--reload`) / prod runners via the entrypoint         |
| `.gitlab-ci.backend.yml`          | Standalone backend CI/CD pipeline                                 |
| `docker-compose.yml`              | Local `db` + `backend` stack (builds `backend/Dockerfile`)         |
| `docker/initdb/`                  | First-boot DB/role bootstrap for the compose `db` service          |

Superseded and removed: `docker/backend.Dockerfile`, `docker/entrypoint-backend.sh`.
