#!/usr/bin/env python3
import asyncio
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent))

from app.db.session import AsyncSessionLocal, engine
from app.db.base import Base


async def init_db():
    async with engine.begin() as conn:
        # Create tables if they don't exist
        await conn.run_sync(Base.metadata.create_all)
    print("Database tables created/verified")


if __name__ == "__main__":
    asyncio.run(init_db())
