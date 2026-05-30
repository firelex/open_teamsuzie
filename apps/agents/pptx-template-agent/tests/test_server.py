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


PPTX_MIME = (
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
)


def test_template_binary_returns_bytes(client, template_id):
    r = client.get(f"/api/templates/{template_id}/binary")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(PPTX_MIME)
    # .pptx files are zip containers — first bytes are the PK signature.
    assert r.content[:2] == b"PK"
    assert len(r.content) > 1000


def test_template_binary_unknown_id(client):
    r = client.get("/api/templates/nope/binary")
    assert r.status_code == 404


def test_status_returns_event_log_with_since_cursor():
    """The status endpoint surfaces the job's event log so drafter can render
    per-turn / per-tool progress. `since` is an inclusive cursor: passing the
    count of events already seen returns only newer ones.
    """
    from pptx_template_agent.services import jobs as jobs_svc
    from pptx_template_agent.server import app
    from fastapi.testclient import TestClient

    c = TestClient(app)

    job = jobs_svc.Job(id="evt-test", status="processing")
    jobs_svc.create(job)
    jobs_svc.append_event(job, "turn 1: model")
    jobs_svc.append_event(job, "  tool: add_slide")
    jobs_svc.append_event(job, "  tool: set_text")

    r = c.get("/api/presentations/evt-test/status")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "processing"
    assert body["events"] == ["turn 1: model", "  tool: add_slide", "  tool: set_text"]
    assert body["events_total"] == 3

    # since=2 returns only the third (index 2) event.
    r2 = c.get("/api/presentations/evt-test/status?since=2")
    body2 = r2.json()
    assert body2["events"] == ["  tool: set_text"]
    assert body2["events_total"] == 3

    # since past the end returns empty without erroring.
    r3 = c.get("/api/presentations/evt-test/status?since=99")
    body3 = r3.json()
    assert body3["events"] == []
    assert body3["events_total"] == 3


def test_append_event_caps_at_max():
    """Event log is bounded — oldest entries drop when MAX_EVENTS is exceeded."""
    from pptx_template_agent.services import jobs as jobs_svc

    job = jobs_svc.Job(id="cap-test")
    for i in range(jobs_svc.MAX_EVENTS + 50):
        jobs_svc.append_event(job, f"event-{i}")
    assert len(job.events) == jobs_svc.MAX_EVENTS
    # First retained event is the 51st we appended (index 50).
    assert job.events[0] == "event-50"
    assert job.events[-1] == f"event-{jobs_svc.MAX_EVENTS + 49}"
