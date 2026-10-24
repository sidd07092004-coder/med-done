#!/usr/bin/env bash
# =============================================================================
# scripts/init-db.sh
#
# Idempotent, env-driven bootstrap of the admin-panel database (+ optional
# dedicated role) against an EXISTING Postgres server — e.g. the shared
# `mc-admin` container. Safe to re-run any number of times: roles/databases
# that already exist are left completely untouched (existing passwords are
# NEVER changed).
#
# Modes
#   default          run psql INSIDE a running container via `docker exec`:
#                      DOCKER_DB_CONTAINER=mc-admin ./scripts/init-db.sh
#   PSQL_DIRECT=1    use a local psql binary instead:
#                      PSQL_DIRECT=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5433 \
#                        POSTGRES_PASSWORD=... ./scripts/init-db.sh
#
# Configuration (precedence: real env var > repo-root .env file > default)
#   DOCKER_DB_CONTAINER    container to exec into          (default: mc-admin)
#   PSQL_DIRECT            1 = direct psql, else docker exec (default: 0)
#   PSQL_BIN               psql binary for direct mode     (default: psql)
#   POSTGRES_HOST          direct mode: server host        (default: 127.0.0.1)
#   POSTGRES_PORT          direct mode: server port        (default: 5432)
#   POSTGRES_USER          admin user for the connection   (default: postgres)
#   POSTGRES_PASSWORD      direct mode: that user's password (required there)
#   POSTGRES_DB            database to ensure              (default: mc_admin)
#   POSTGRES_APP_USER      role to ensure / DB owner       (default: POSTGRES_USER)
#   POSTGRES_APP_PASSWORD  password if the role is created (default: empty)
#
# Exit codes: 0 = OK (created or already present), non-zero on real errors.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"

# --- config: env var > .env file > default ------------------------------------
_env_or_file() {  # $1=name  $2=default  -> echoes the value
  local __var="$1" __def="$2" __val
  __val="${!__var:-}"
  if [ -z "$__val" ] && [ -f "$ENV_FILE" ]; then
    __val="$(sed -n "s/^${__var}=//p" "$ENV_FILE" | tail -n 1)"
    __val="${__val%\"}"; __val="${__val#\"}"   # strip one pair of double quotes
    __val="${__val%\'}"; __val="${__val#\'}"   # strip one pair of single quotes
  fi
  printf '%s' "${__val:-$__def}"
}

PSQL_DIRECT="${PSQL_DIRECT:-0}"
DOCKER_DB_CONTAINER="$(_env_or_file DOCKER_DB_CONTAINER mc-admin)"
PSQL_BIN="${PSQL_BIN:-psql}"
POSTGRES_HOST="$(_env_or_file POSTGRES_HOST 127.0.0.1)"
POSTGRES_PORT="$(_env_or_file POSTGRES_PORT 5432)"
POSTGRES_USER="$(_env_or_file POSTGRES_USER postgres)"
POSTGRES_PASSWORD="$(_env_or_file POSTGRES_PASSWORD "")"
POSTGRES_DB="$(_env_or_file POSTGRES_DB mc_admin)"
APP_ROLE="$(_env_or_file POSTGRES_APP_USER "$POSTGRES_USER")"
APP_PASSWORD="$(_env_or_file POSTGRES_APP_PASSWORD "")"

# --- psql invocation -----------------------------------------------------------
run_psql() {  # extra args; SQL can come from stdin (-f -) or -c "..."
  if [ "$PSQL_DIRECT" = "1" ]; then
    if [ -z "$POSTGRES_PASSWORD" ]; then
      echo "ERROR: PSQL_DIRECT=1 needs POSTGRES_PASSWORD (env var or $ENV_FILE)." >&2
      exit 1
    fi
    if ! command -v "$PSQL_BIN" >/dev/null 2>&1; then
      echo "ERROR: psql binary '$PSQL_BIN' not found in PATH (set PSQL_BIN=...)." >&2
      exit 1
    fi
    PGPASSWORD="$POSTGRES_PASSWORD" "$PSQL_BIN" \
      -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" \
      -U "$POSTGRES_USER" -d postgres \
      -v ON_ERROR_STOP=1 "$@"
  else
    if ! command -v docker >/dev/null 2>&1; then
      echo "ERROR: docker not found in PATH — use PSQL_DIRECT=1 for direct psql." >&2
      exit 1
    fi
    docker exec -i "$DOCKER_DB_CONTAINER" psql \
      -U "$POSTGRES_USER" -d postgres \
      -v ON_ERROR_STOP=1 "$@"
  fi
}

# --- connectivity check --------------------------------------------------------
if [ "$PSQL_DIRECT" = "1" ]; then
  echo "Mode: direct psql -> ${POSTGRES_USER}@${POSTGRES_HOST}:${POSTGRES_PORT} (db: postgres)"
else
  echo "Mode: docker exec -> container '${DOCKER_DB_CONTAINER}' as ${POSTGRES_USER} (db: postgres)"
fi

if ! run_psql -tAc "SELECT 1" >/dev/null; then
  echo "ERROR: cannot connect to Postgres. Check container/host/credentials." >&2
  exit 1
fi
echo "Connection OK."

# --- what already exists? ------------------------------------------------------
# NOTE: psql does NOT interpolate :'var' inside -c strings, so these queries
# go through stdin (-f -) where substitution works.
role_exists="$(run_psql -tA -v r="$APP_ROLE" -f - <<'SQL'
SELECT 1 FROM pg_roles WHERE rolname = :'r'
SQL
)"
db_exists="$(run_psql -tA -v d="$POSTGRES_DB" -f - <<'SQL'
SELECT 1 FROM pg_database WHERE datname = :'d' AND datistemplate = false
SQL
)"

if [ "$role_exists" = "1" ]; then
  echo "Role     '$APP_ROLE': already exists — skipping (password NOT modified)."
else
  if [ -n "$APP_PASSWORD" ]; then
    echo "Role     '$APP_ROLE': will be CREATED with LOGIN + password."
  else
    echo "Role     '$APP_ROLE': will be CREATED with LOGIN (no password; set POSTGRES_APP_PASSWORD to add one)."
  fi
fi

if [ "$db_exists" = "1" ]; then
  echo "Database '$POSTGRES_DB': already exists — skipping."
else
  echo "Database '$POSTGRES_DB': will be CREATED (owner: $APP_ROLE)."
fi

# --- create what is missing (idempotent \gexec guards) --------------------------
run_psql -v role="$APP_ROLE" -v pw="$APP_PASSWORD" -v db="$POSTGRES_DB" -f - <<'SQL'
\set ON_ERROR_STOP on

-- Create role with LOGIN (and password, if provided) only when missing.
SELECT 'CREATE ROLE ' || quote_ident(:'role') || ' LOGIN'
    || CASE WHEN COALESCE(:'pw', '') <> ''
            THEN ' PASSWORD ' || quote_literal(:'pw')
            ELSE '' END
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role')
\gexec

-- CREATE DATABASE cannot run in a transaction; \gexec sends each statement
-- separately in autocommit mode.
SELECT 'CREATE DATABASE ' || quote_ident(:'db') || ' OWNER ' || quote_ident(:'role')
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = :'db' AND datistemplate = false
)
\gexec
SQL

# --- verify final state (fails the script if anything is wrong) ----------------
final_db="$(run_psql -tA -v d="$POSTGRES_DB" -f - <<'SQL'
SELECT datname || ' (owner: ' || pg_get_userbyid(datdba) || ')' FROM pg_database WHERE datname = :'d'
SQL
)"
final_role="$(run_psql -tA -v r="$APP_ROLE" -f - <<'SQL'
SELECT rolname || ' (canlogin: ' || rolcanlogin || ')' FROM pg_roles WHERE rolname = :'r'
SQL
)"

if [ -z "$final_db" ] || [ -z "$final_role" ]; then
  echo "ERROR: verification failed — database or role still missing after create." >&2
  exit 1
fi

echo "Verified database: $final_db"
echo "Verified role:     $final_role"
echo "Done. Use it via:  DATABASE_URL=postgresql+asyncpg://${APP_ROLE}:<password>@<host>:<port>/${POSTGRES_DB}"
