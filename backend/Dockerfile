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

# System dependencies: curl for HEALTHCHECK, openssh-client for SFTP verification
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first so this layer is cached across source-only changes.
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Backend sources
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini
COPY bootstrap.py ./bootstrap.py
COPY init_and_seed.py ./init_and_seed.py
COPY docker-entrypoint.sh ./docker-entrypoint.sh
COPY start.sh ./start.sh
COPY deploy.sh ./deploy.sh

# Non-root runtime user
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/uploads \
    && chmod +x /app/docker-entrypoint.sh /app/start.sh /app/deploy.sh \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/health" || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]