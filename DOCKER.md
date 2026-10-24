# DOCKER.md — Docker deployment & database bootstrap

Self-contained, env-driven deployment for the Medically Complicated stack:

| Service    | What it is                                          | Port (host) |
|------------|-----------------------------------------------------|-------------|
| `db`       | PostgreSQL 16 (Alpine), named volume `db-data`      | internal    |
| `backend`  | FastAPI API (`backend/Dockerfile`, build context `backend/`), port 8000 | `8000` |
| SPAs       | `frontend/` (admin) + `site/` (public) — static builds, served separately (see §5); `frontend/` also has its own Docker image for the separated deploy (§6) | `5173`/`5174` in dev |

No secrets are committed. Everything is configured through the repo-root
`.env` (compose) or `backend/.env` (non-Docker local dev — see
[backend/README.md](backend/README.md)).

---

## 1. Quick start (fresh compose stack)

```bash
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD and SECRET_KEY (both required; compose
# refuses to start without them). Everything else has safe defaults.
docker compose up --build
```

Then:

- API health:  <http://127.0.0.1:8000/health>
- Swagger UI:  <http://127.0.0.1:8000/docs>
- OpenAPI:     <http://127.0.0.1:8000/api/v1/openapi.json>

The backend container entrypoint (`backend/docker-entrypoint.sh`, baked into
the image as `/app/docker-entrypoint.sh`) waits for Postgres
(`depends_on: service_healthy` *plus* its own retry loop), then runs
migrations — `python bootstrap.py` if present, otherwise `alembic upgrade
head` — and finally `exec uvicorn app.main:app`. **Migration failures kill the
container** (no `|| true` swallowing), so a broken deploy is loud, not silent.

Seed login (created idempotently by the backend's bootstrap/seed step —
credentials documented in [backend/README.md](backend/README.md) §4).
Change the password after first login.

Stop / reset:

```bash
docker compose down          # stop; volumes (db data, uploads) are KEPT
docker compose down -v       # DELETES db-data and uploads volumes — data loss!
```

## 2. Database bootstrap

### 2.1 Fresh compose stack — automatic

On the **first** start of a fresh `db` volume, the official Postgres image
executes `docker/initdb/01-create-admin-db.sql`, which ensures the admin
database + role exist (idempotent `\gexec` guards, safe if re-run by hand).
Configuration: `ADMIN_DB_NAME` / `ADMIN_DB_USER` / `ADMIN_DB_PASSWORD` in
`.env`. With default values it is a no-op (the role/database already exist).

> Init scripts only run on an **empty** data volume. To re-run them on an
> existing volume: `docker compose down -v && docker compose up` (destroys
> data!) or use `scripts/init-db.sh` (non-destructive, any time).

### 2.2 Existing Postgres server (e.g. the shared `mc-admin` container)

The teammate's `mc-admin` container already hosts a `medically_complicated`
database. To give the admin panel its **own separate database** on the same
server, without touching the existing one:

```bash
cp .env.example .env                # once; then edit as needed
./scripts/init-db.sh                # defaults to: docker exec into `mc-admin`
```

What it does (idempotent — safe to re-run; existing objects are never
modified, existing passwords are never changed):

1. connects via `docker exec -i mc-admin psql -U postgres` (override with
   `DOCKER_DB_CONTAINER=...`),
2. creates role `POSTGRES_APP_USER` with `LOGIN` **only if missing**
   (adds a password only when creating, if `POSTGRES_APP_PASSWORD` is set),
3. creates database `POSTGRES_DB` (default `mc_admin`) owned by that role
   **only if missing**,
4. verifies and prints the final state. Exits non-zero on real errors.

Direct `psql` instead of `docker exec`:

```bash
PSQL_DIRECT=1 POSTGRES_HOST=<host> POSTGRES_PORT=<port> \
  POSTGRES_PASSWORD=<admin-pw> POSTGRES_DB=mc_admin ./scripts/init-db.sh
```

Then point the backend at that server by setting in `.env`:

```bash
DATABASE_URL=postgresql+asyncpg://postgres:<password>@<mc-admin-host>:5432/mc_admin
```

and run the backend either with compose (the `db` service simply becomes
unused — or remove it) or directly on the host per
[backend/README.md](backend/README.md).

## 3. What CI / deploy must set

Required (compose fails fast without them):

| Variable            | Purpose                                    |
|---------------------|--------------------------------------------|
| `POSTGRES_PASSWORD` | Postgres superuser password for `db`       |
| `SECRET_KEY`        | JWT signing key — generate a fresh random value per environment |

Recommended for production:

| Variable                  | Purpose                                        |
|---------------------------|------------------------------------------------|
| `DATABASE_URL`            | explicit DSN (needed if the password is not URL-safe, or for an external server) |
| `BACKEND_CORS_ORIGINS`    | JSON list; lock down to the real site origins  |
| `ENVIRONMENT=production`  | production error behaviour                     |
| `BACKEND_PORT`            | host port if 8000 is taken                     |

Minimal CI deploy sequence:

```bash
cp .env.example .env
# write secrets from the CI secret store into .env (never into the repo):
#   POSTGRES_PASSWORD, SECRET_KEY  (+ DATABASE_URL, BACKEND_CORS_ORIGINS, ...)
docker compose up -d --build
curl -fsS http://127.0.0.1:8000/health   # fail the pipeline if unhealthy
```

The image itself (`backend/Dockerfile`) contains no configuration; the
same image can be promoted dev → staging → prod by only changing env vars.

## 4. Volumes & backups

| Volume       | Mounted at            | Contents                          |
|--------------|-----------------------|-----------------------------------|
| `db-data`    | `/var/lib/postgresql/data` | all Postgres data             |
| `uploads`    | `/app/uploads`        | user-uploaded images              |

Back up with `pg_dump` (logical, works while the stack runs):

```bash
docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > backup.dump
# restore into an empty database of the same name:
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < backup.dump
```

For the external `mc-admin` server, dump the **admin panel database only**
(never the shared one):

```bash
docker exec mc-admin pg_dump -U postgres -Fc mc_admin > mc_admin_$(date +%F).dump
```

Uploads live in the `uploads` volume — include it in file-level backups
(`docker run --rm -v medically-complicated_uploads:/u -v $PWD:/b alpine tar czf /b/uploads.tgz -C /u .`).

## 5. Serving the SPAs

`frontend/` (admin panel, dev port 5173) and `site/` (public site, dev port
5174) are static Vite builds; they are **not** part of the compose stack.
Build and host them with any static file server, e.g. nginx:

```bash
(cd frontend && npm ci && npm run build)   # -> frontend/dist
(cd site     && npm ci && npm run build)   # -> site/dist
```

For the separated deploy you don't have to hand-roll this: `frontend/` ships
its own self-contained image — `frontend/Dockerfile` is a multi-stage build
(`node:20-alpine` → `nginx:1.27-alpine`) that serves the built SPA **and**
reverse-proxies `/api`, `/admin` and `/uploads` to the backend, using
`frontend/nginx.conf` (template) + `frontend/entrypoint.sh` (renders it with
`BACKEND_ORIGIN`, default `http://mc-admin-backend:8000`). See §6.

Requirements for the static host (both SPAs use same-origin URLs):

- `frontend` must proxy/rewrite `/api`, `/admin` and `/uploads` → the backend
  (`http://backend:8000` on the compose network, or your host/port).
- `site` must proxy/rewrite `/api` → the backend.

Example nginx location blocks (per SPA vhost):

```nginx
location /api/    { proxy_pass http://backend:8000; }
location /admin/  { proxy_pass http://backend:8000; }
location /uploads/{ proxy_pass http://backend:8000; }
```

In dev, just run `npm run dev` in each dir — their Vite configs already proxy
to `127.0.0.1:8000` (see `frontend/vite.config.ts`, `site/vite.config.ts`).

## 6. Separated deploy & CI

Frontend and backend are now built and shipped as **two independent images**,
one self-contained Dockerfile per app folder. There is no repo-root build
context: `docker/` only holds the `initdb/` SQL used by the compose `db`
service.

| Path                      | Role                                                                  |
|---------------------------|-----------------------------------------------------------------------|
| `backend/Dockerfile`      | backend image — build context is `backend/`: `docker build -t mc-admin-backend backend/`. Inside the image sources live at `/app`, runtime user is non-root `appuser`, `HEALTHCHECK` hits `/health`, `ENTRYPOINT` is `/app/docker-entrypoint.sh` |
| `backend/docker-entrypoint.sh` | the real, self-contained entrypoint (no repo-root wrapper): wait-for-DB → `python bootstrap.py` (fallback `alembic upgrade head`) → `exec uvicorn` |
| `frontend/Dockerfile`     | admin-panel image — multi-stage `node:20-alpine` → `nginx:1.27-alpine`, serves the SPA and reverse-proxies `/api`, `/admin`, `/uploads` to the backend |
| `frontend/nginx.conf`     | nginx template; `frontend/entrypoint.sh` renders it (`envsubst` on `BACKEND_ORIGIN`) and starts nginx |
| `.gitlab-ci.yml`          | monorepo aggregator — `include:`s the two pipelines below             |
| `.gitlab-ci.frontend.yml` | frontend pipeline → container `Medically-Complicated-admin-frontend-v2`, host port `1009` → `80` |
| `.gitlab-ci.backend.yml`  | backend pipeline → container `Medically-Complicated-admin-backend-v2`, host port `1008` → `8000` |

Both CI jobs run on `main` and join the shared Docker network
**`mc-admin-net`**; the backend joins it with the alias **`mc-admin-backend`**,
so the frontend nginx reaches it at `http://mc-admin-backend:8000`
(independent of the host port). Because each image is self-contained, either
app can later move into its own repo by copying its `.gitlab-ci.*.yml` in as
`.gitlab-ci.yml`.

Full deployment guide — required GitLab CI/CD variables, deploy steps,
rollback, and the first-run migration caveat for pre-existing databases:
**[DEPLOY.md](DEPLOY.md)**.

## 7. Script map

| Path                            | Role                                                            |
|---------------------------------|-----------------------------------------------------------------|
| `docker-compose.yml`            | `db` + `backend` stack, all env-driven (builds `backend/Dockerfile`, context `./backend`) |
| `backend/Dockerfile`            | self-contained backend image: deps + sources at `/app`, non-root `appuser`, health `/health`, context `backend/` |
| `backend/docker-entrypoint.sh`  | image entrypoint (`/app/docker-entrypoint.sh`): wait-for-DB → migrations → uvicorn |
| `docker/initdb/01-create-admin-db.sql` | first-boot idempotent DB/role bootstrap (compose `db`)   |
| `scripts/init-db.sh`            | idempotent DB/role bootstrap for an **existing** Postgres server |
| `backend/start.sh`              | dev runner (uvicorn `--reload`) via `backend/docker-entrypoint.sh` |
| `backend/deploy.sh`             | prod runner (no reload) via `backend/docker-entrypoint.sh`      |
| `frontend/Dockerfile` + `frontend/nginx.conf` + `frontend/entrypoint.sh` | self-contained admin-SPA image (§6)   |

Application details (API surface, workflow, RBAC, local non-Docker dev):
see [backend/README.md](backend/README.md).
