from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pptx_template_agent.server import app

TEMPLATE = Path(__file__).parent.parent / "templates" / "ic-template-v3.pptx"
pytestmark = pytest.mark.skipif(not TEMPLATE.exists(), reason="IC template not present")


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def template_id(client) -> str:
    with TEMPLATE.open("rb") as f:
        r = client.post(
            "/api/templates",
            files={"file": ("ic.pptx", f, "application/vnd.openxmlformats-officedocument.presentationml.presentation")},
        )
    assert r.status_code == 200
    return r.json()["template_id"]


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["service"] == "pptx-template-agent"


def test_upload_returns_manifest(client):
    with TEMPLATE.open("rb") as f:
        r = client.post(
            "/api/templates",
            files={"file": ("ic.pptx", f, "application/vnd.openxmlformats-officedocument.presentationml.presentation")},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["template_id"]
    assert body["manifest"]["slide_count"] > 0


def test_upload_rejects_non_pptx(client):
    r = client.post("/api/templates", files={"file": ("x.txt", b"hello", "text/plain")})
    assert r.status_code == 400


def test_inspect_unknown_template(client):
    r = client.get("/api/templates/nope/inspect")
    assert r.status_code == 404


def test_fill_endpoint_e2e(client, template_id):
    spec = {
        "deal_name": "Smoke",
        "template": "ignored",
        "slides": [{
            "slide_index": 0,
            "fields": {"Text Placeholder 1": "Smoke", "Text Placeholder 2": "Today"},
        }],
    }
    r = client.post("/api/presentations/fill", json={"template_id": template_id, "spec": spec})
    assert r.status_code == 200
    body = r.json()
    assert body["fields_applied"] == 2
    assert body["missing_fields"] == []

    job_id = body["job_id"]
    r = client.get(f"/api/presentations/{job_id}/status")
    assert r.status_code == 200
    assert r.json()["status"] == "completed"

    r = client.get(f"/api/presentations/{job_id}/download")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )
    assert len(r.content) > 1000


def test_download_unknown_job(client):
    r = client.get("/api/presentations/nope/download")
    assert r.status_code == 404
