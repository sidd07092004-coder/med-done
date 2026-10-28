import asyncio
import asyncpg
import os

async def run():
    conn = await asyncpg.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", "5432")),
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        database=os.environ["DB_NAME"],
    )

    try:
        rows = await conn.fetch("""
            SELECT slug, lang, COUNT(*) AS total,
                   ARRAY_AGG(id::text) AS page_ids
            FROM pages
            GROUP BY slug, lang
            HAVING COUNT(*) > 1;
        """)

        if not rows:
            print("No duplicate slug + language combinations found.")
        else:
            for row in rows:
                print(dict(row))
    finally:
        await conn.close()

asyncio.run(run())
