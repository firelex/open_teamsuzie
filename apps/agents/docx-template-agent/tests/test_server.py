from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from docx_template_agent.server import app

TEMPLATE = Path(__file__).parent.parent / "templates" / "engagement-letter.docx"
pytestmark = pytest.mark.skipif(not TEMPLATE.exists(), reason="template missing")

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def template_id(client) -> str:
    with TEMPLATE.open("rb") as f:
        r = client.post(
            "/api/templates",
            files={"file": ("engagement.docx", f, DOCX_MIME)},
        )
    assert r.status_code == 200
    return r.json()["template_id"]


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["service"] == "docx-template-agent"


def test_upload_returns_manifest(client):
    with TEMPLATE.open("rb") as f:
        r = client.post("/api/templates", files={"file": ("e.docx", f, DOCX_MIME)})
    assert r.status_code == 200
    body = r.json()
    assert body["template_id"]
    assert body["manifest"]["placeholder_count"] >= 5


def test_upload_rejects_non_docx(client):
    r = client.post("/api/templates", files={"file": ("x.txt", b"hello", "text/plain")})
    assert r.status_code == 400


def test_inspect_unknown_template(client):
    r = client.get("/api/templates/nope/inspect")
    assert r.status_code == 404


def test_fill_endpoint_e2e(client, template_id):
    spec = {
        "doc_name": "Smoke",
        "template": "ignored",
        "placeholders": {
            "company_name": "Blixt Group",
            "company_address": "10 Ledbury Mews",
            "contact_person": "Mathias",
        },
    }
    r = client.post("/api/documents/fill", json={"template_id": template_id, "spec": spec})
    assert r.status_code == 200
    body = r.json()
    assert body["replacements"] > 0

    job_id = body["job_id"]
    r = client.get(f"/api/documents/{job_id}/status")
    assert r.status_code == 200
    assert r.json()["status"] == "completed"

    r = client.get(f"/api/documents/{job_id}/download")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(DOCX_MIME)
    assert len(r.content) > 1000


def test_generate_rejects_unknown_template(client):
    r = client.post(
        "/api/documents/generate",
        json={"template_id": "nope", "instructions": "draft"},
    )
    assert r.status_code == 404


def test_precedent_upload_rejects_non_supported_type(client):
    r = client.post("/api/precedents", files={"file": ("x.txt", b"hi", "text/plain")})
    assert r.status_code == 400


def test_precedent_inspect_unknown(client):
    r = client.get("/api/precedents/nope/inspect")
    assert r.status_code == 404


def test_precedent_upload_and_inspect(client):
    """Upload the Beacon NBO precedent and check the manifest carries the
    detected outline and paragraph count."""
    precedent_path = (
        Path(__file__).parent.parent / "precedents" / "beacon-nbo.pdf"
    )
    if not precedent_path.exists():
        pytest.skip("beacon-nbo.pdf fixture missing")
    with precedent_path.open("rb") as f:
        r = client.post(
            "/api/precedents",
            files={"file": ("beacon.pdf", f, "application/pdf")},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["precedent_id"]
    assert body["manifest"]["kind"] == "pdf"
    assert body["manifest"]["page_count"] >= 1
    assert len(body["manifest"]["outline"]) >= 5


def test_download_unknown_job(client):
    r = client.get("/api/documents/nope/download")
    assert r.status_code == 404
