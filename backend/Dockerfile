# syntax=docker/dockerfile:1
# =============================================================================
# backend/Dockerfile — self-contained image for the FastAPI backend.
#
# The build context is THIS directory (backend/), so backend/ is buildable on
# its own with no dependency on any repo-root path:
#
#     docker build -t mc-admin-backend backend/
#     docker build -t mc-admin-backend -f backend/Dockerfile backend/   # same
#
# Inside the image the backend sources live at /app and the app runs from /app
# (the app reads .env / UPLOAD_DIR relative to CWD). ALL configuration is
# injected at RUNTIME via environment variables (DATABASE_URL, SECRET_KEY,
# BACKEND_CORS_ORIGINS, ...) — nothing is baked in.
#
# Boot sequence is defined by /app/docker-entrypoint.sh:
#   wait-for-DB -> python bootstrap.py (fallback: alembic upgrade head) -> uvicorn
# =============================================================================

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app \
    UPLOAD_DIR=uploads

# curl is used by the image HEALTHCHECK only.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first so this layer is cached across source-only changes.
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Backend sources. Explicit COPYs (instead of `COPY . .`) keep dev-only files
# — notably .env, tests and __pycache__ — out of the image and guarantee that
# no secret is baked in. Every path here is relative to backend/ (the context).
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini
COPY bootstrap.py ./bootstrap.py
COPY init_and_seed.py ./init_and_seed.py
COPY docker-entrypoint.sh ./docker-entrypoint.sh
COPY start.sh ./start.sh
COPY deploy.sh ./deploy.sh

# Non-root runtime user. The uploads dir is created here so a fresh named
# volume mounted at /app/uploads inherits the right ownership.
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/uploads \
    && chmod +x /app/docker-entrypoint.sh /app/start.sh /app/deploy.sh \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

# /health is a lightweight endpoint that does not touch the DB.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/health" || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
