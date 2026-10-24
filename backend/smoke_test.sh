#!/bin/bash
# End-to-end smoke test for the Medically Complicated admin API.
# Starts the server on port 8060, runs the full workflow, then stops.
set -e

PORT=${PORT:-8060}
BASE="http://127.0.0.1:${PORT}"
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@example.com}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-admin123}

cd "$(dirname "$0")"

# Pull only DATABASE_URL / SECRET_KEY from .env (do NOT source the whole file:
# bash strips the inner quotes of JSON values like BACKEND_CORS_ORIGINS).
if [ -f .env ]; then
  DATABASE_URL=${DATABASE_URL:-$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)}
  SECRET_KEY=${SECRET_KEY:-$(grep -E '^SECRET_KEY=' .env | head -1 | cut -d= -f2-)}
fi

export PYTHONPATH=$(pwd)
export DATABASE_URL=${DATABASE_URL:-"postgresql+asyncpg://postgres:postgres@127.0.0.1:5433/mc_admin"}
PYTHON=${PYTHON:-python3}

echo "== Ensuring DB + seed =="
"$PYTHON" init_and_seed.py | grep -E "✓" || true

echo "== Starting server on :$PORT =="
"$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" >/tmp/mc_smoke.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

# Wait for readiness (poll) instead of a fixed sleep — app startup can take
# several seconds under load, which made a fixed `sleep 3` flaky.
for _ in $(seq 1 60); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "ERROR: server process died during startup; see /tmp/mc_smoke.log" >&2
    tail -20 /tmp/mc_smoke.log >&2 || true
    exit 1
  fi
  curl -sf "$BASE/health" >/dev/null 2>&1 && break
  sleep 0.5
done

echo "== Health =="
curl -sf "$BASE/health" && echo

echo "== Login as admin =="
TOKEN=$(curl -sf -X POST "$BASE/api/v1/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=${ADMIN_EMAIL}&password=${ADMIN_PASSWORD}" \
  | "$PYTHON" -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
echo "token acquired"

AUTH="Authorization: Bearer $TOKEN"

echo "== /me =="
curl -sf "$BASE/api/v1/auth/me" -H "$AUTH" && echo

echo "== /verify =="
curl -sf "$BASE/api/v1/auth/verify" -H "$AUTH" && echo

echo "== JSON login =="
curl -sf -X POST "$BASE/api/v1/auth/login/json" -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
  | "$PYTHON" -c "import sys,json;d=json.load(sys.stdin);print('json login ok, role =', d['user']['role'], ', expires_in =', d['expires_in'])"

echo "== Groups tree =="
curl -sf "$BASE/admin/groups/" -H "$AUTH" && echo

echo "== Create page =="
SLUG="smoke-$(date +%s)"
GROUP_ID=$(curl -sf "$BASE/admin/groups/" -H "$AUTH" \
  | "$PYTHON" -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
PAGE=$(curl -sf -X POST "$BASE/admin/pages/" -H "$AUTH" -H "Content-Type: application/json" -d "{
  \"title\": \"Smoke Test Page\",
  \"slug\": \"${SLUG}\",
  \"lang\": \"en\",
  \"group_id\": \"${GROUP_ID}\",
  \"content\": {\"blocks\":[{\"type\":\"heading\",\"text\":\"Welcome\"},{\"type\":\"paragraph\",\"text\":\"Hello world\"}]}
}")
PAGE_ID=$(echo "$PAGE" | "$PYTHON" -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "page id: $PAGE_ID"

echo "== Submit =="
curl -sf -X POST "$BASE/admin/pages/$PAGE_ID/submit" -H "$AUTH" >/dev/null && echo ok

echo "== Queue =="
curl -sf "$BASE/admin/pages/queue" -H "$AUTH" >/dev/null && echo ok

echo "== Approve =="
curl -sf -X POST "$BASE/admin/pages/$PAGE_ID/approve" -H "$AUTH" >/dev/null && echo ok

echo "== Public read =="
curl -sf "$BASE/api/v1/pages/${SLUG}" \
  | "$PYTHON" -c "import sys,json;d=json.load(sys.stdin);print('content_text =', repr(d.get('content_text')))"

echo ""
echo "SMOKE TEST PASSED"
