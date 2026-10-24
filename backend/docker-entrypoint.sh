#!/usr/bin/env bash
# =============================================================================
# backend/docker-entrypoint.sh  (SELF-CONTAINED — the real logic lives here)
#
# Container entrypoint for the FastAPI backend (backend/Dockerfile sets this as
# the image ENTRYPOINT) and the runner behind backend/start.sh (dev, --reload)
# and backend/deploy.sh (prod, no reload).
#
# It always operates from its own directory, so it works both inside the image
# (backend sources at /app) and on a dev machine (the backend/ checkout). It
# has NO dependency on the repo root or on a docker/ folder.
#
# Sequence:
#   1. wait for Postgres to accept connections (retry; fail hard on timeout)
#   2. run migrations: `python bootstrap.py` if present, else `alembic upgrade head`
#      (failures are FATAL — NO `|| true` swallowing)
#   3. exec uvicorn
#
# Environment:
#   DATABASE_URL        required — postgres DSN (postgresql+asyncpg://...);
#                       falls back to backend/.env on a dev machine for
#                       convenience (the image has no .env — set the env var)
#   DB_WAIT_TIMEOUT     seconds to wait for the DB (default: 60)
#   HOST / PORT         uvicorn bind address (default: 0.0.0.0 / 8000)
#   RELOAD              set to 1 to pass --reload (dev only)
# =============================================================================
set -euo pipefail

# The backend directory is where this script lives: /app in the image, the
# backend/ checkout on a dev machine. Never assume a repo root above it.
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BACKEND_DIR"

# --- 1. Wait for the database -------------------------------------------------
# Dev convenience: if DATABASE_URL is not exported, fall back to backend/.env
# (the app itself reads that file via pydantic-settings). The image ships no
# .env, so there DATABASE_URL must come from the environment.
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env | tail -n 1)"
  DATABASE_URL="${DATABASE_URL%\"}"; DATABASE_URL="${DATABASE_URL#\"}"
  export DATABASE_URL
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "FATAL: DATABASE_URL is not set (env var or backend/.env)." >&2
  exit 1
fi

DB_WAIT_TIMEOUT="${DB_WAIT_TIMEOUT:-60}"
echo "Waiting for database (timeout: ${DB_WAIT_TIMEOUT}s) ..."

_db_ready() {
  python - <<'PY'
import os, sys
from urllib.parse import urlparse
import psycopg2

dsn = os.environ["DATABASE_URL"]
# Normalise the SQLAlchemy async driver suffix for psycopg2.
dsn = dsn.replace("postgresql+asyncpg://", "postgresql://", 1)
u = urlparse(dsn)
try:
    conn = psycopg2.connect(
        host=u.hostname or "localhost",
        port=u.port or 5432,
        dbname=(u.path or "/postgres").lstrip("/") or "postgres",
        user=u.username,
        password=u.password,
        connect_timeout=5,
    )
    conn.close()
except Exception as exc:  # noqa: BLE001 - any failure means "not ready yet"
    print(f"not ready: {exc}", file=sys.stderr)
    sys.exit(1)
PY
}

_deadline=$((SECONDS + DB_WAIT_TIMEOUT))
until _db_ready; do
  if [ "$SECONDS" -ge "$_deadline" ]; then
    # Deliberately do not echo the DSN here — it may contain a password.
    echo "FATAL: database not reachable after ${DB_WAIT_TIMEOUT}s." >&2
    exit 1
  fi
  sleep 2
done
echo "Database is reachable."

# --- 2. Migrations ------------------------------------------------------------
# Preferred: bootstrap.py (wait-for-DB -> alembic upgrade head -> idempotent
# seed; owner: backend agent). Fallback: alembic. Failures are fatal.
if [ -f bootstrap.py ]; then
  echo "Running migrations: python bootstrap.py"
  python bootstrap.py
elif [ -f alembic.ini ]; then
  echo "Running migrations: alembic upgrade head"
  alembic upgrade head
else
  echo "FATAL: no bootstrap.py and no alembic.ini in $(pwd) — cannot migrate." >&2
  exit 1
fi
echo "Migrations complete."

# --- 3. Start the API server --------------------------------------------------
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
ARGS=(--host "$HOST" --port "$PORT")
if [ "${RELOAD:-0}" = "1" ]; then
  ARGS+=(--reload)
fi
echo "Starting uvicorn on ${HOST}:${PORT} ..."
exec uvicorn app.main:app "${ARGS[@]}"
