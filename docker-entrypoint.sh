#!/bin/bash
set -e

export PYTHONPATH=/app/backend
export DATABASE_URL=${DATABASE_URL:-"postgresql+asyncpg://postgres:postgres@db:5432/mc_admin"}

cd /app/backend

# Wait for database to be ready
python -c "
import asyncio
import sys
sys.path.insert(0, '.')
from app.db.session import engine
async def check():
    try:
        async with engine.begin() as conn:
            await conn.exec_driver_sql('SELECT 1')
        print('Database ready')
    except Exception as e:
        print(f'Database not ready: {e}')
        sys.exit(1)
asyncio.run(check())
" 2>/dev/null || true

# Initialize and seed
python init_and_seed.py

# Run migrations
if [ -f alembic.ini ]; then
  alembic upgrade head || true
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
