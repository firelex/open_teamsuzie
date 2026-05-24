from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

RAG = Literal["green", "amber", "red", "grey"]


class NormalizationOp(BaseModel):
    """Snap one cell (or the whole row if col is None) to an explicit pt."""

    row: int
    col: int | None = None
    target_pt: float


class SlideUpdate(BaseModel):
    """A single slide's content overrides, keyed by shape name from the template.

    The template's slide layouts and masters are untouched — we only rewrite
    text frames and table cell values on the existing slide shapes.
    """

    slide_index: int = Field(..., description="0-based index into Presentation.slides")
    note: str | None = Field(None, description="Free-form annotation for humans/agents")

    # Map of shape name -> replacement content.
    # str: replace the entire text frame with this single paragraph
    # list[str]: replace with this many bullet/paragraph lines
    # list[list[str]]: slot mode — one inner list per numbered-badge anchor
    #   on the slide. Sections are padded with blanks to align with each slot.
    fields: dict[str, str | list[str] | list[list[str]]] = Field(
        default_factory=dict
    )

    # Map of table shape name -> 2D matrix of cell strings.
    # The matrix is applied top-left aligned; cells beyond the table dimensions
    # are ignored, cells inside the table that aren't covered are left as-is.
    tables: dict[str, list[list[str]]] = Field(default_factory=dict)

    # Map of shape name -> RAG color. Applied as a solid fill on the shape
    # (rectangles, ovals) or, when the shape is a table cell reference of the
    # form "TableName!r,c", as a fill on that single cell.
    rag: dict[str, RAG] = Field(default_factory=dict)

    # Map of table name -> list of normalisation ops. Applied *before* the
    # table content is written, so any defensive font-size resolution in
    # set_table sees the corrected pt.
    normalize: dict[str, list[NormalizationOp]] = Field(default_factory=dict)


class DeckSpec(BaseModel):
    """A complete content spec for a deck — references the template by path."""

    deal_name: str
    template: str = Field(..., description="Path to .pptx template")
    slides: list[SlideUpdate] = Field(default_factory=list)
    metadata: dict[str, str] = Field(default_factory=dict)


# Hex fills for RAG marks — these match the IC template's existing palette
# (green/amber/red rectangles seen in the one-pager and exec-summary slides).
RAG_HEX: dict[str, str] = {
    "green": "00B050",
    "amber": "FFC000",
    "red": "C00000",
    "grey": "BFBFBF",
}
