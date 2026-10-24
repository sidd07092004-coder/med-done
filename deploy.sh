#!/bin/bash
set -e

# Environment
export PYTHONPATH=/app/backend
export DATABASE_URL=${DATABASE_URL:-"postgresql+asyncpg://postgres:postgres@db:5432/mc_admin"}

cd /app/backend

# Initialize DB and seed
python init_and_seed.py

# Run migrations (if alembic is set up)
if [ -f alembic.ini ]; then
  alembic upgrade head || true
fi

# Start server
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
