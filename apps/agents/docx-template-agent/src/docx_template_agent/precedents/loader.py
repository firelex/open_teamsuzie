"""Load a precedent (PDF or DOCX) and return its text + heading outline.

Precedents are finished documents whose CONTENT and STRUCTURE inform the
draft. They never modify the template's layout — the LLM agent reads them
at draft time as "write like this" context."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Literal, TypedDict

from docx import Document
from pypdf import PdfReader

PrecedentKind = Literal["pdf", "docx", "unknown"]


class PrecedentParagraph(TypedDict):
    text: str
    style: str | None      # docx style name, or "Heading" / None for PDF
    page: int | None       # 1-based; None for docx


class PrecedentManifest(TypedDict):
    kind: PrecedentKind
    page_count: int
    paragraph_count: int
    outline: list[str]               # heading texts in document order
    paragraphs: list[PrecedentParagraph]
    full_text: str                   # convenience: paragraphs joined by \n\n


# Numbered heading patterns the PDF heuristic recognises. The trailing
# period after digits is mandatory — without it, addresses ("10 Ledbury")
# and dates ("13 May") get false-matched.
#   "1. Title"  /  "1.2 Title"  /  "A. Title"  /  "I. Title"  /  "iii. Title"
_HEADING_PATTERN = re.compile(
    r"^\s*(?:\d+\.|\d+(?:\.\d+)+|[A-Z]\.|[IVX]+\.|[ivx]+\.)\s+[A-Z]"
)

# When PDF extraction puts the heading prefix on its own line, we rejoin it
# with the following line. This matches lines that contain ONLY a prefix.
_PREFIX_ONLY = re.compile(
    r"^\s*(?:\d+\.|\d+(?:\.\d+)+|[A-Z]\.|[IVX]+\.|[ivx]+\.)\s*$"
)


def _rejoin_split_headings(lines: list[str]) -> list[str]:
    """If a line is only a heading prefix (e.g. "1."), merge it with the
    next non-empty line. Common PDF-extraction artefact."""
    out: list[str] = []
    i = 0
    while i < len(lines):
        cur = lines[i]
        if _PREFIX_ONLY.match(cur):
            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines):
                merged = f"{cur.rstrip()} {lines[j].strip()}"
                out.append(merged)
                i = j + 1
                continue
        out.append(cur)
        i += 1
    return out


def _looks_like_heading(line: str) -> bool:
    """Heuristic: short line that starts with a numbered/lettered prefix and
    has no terminal punctuation. Tuned for IC-memo / NBO style precedents."""
    s = line.strip()
    if not s or len(s) > 120:
        return False
    if not _HEADING_PATTERN.match(s):
        return False
    return not s.rstrip().endswith((".", ",", ";", ":")) or s.count(".") <= 2


def _load_pdf(path: Path) -> PrecedentManifest:
    reader = PdfReader(str(path))
    paragraphs: list[PrecedentParagraph] = []
    outline: list[str] = []
    for pi, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        # Split into paragraphs by blank lines, then further by single newlines
        # collapsed to spaces within paragraphs.
        for chunk in re.split(r"\n\s*\n", text):
            chunk = chunk.strip()
            if not chunk:
                continue
            # Detect headings line-by-line (a single chunk may contain one)
            lines = _rejoin_split_headings(chunk.split("\n"))
            for ln in lines:
                ln_stripped = ln.strip()
                if not ln_stripped:
                    continue
                if _looks_like_heading(ln_stripped):
                    outline.append(ln_stripped)
                    paragraphs.append(PrecedentParagraph(
                        text=ln_stripped, style="Heading", page=pi,
                    ))
                else:
                    paragraphs.append(PrecedentParagraph(
                        text=ln_stripped, style=None, page=pi,
                    ))
    full_text = "\n\n".join(p["text"] for p in paragraphs)
    return PrecedentManifest(
        kind="pdf",
        page_count=len(reader.pages),
        paragraph_count=len(paragraphs),
        outline=outline,
        paragraphs=paragraphs,
        full_text=full_text,
    )


def _load_docx(path: Path) -> PrecedentManifest:
    doc = Document(str(path))
    paragraphs: list[PrecedentParagraph] = []
    outline: list[str] = []
    for p in doc.paragraphs:
        text = p.text.strip()
        if not text:
            continue
        style = p.style.name if p.style else None
        paragraphs.append(PrecedentParagraph(text=text, style=style, page=None))
        if style and (style.lower().startswith("heading") or style.lower() == "title"):
            outline.append(text)
    full_text = "\n\n".join(p["text"] for p in paragraphs)
    return PrecedentManifest(
        kind="docx",
        page_count=0,
        paragraph_count=len(paragraphs),
        outline=outline,
        paragraphs=paragraphs,
        full_text=full_text,
    )


def load_precedent(path: str | Path) -> PrecedentManifest:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Precedent not found: {p}")
    suffix = p.suffix.lower()
    if suffix == ".pdf":
        return _load_pdf(p)
    if suffix == ".docx":
        return _load_docx(p)
    raise ValueError(f"Unsupported precedent type: {suffix}")
