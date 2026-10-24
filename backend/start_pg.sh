#!/bin/bash
# Start (or restart) the local PostgreSQL 16 cluster used for development.
#
# This machine's PostgreSQL binaries + data dir live under the
# school-management-backend project. The cluster listens on port 5433 and the
# `postgres` role password is `qwerty` (matching backend/.env).
#
# Usage:  ./start_pg.sh
set -e

PGROOT=/home/aut007/Downloads/school-management-backend
PGBIN="$PGROOT/.pg16/usr/lib/postgresql/16/bin"
PGDATA="$PGROOT/.pgdata"
PORT=5433

export LD_LIBRARY_PATH="$PGROOT/.pg16/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"

if [ ! -x "$PGBIN/pg_ctl" ]; then
  echo "ERROR: pg_ctl not found at $PGBIN/pg_ctl" >&2
  exit 1
fi

if "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  echo "PostgreSQL already running on port $PORT."
  exit 0
fi

echo "Starting PostgreSQL on port $PORT ..."
"$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PORT" -l /tmp/pg5433.log start

echo "Waiting for readiness ..."
for _ in $(seq 1 20); do
  if PGPASSWORD=qwerty "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -tAc "SELECT 1" >/dev/null 2>&1; then
    echo "PostgreSQL is ready on 127.0.0.1:$PORT"
    exit 0
  fi
  sleep 0.5
done

echo "ERROR: PostgreSQL did not become ready. See /tmp/pg5433.log" >&2
exit 1
