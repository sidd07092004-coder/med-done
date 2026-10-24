#!/usr/bin/env bash
# =============================================================================
# backend/start.sh — DEV runner
#
# Wait for DB -> migrate (python bootstrap.py, else alembic upgrade head)
# -> start uvicorn WITH --reload. Usable inside the container image and on a
# dev machine; delegates to the self-contained backend/docker-entrypoint.sh
# (no repo-root dependency). For production use backend/deploy.sh (no reload).
#
# Requires DATABASE_URL (falls back to backend/.env on dev machines).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export RELOAD=1
exec "$SCRIPT_DIR/docker-entrypoint.sh" "$@"
