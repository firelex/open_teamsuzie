from __future__ import annotations

from pathlib import Path

import pytest

from pptx_template_agent.agent.tools import AgentState, dispatch
from pptx_template_agent.services.templates import save_template

TEMPLATE = Path(__file__).parent.parent / "templates" / "ic-template-v3.pptx"
pytestmark = pytest.mark.skipif(not TEMPLATE.exists(), reason="IC template missing")


def _new_state(tmp_path: Path) -> AgentState:
    with TEMPLATE.open("rb") as f:
        _, tpath = save_template(f.read())
    return AgentState(template_path=tpath, output_path=tmp_path / "out.pptx")


def test_update_slide_accepts_in_capacity_content(tmp_path: Path):
    """Short header content fits its capacity — should queue."""
    s = _new_state(tmp_path)
    out = dispatch(s, "update_slide", {
        "slide_index": 0,
        "fields": {"Text Placeholder 1": "Project AquaPure"},
    })
    assert out.get("ok") is True
    assert out.get("queued_updates") == 1


def test_update_slide_rejects_overflowing_field(tmp_path: Path):
    """Content that exceeds the shape's capacity gets rejected with a
    warnings list — update NOT queued."""
    s = _new_state(tmp_path)
    # Slide 2 sub-header (Text Placeholder 2) is ~58c × 2 lines ≈ 116 chars.
    too_long = "Exec summary | " + ("a very long marketing statement " * 8).strip()
    out = dispatch(s, "update_slide", {
        "slide_index": 2,
        "fields": {"Text Placeholder 2": too_long},
    })
    assert "error" in out
    assert any(w["kind"] == "field_overflow" for w in out["warnings"])
    assert len(s.updates) == 0  # not queued


def test_update_slide_rejects_overflowing_table_cell(tmp_path: Path):
    """A table cell value that exceeds the column×row capacity is flagged."""
    s = _new_state(tmp_path)
    # Slide 5 VCP table 'Tabelle 3' col 0 is narrow — long lever names overflow.
    matrix = [
        ["VC lever", "Target", "Upside Target", "Today", "Driver", "Actions"],
        # Way too long for the narrow 'VC lever' column:
        ["This is an extremely long lever name that absolutely will not fit",
         "T", "U", "Today", "D", "A"],
    ]
    out = dispatch(s, "update_slide", {
        "slide_index": 5,
        "tables": {"Tabelle 3": matrix},
    })
    assert "error" in out
    assert any(w["kind"] == "cell_overflow" for w in out["warnings"])
    assert len(s.updates) == 0


def test_update_slide_skips_unknown_shape_in_preflight(tmp_path: Path):
    """Unknown shape names slip past pre-flight (filler reports them as
    missing_fields). Pre-flight is just for capacity."""
    s = _new_state(tmp_path)
    out = dispatch(s, "update_slide", {
        "slide_index": 0,
        "fields": {"DoesNotExist": "x"},
    })
    # No capacity to check → no warning → queued
    assert out.get("ok") is True


def test_slot_frame_rejects_flat_list_form(tmp_path: Path):
    """Slide 2's Content Placeholder 2 has 4 slot anchors. Sending a flat
    list[str] instead of list[list[str]] gets rejected by pre-flight."""
    s = _new_state(tmp_path)
    out = dispatch(s, "update_slide", {
        "slide_index": 2,
        "fields": {"Content Placeholder 2": ["plain string a", "plain string b"]},
    })
    assert "error" in out
    assert any(w["kind"] == "slot_shape_required" for w in out["warnings"])
    assert len(s.updates) == 0


def test_slot_frame_rejects_wrong_inner_count(tmp_path: Path):
    """list-of-lists must have exactly slots.count entries."""
    s = _new_state(tmp_path)
    out = dispatch(s, "update_slide", {
        "slide_index": 2,
        "fields": {"Content Placeholder 2": [["a"], ["b"]]},  # only 2, frame has 4
    })
    assert "error" in out
    assert any(w["kind"] == "slot_count_mismatch" for w in out["warnings"])


def test_slot_frame_rejects_empty_inner_list(tmp_path: Path):
    """Each inner list must have at least one non-empty paragraph."""
    s = _new_state(tmp_path)
    out = dispatch(s, "update_slide", {
        "slide_index": 2,
        "fields": {
            "Content Placeholder 2": [["a"], ["b"], [], ["d"]],
        },
    })
    assert "error" in out
    assert any(w["kind"] == "empty_slot" for w in out["warnings"])
    assert 2 in out["warnings"][0]["empty_slot_indices"]


def test_slot_frame_accepts_correct_form(tmp_path: Path):
    s = _new_state(tmp_path)
    out = dispatch(s, "update_slide", {
        "slide_index": 2,
        "fields": {
            "Content Placeholder 2": [
                ["Market: short."],
                ["Business: short."],
                ["Returns: short."],
                ["Risk: short."],
            ],
        },
    })
    assert out.get("ok") is True
    assert len(s.updates) == 1


def test_save_deck_response_includes_overflow_lists(tmp_path: Path):
    """save_deck surfaces the full set of post-fill warnings."""
    s = _new_state(tmp_path)
    dispatch(s, "update_slide", {
        "slide_index": 0,
        "fields": {"Text Placeholder 1": "X"},
    })
    out = dispatch(s, "save_deck", {"deal_name": "Smoke"})
    assert "overflows" in out
    assert "unfilled" in out
    assert "cell_overflows" in out
    assert "table_collisions" in out
    assert isinstance(out["cells_shrunk"], int)
