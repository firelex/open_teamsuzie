from __future__ import annotations

from pathlib import Path

import pytest
from docx import Document

from docx_template_agent.agent.tools import AgentState, dispatch
from docx_template_agent.services.templates import save_template

TEMPLATE = Path(__file__).parent.parent / "templates" / "engagement-letter.docx"
pytestmark = pytest.mark.skipif(not TEMPLATE.exists(), reason="template missing")


def _new_state(tmp_path: Path) -> AgentState:
    with TEMPLATE.open("rb") as f:
        _, tpath = save_template(f.read())
    return AgentState(template_path=tpath, output_path=tmp_path / "out.docx")


def test_set_outline_accepts_rich_dicts(tmp_path: Path):
    s = _new_state(tmp_path)
    out = dispatch(s, "set_outline", {
        "sections": [
            {"section_topic": "intro", "section_heading": "1. Intro",
             "section_description": "Opening section"},
            {"section_topic": "signoff", "section_heading": None,
             "section_description": "Sign-off block"},
        ],
    })
    assert out["ok"] is True
    assert len(s.outline) == 2
    assert s.outline[0].section_heading == "1. Intro"
    assert s.outline[1].section_heading is None


def test_set_outline_accepts_strings_for_backcompat(tmp_path: Path):
    s = _new_state(tmp_path)
    out = dispatch(s, "set_outline", {"sections": ["First", "Second"]})
    assert out["ok"] is True
    assert s.outline[0].section_topic == "First"
    assert s.outline[0].section_heading == "First"


def test_set_outline_rejects_duplicate_topics(tmp_path: Path):
    s = _new_state(tmp_path)
    out = dispatch(s, "set_outline", {"sections": [
        {"section_topic": "a", "section_heading": "A"},
        {"section_topic": "a", "section_heading": "Other"},
    ]})
    assert "error" in out


def test_write_section_with_heading_emits_one(tmp_path: Path):
    s = _new_state(tmp_path)
    dispatch(s, "set_outline", {"sections": [
        {"section_topic": "intro", "section_heading": "1. Intro"},
    ]})
    out = dispatch(s, "write_section", {
        "section_topic": "intro",
        "paragraphs": ["body line 1", "body line 2"],
    })
    assert out["ok"] is True
    assert out["heading_emitted"] is True
    section = s.section("intro")
    assert section.heading_element is not None
    assert len(section.body_elements) == 2


def test_write_section_without_heading_skips_heading_emit(tmp_path: Path):
    """The signature-block case: section_heading=null → no Heading 1 emitted."""
    s = _new_state(tmp_path)
    dispatch(s, "set_outline", {"sections": [
        {"section_topic": "signoff", "section_heading": None},
    ]})
    out = dispatch(s, "write_section", {
        "section_topic": "signoff",
        "paragraphs": [
            {"style": "Normal", "text": "Kind regards,"},
            {"style": "Normal", "text": "Mathias Strasser"},
        ],
    })
    assert out["ok"] is True
    assert out["heading_emitted"] is False
    section = s.section("signoff")
    assert section.heading_element is None
    assert len(section.body_elements) == 2


def test_write_section_rejects_unknown_topic(tmp_path: Path):
    s = _new_state(tmp_path)
    dispatch(s, "set_outline", {"sections": [
        {"section_topic": "intro", "section_heading": "Intro"},
    ]})
    out = dispatch(s, "write_section", {
        "section_topic": "unknown",
        "paragraphs": ["x"],
    })
    assert "error" in out
    assert "unknown" in out["error"].lower()


def test_read_section_returns_heading_and_body(tmp_path: Path):
    s = _new_state(tmp_path)
    dispatch(s, "set_outline", {"sections": [
        {"section_topic": "intro", "section_heading": "1. Intro"},
    ]})
    dispatch(s, "write_section", {
        "section_topic": "intro",
        "paragraphs": [
            {"style": "Normal", "text": "Hello."},
            {"style": "Normal", "runs": [
                {"text": "Bold:", "bold": True},
                {"text": " follow."},
            ]},
        ],
    })
    out = dispatch(s, "read_section", {"section_topic": "intro"})
    assert "error" not in out
    assert out["section_heading"] == "1. Intro"
    assert out["heading"] is not None
    assert out["body_paragraph_count"] == 2


def test_read_section_handles_no_heading(tmp_path: Path):
    s = _new_state(tmp_path)
    dispatch(s, "set_outline", {"sections": [
        {"section_topic": "signoff", "section_heading": None},
    ]})
    dispatch(s, "write_section", {
        "section_topic": "signoff",
        "paragraphs": ["Kind regards,", "Mathias"],
    })
    out = dispatch(s, "read_section", {"section_topic": "signoff"})
    assert "error" not in out
    assert out["section_heading"] is None
    assert out["heading"] is None
    assert out["body_paragraph_count"] == 2


def test_revise_section_replaces_body_preserving_heading(tmp_path: Path):
    s = _new_state(tmp_path)
    dispatch(s, "set_outline", {"sections": [
        {"section_topic": "intro", "section_heading": "1. Intro"},
        {"section_topic": "body", "section_heading": "2. Body"},
    ]})
    dispatch(s, "write_section", {
        "section_topic": "intro",
        "paragraphs": [{"style": "Normal", "text": "Original."}],
    })
    dispatch(s, "write_section", {
        "section_topic": "body",
        "paragraphs": [{"style": "Normal", "text": "Body text."}],
    })
    out = dispatch(s, "revise_section", {
        "section_topic": "intro",
        "paragraphs": [{"style": "Normal", "text": "Revised."}],
    })
    assert out["ok"] is True
    read = dispatch(s, "read_section", {"section_topic": "intro"})
    body_texts = " ".join((p.get("text") or "") for p in read["body"])
    assert "Revised." in body_texts
    assert "Original." not in body_texts


def test_save_doc_rejects_missing_topic(tmp_path: Path):
    s = _new_state(tmp_path)
    dispatch(s, "set_outline", {"sections": [
        {"section_topic": "a", "section_heading": "A"},
        {"section_topic": "b", "section_heading": "B"},
    ]})
    dispatch(s, "write_section", {
        "section_topic": "a",
        "paragraphs": ["only one section done"],
    })
    out = dispatch(s, "save_doc", {"doc_name": "test"})
    assert "error" in out
    assert "b" in out.get("missing_topics", [])
    assert not s.saved


def test_save_doc_accepts_complete_draft_with_mixed_headings(tmp_path: Path):
    s = _new_state(tmp_path)
    dispatch(s, "set_outline", {"sections": [
        {"section_topic": "intro", "section_heading": "1. Intro"},
        {"section_topic": "signoff", "section_heading": None},
    ]})
    dispatch(s, "write_section", {
        "section_topic": "intro",
        "paragraphs": ["Opening line."],
    })
    dispatch(s, "write_section", {
        "section_topic": "signoff",
        "paragraphs": ["Kind regards,", "Mathias"],
    })
    out = dispatch(s, "save_doc", {"doc_name": "complete"})
    assert "error" not in out
    assert s.saved is True

    # Verify rendering: the no-heading section should NOT have introduced
    # a Heading 1 paragraph with text "signoff".
    doc = Document(out["path"])
    heading_texts = [
        p.text for p in doc.paragraphs
        if p.style and p.style.name == "Heading 1"
    ]
    assert "1. Intro" in heading_texts
    assert "signoff" not in heading_texts


def test_strings_accepted_as_paragraphs(tmp_path: Path):
    """Models often pass bare strings — coerce to {text, style=None}."""
    s = _new_state(tmp_path)
    dispatch(s, "set_outline", {"sections": [
        {"section_topic": "intro", "section_heading": "Intro"},
    ]})
    out = dispatch(s, "write_section", {
        "section_topic": "intro",
        "paragraphs": ["string 1", "string 2"],
    })
    assert out["ok"] is True
    assert out["body_paragraph_count"] == 2
