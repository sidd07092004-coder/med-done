-- =============================================================================
-- 01-create-admin-db.sql
--
-- Runs automatically ONCE, on the FIRST initialization of the `db` container's
-- data volume (postgres image executes everything in
-- /docker-entrypoint-initdb.d/ against the freshly created POSTGRES_DB).
--
-- Purpose: ALSO ensure the separate "admin panel" database and (optionally) a
-- dedicated login role exist, even when POSTGRES_DB points at a different
-- (e.g. shared) database. This is how you keep the admin panel's data fully
-- separated on a shared Postgres server.
--
-- Idempotency: every statement is guarded with "if NOT EXISTS" logic via
-- psql's \gexec (a SELECT that emits the DDL only when the object is missing).
-- Re-running this file by hand is therefore always safe.
--
-- Configuration (read from the container environment via psql \getenv,
-- available in psql >= 15 / postgres:16 images; unset env var = no error):
--
--   ADMIN_DB_NAME     Extra database to ensure. Default: mc_admin.
--                     If it equals POSTGRES_DB (already created by the image
--                     entrypoint) this is a harmless no-op.
--   ADMIN_DB_USER     Role that will own ADMIN_DB_NAME; created with LOGIN if
--                     missing. Default: postgres (i.e. reuse the superuser).
--   ADMIN_DB_PASSWORD Optional password for ADMIN_DB_USER. Only applied when
--                     the role is CREATED by this script — an existing role's
--                     password is never touched. Leave empty to skip.
-- =============================================================================

\set ON_ERROR_STOP on

-- Read optional env vars and apply defaults when they are unset.
\getenv ADMIN_DB_NAME ADMIN_DB_NAME
\getenv ADMIN_DB_USER ADMIN_DB_USER
\getenv ADMIN_DB_PASSWORD ADMIN_DB_PASSWORD

\if :{?ADMIN_DB_NAME}
\else
  \set ADMIN_DB_NAME mc_admin
\endif

\if :{?ADMIN_DB_USER}
\else
  \set ADMIN_DB_USER postgres
\endif

-- ADMIN_DB_PASSWORD has no default value — define it as '' so :'...' always
-- substitutes cleanly (an UNDEFINED psql variable is NOT substituted).
\if :{?ADMIN_DB_PASSWORD}
\else
  \set ADMIN_DB_PASSWORD ''
\endif

\echo [initdb] ensuring role :'ADMIN_DB_USER' and database :'ADMIN_DB_NAME' exist ...

-- 1) Role: create with LOGIN (+ password, if provided) only when missing.
--    \gexec executes each selected string as a standalone statement.
SELECT 'CREATE ROLE ' || quote_ident(COALESCE(:'ADMIN_DB_USER', 'postgres'))
    || ' LOGIN'
    || CASE WHEN COALESCE(:'ADMIN_DB_PASSWORD', '') <> ''
            THEN ' PASSWORD ' || quote_literal(:'ADMIN_DB_PASSWORD')
            ELSE '' END
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = COALESCE(:'ADMIN_DB_USER', 'postgres')
)
\gexec

-- 2) Database: create (owned by that role) only when missing.
--    CREATE DATABASE cannot run inside a transaction block; \gexec sends each
--    selected statement on its own, in autocommit mode, so this is fine.
SELECT 'CREATE DATABASE ' || quote_ident(COALESCE(:'ADMIN_DB_NAME', 'mc_admin'))
    || ' OWNER ' || quote_ident(COALESCE(:'ADMIN_DB_USER', 'postgres'))
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database
    WHERE datname = COALESCE(:'ADMIN_DB_NAME', 'mc_admin')
)
\gexec

-- 3) Final state (for the container logs).
SELECT d.datname AS database, pg_get_userbyid(d.datdba) AS owner
FROM pg_database d
WHERE d.datname = COALESCE(:'ADMIN_DB_NAME', 'mc_admin')
  AND d.datistemplate = false;

\echo [initdb] done.
