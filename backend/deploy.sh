#!/usr/bin/env bash
# =============================================================================
# backend/deploy.sh — PRODUCTION runner
#
# Wait for DB -> migrate (python bootstrap.py, else alembic upgrade head,
# failures are FATAL — nothing is swallowed) -> exec uvicorn (no reload).
# Usable inside the container image and on a VM/server checkout; delegates to
# the self-contained backend/docker-entrypoint.sh (no repo-root dependency).
#
# Requires DATABASE_URL (or backend/.env on a dev checkout).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export RELOAD=0
exec "$SCRIPT_DIR/docker-entrypoint.sh" "$@"
