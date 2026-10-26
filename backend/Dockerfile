FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app \
    UPLOAD_DIR=uploads

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