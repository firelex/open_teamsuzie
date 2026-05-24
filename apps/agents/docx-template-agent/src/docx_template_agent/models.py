from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

TokenLocation = Literal["body", "header", "footer"]


class TokenOccurrence(BaseModel):
    """One literal `[TOKEN]` found in the template."""

    token: str                       # the bracketed text e.g. "[COMPANY NAME]"
    name: str                        # normalized name e.g. "company_name"
    location: TokenLocation
    section_index: int = 0           # which sectPr this belongs to (0-based)
    sample_paragraph: str = ""       # text of the paragraph it lives in
    paragraph_style: str | None = None


class DocSpec(BaseModel):
    """A fill spec: provide values for the placeholders detected at inspect."""

    doc_name: str = "document"
    template: str                    # path to .docx template (resolved server-side)
    # placeholder name -> replacement value. Names use the normalized form
    # returned in the manifest (e.g. "company_name"), not the bracketed form.
    placeholders: dict[str, str] = Field(default_factory=dict)
    # Optional: list of precedent IDs to attach (no-op in v1 — reserved for the
    # LLM drafting path).
    precedent_ids: list[str] = Field(default_factory=list)
