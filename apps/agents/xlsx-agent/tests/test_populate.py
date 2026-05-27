"""Tests for the synchronous /api/spreadsheets/populate endpoint."""

from __future__ import annotations

import io
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook, load_workbook

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def tiny_template_bytes() -> bytes:
    """A small workbook with one sheet and one input cell."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    ws["A1"] = "Base rate"
    ws["B1"] = None
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _minimal_cellmap() -> dict:
    return {
        "templateId": "tiny",
        "schemaVersion": "suzie-lbo-v1",
        "profile": "uk_mid_market_lbo",
        "modules": {
            "transaction_inputs": {
                "moduleVersion": "v1",
                "scalars": {"base_rate": "Sheet1!B1"},
                "slots": {},
            },
        },
        "other": [],
    }


def test_populate_requires_template_file(client: TestClient) -> None:
    """Missing template upload returns 422."""
    resp = client.post(
        "/api/spreadsheets/populate",
        data={
            "cellmap": json.dumps(_minimal_cellmap()),
            "assumptions": json.dumps({"transaction_inputs.base_rate": {"base": 0.0375}}),
        },
    )
    assert resp.status_code == 422


def test_populate_returns_xlsx(client: TestClient, tiny_template_bytes: bytes) -> None:
    """Valid request returns 200 with the populated workbook in the body."""
    cellmap = _minimal_cellmap()
    assumptions = {"transaction_inputs.base_rate": {"base": 0.0375}}
    resp = client.post(
        "/api/spreadsheets/populate",
        files={"template": ("tiny.xlsx", tiny_template_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={
            "cellmap": json.dumps(cellmap),
            "assumptions": json.dumps(assumptions),
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    wb = load_workbook(io.BytesIO(resp.content))
    assert wb["Sheet1"]["B1"].value == 0.0375


def test_populate_invalid_cellmap_json_returns_400(client: TestClient, tiny_template_bytes: bytes) -> None:
    """Malformed cellmap JSON returns 400."""
    resp = client.post(
        "/api/spreadsheets/populate",
        files={"template": ("tiny.xlsx", tiny_template_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={
            "cellmap": "{not json",
            "assumptions": json.dumps({}),
        },
    )
    assert resp.status_code == 400
    assert "cellmap" in resp.json().get("detail", "").lower()


def test_populate_invalid_address_returns_400(client: TestClient, tiny_template_bytes: bytes) -> None:
    """Cellmap with an address pointing at a non-existent sheet returns 400."""
    cellmap = _minimal_cellmap()
    cellmap["modules"]["transaction_inputs"]["scalars"]["base_rate"] = "Nonexistent!A1"
    resp = client.post(
        "/api/spreadsheets/populate",
        files={"template": ("tiny.xlsx", tiny_template_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={
            "cellmap": json.dumps(cellmap),
            "assumptions": json.dumps({"transaction_inputs.base_rate": {"base": 0.0375}}),
        },
    )
    assert resp.status_code == 400
    assert "nonexistent" in resp.json().get("detail", "").lower()
