from fastapi.testclient import TestClient
from app.main import app
from pathlib import Path

client = TestClient(app)

FIXTURE_REF = Path(__file__).parent / "fixtures" / "ref-template.docx"


def test_export_docx_with_reference_applies_styles():
    """Multipart call with reference_doc returns a DOCX (zip magic)."""
    with open(FIXTURE_REF, "rb") as ref:
        resp = client.post(
            "/export/docx",
            data={"markdown": "# Heading"},
            files={
                "reference_doc": (
                    "ref-template.docx",
                    ref,
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                )
            },
        )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument"
    )
    assert resp.content[:2] == b"PK"  # DOCX is a zip


def test_export_docx_without_reference_still_works():
    """Backwards compat: existing JSON-body callers must continue to work."""
    resp = client.post("/export/docx", json={"markdown": "# Hi", "filename": "x"})
    assert resp.status_code == 200, resp.text
    assert resp.content[:2] == b"PK"


def test_export_docx_multipart_without_reference():
    """Multipart with only markdown (no reference_doc) — produces a DOCX with default styles."""
    resp = client.post(
        "/export/docx",
        data={"markdown": "# Multipart"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.content[:2] == b"PK"
