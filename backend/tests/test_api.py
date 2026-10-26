import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.mark.asyncio
async def test_health():
    # The health endpoint should respond with a simple "ok" status.
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_root():
    # The root endpoint should be reachable.
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_dynamic_form_routes_are_wired():
    # Check the dynamic form routes are registered by reading the OpenAPI schema.
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/v1/openapi.json")
    assert resp.status_code == 200
    paths = resp.json()["paths"]

    # Public form submission routes.
    assert "/api/v1/forms/{slug}/submissions" in paths
    upload_path = "/api/v1/forms/{slug}/submissions/upload"
    assert upload_path in paths
    # The upload route must accept multipart form data (file uploads).
    upload_body = paths[upload_path]["post"]["requestBody"]["content"]
    assert "multipart/form-data" in upload_body

    # Admin form routes.
    assert "/admin/forms/{page_id}/submissions" in paths
    assert "/admin/forms/{page_id}/config" in paths
    # Reviewing a submission must use the FormSubmissionReview request schema.
    review_schema = paths[
        "/admin/forms/{page_id}/submissions/{submission_id}"
    ]["patch"]["requestBody"]["content"]["application/json"]["schema"]
    assert review_schema["$ref"].endswith("/FormSubmissionReview")