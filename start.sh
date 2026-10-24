#!/bin/bash
export PYTHONPATH=/app
if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="postgresql+asyncpg://postgres:postgres@db:5432/mc_admin"
fi
cd /app/backend
python init_and_seed.py
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
