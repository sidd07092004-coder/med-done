#!/usr/bin/env python3
"""Deployment bootstrap for the Medically Complicated admin backend.

Pipeline (all steps are idempotent, so this is safe to run on every deploy or
container restart):

    1. wait for the database to accept connections (retry loop),
    2. apply schema migrations: ``alembic upgrade head``,
    3. seed baseline data (admin user + root group) via ``init_and_seed``.

Exit code is 0 only if every step succeeds; any failure exits non-zero with a
clear message so orchestrators (Docker/compose/CI) can surface it.

Configuration
-------------
The database URL is resolved from (same source as ``alembic/env.py``):
    1. ``ALEMBIC_DATABASE_URL`` env var (explicit deploy override), else
    2. ``DATABASE_URL`` from the environment or ``backend/.env``.
Optional tuning vars: ``DB_WAIT_TIMEOUT`` (seconds, default 60),
``DB_WAIT_INTERVAL`` (seconds, default 2).
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import time
from pathlib import Path

# Alembic and pydantic-settings both resolve paths relative to the CWD, so make
# the script location-independent by running from backend/ and putting it on
# sys.path. This is what the old hardcoded absolute path used to work around.
BACKEND_DIR = Path(__file__).resolve().parent
os.chdir(BACKEND_DIR)
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# An explicit ALEMBIC_DATABASE_URL must drive the whole bootstrap (migrations,
# readiness probe *and* the seed engine), so mirror it onto DATABASE_URL before
# settings is imported. Environment wins over .env in pydantic-settings.
_override = os.environ.get("ALEMBIC_DATABASE_URL")
if _override:
    os.environ["DATABASE_URL"] = _override

from sqlalchemy import text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.core.config import settings  # noqa: E402


def log(message: str) -> None:
    print(f"[bootstrap] {message}", flush=True)


def _safe_url(url: str) -> str:
    try:
        return make_url(url).render_as_string(hide_password=True)
    except Exception:
        return "<unparseable database url>"


async def wait_for_database(url: str, timeout: float, interval: float) -> None:
    """Poll the database until ``SELECT 1`` succeeds or the timeout expires."""
    deadline = time.monotonic() + timeout
    engine = create_async_engine(url, pool_pre_ping=True)
    attempt = 0
    try:
        while True:
            attempt += 1
            try:
                async with engine.connect() as conn:
                    await conn.execute(text("SELECT 1"))
                log(f"database is ready (after {attempt} attempt(s))")
                return
            except Exception as exc:  # noqa: BLE001 - report whatever the driver raises
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    log(f"database not reachable after {timeout:.0f}s: {exc!r}")
                    raise SystemExit(1)
                log(
                    f"database not ready (attempt {attempt}, {type(exc).__name__}); "
                    f"retrying in {interval:.0f}s ({remaining:.0f}s left)"
                )
                await asyncio.sleep(min(interval, max(remaining, 0)))
    finally:
        await engine.dispose()


async def _inspect_schema(url: str) -> tuple[bool, str | None, set[str]]:
    """Return ``(has_pages_table, stamped_revision, pages_columns)``.

    Databases created by ``Base.metadata.create_all`` (this project's historical
    bootstrap) have no ``alembic_version`` row, so ``alembic upgrade head``
    would try to replay the initial revision and fail with
    ``relation "groups" already exists``. A database deployed from an older
    checkout can also be stamped with a revision that no longer exists in this
    repository. Both cases are detected here so they can be adopted safely.
    """
    engine = create_async_engine(url, pool_pre_ping=True)
    try:
        async with engine.connect() as conn:
            tables = set(
                (
                    await conn.execute(
                        text(
                            "SELECT table_name FROM information_schema.tables "
                            "WHERE table_schema = 'public'"
                        )
                    )
                ).scalars()
            )
            has_pages = "pages" in tables
            stamped: str | None = None
            if "alembic_version" in tables:
                stamped = (
                    await conn.execute(text("SELECT version_num FROM alembic_version"))
                ).scalar()
            columns: set[str] = set()
            if has_pages:
                columns = set(
                    (
                        await conn.execute(
                            text(
                                "SELECT column_name FROM information_schema.columns "
                                "WHERE table_schema = 'public' AND table_name = 'pages'"
                            )
                        )
                    ).scalars()
                )
            return has_pages, stamped, columns
    finally:
        await engine.dispose()


# Columns that only exist after the JSON-content rewrite and the 7f3d alignment
# revision. If all of them are present the data migration has already run, so
# the schema is equivalent to "head" even when the stamped revision is unknown.
# Remaining late columns (meta_*, canonical_path, ...) are patched by
# ``app.db.ensure_schema.ensure_schema`` during seeding.
_HEAD_MARKERS = {
    "content",
    "content_text",
    "live_content",
    "live_content_text",
    "excerpt",
    "featured",
    "position",
}


def adoption_revision(columns: set[str]) -> str | None:
    """Pick the revision matching a pre-Alembic ``pages`` table shape.

    Returns ``None`` for an unknown/ambiguous shape so the caller can fail
    loudly instead of guessing (a wrong stamp could skip a data migration).
    """
    if not columns:
        return None
    has = columns.__contains__
    if _HEAD_MARKERS <= columns:
        return "head"
    if has("content") and has("content_text") and has("live_content") and has("live_content_text"):
        return "59ffa011009b"
    if has("body") and has("fields") and not has("content"):
        return "245a985bfcad"
    return "unknown"


def _known_revisions() -> set[str]:
    """Revision ids shipped in this checkout's ``alembic/versions``."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return {rev.revision for rev in ScriptDirectory.from_config(config).walk_revisions()}


def _stamp(revision: str, purge: bool = False) -> None:
    log(f"stamping database as revision {revision}{' (purging old stamp)' if purge else ''}")
    command = [sys.executable, "-m", "alembic", "stamp"]
    if purge:
        # Required when the current stamp is a revision this checkout does not
        # contain: without --purge Alembic tries to resolve it and aborts.
        command.append("--purge")
    command.append(revision)
    result = subprocess.run(command, cwd=str(BACKEND_DIR))
    if result.returncode != 0:
        log(f"alembic stamp failed with exit code {result.returncode}")
        raise SystemExit(result.returncode or 1)


def stamp_legacy_schema() -> None:
    """Adopt a pre-existing schema that Alembic cannot upgrade from directly.

    Two situations are handled:

    1. No ``alembic_version`` at all (schema built by ``create_all``) -> stamp
       the revision matching the observed column shape.
    2. Stamped with a revision this checkout does not contain (an older
       deployment) -> if the schema already has the modern content columns,
       re-stamp it as ``head`` so ``alembic upgrade`` becomes a no-op. Anything
       older is refused, because guessing could skip a data migration.
    """
    has_pages, stamped, columns = asyncio.run(_inspect_schema(settings.DATABASE_URL))
    if not has_pages:
        return  # fresh database: let the migrations build it from scratch

    known = _known_revisions()
    if stamped and stamped in known:
        return  # normal upgrade path

    # A stamp this checkout does not contain (database deployed from an older
    # checkout or a discarded migration chain). Adopt it by shape, purging the
    # stale stamp; ``alembic upgrade`` then applies anything still missing.
    revision = adoption_revision(columns)
    if stamped:
        if revision in (None, "unknown"):
            log(
                f"database is stamped with unknown revision {stamped!r} and its "
                "'pages' table does not match any known schema; refusing to "
                "guess. Restore a backup or migrate it manually."
            )
            raise SystemExit(1)
        log(
            f"database is stamped with unknown revision {stamped!r}; its schema "
            f"matches {revision}, re-stamping accordingly"
        )
        _stamp(revision, purge=True)
        return

    if revision is None:
        return
    if revision == "unknown":
        log(
            "cannot determine the Alembic revision for the existing 'pages' "
            "table (unexpected column set); refusing to guess. Run "
            "`alembic stamp <revision>` manually against this database."
        )
        raise SystemExit(1)
    _stamp(revision)


def run_migrations() -> None:
    """Apply all migrations up to head using the Alembic CLI."""
    log("applying migrations: alembic upgrade head")
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(BACKEND_DIR),
    )
    if result.returncode != 0:
        log(f"migration step failed with exit code {result.returncode}")
        raise SystemExit(result.returncode or 1)
    log("migrations up to date")


def seed() -> None:
    """Run the idempotent seed (admin user + root group)."""
    log("seeding baseline data (idempotent)")
    import init_and_seed

    asyncio.run(init_and_seed.init_and_seed())
    log("seed complete")


def main() -> None:
    timeout = float(os.environ.get("DB_WAIT_TIMEOUT", "60"))
    interval = float(os.environ.get("DB_WAIT_INTERVAL", "2"))

    log(f"starting (backend dir: {BACKEND_DIR})")
    log(f"database target: {_safe_url(settings.DATABASE_URL)}")

    asyncio.run(wait_for_database(settings.DATABASE_URL, timeout, interval))
    stamp_legacy_schema()
    run_migrations()
    seed()

    log("bootstrap finished successfully")


if __name__ == "__main__":
    try:
        main()
    except SystemExit as exc:
        code = exc.code if isinstance(exc.code, int) else 1
        if code != 0:
            log("bootstrap FAILED")
        raise
    except Exception as exc:  # noqa: BLE001
        log(f"bootstrap FAILED: {exc!r}")
        raise SystemExit(1)
