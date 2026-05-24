"""Fill a docx template by replacing bracket tokens with values.

We replace tokens at the run level when possible (preserves the run's font /
size / color / bold styling around the token). When a token spans multiple
runs in the source XML — common because Word splits runs on track-change or
spellcheck boundaries — we fall back to a paragraph-level rewrite that keeps
the first run's formatting and consolidates the paragraph's text."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn

from ..models import DocSpec
from .append import prune_empty_paragraphs
from .tokens import _TOKEN_RE, normalize_token

log = logging.getLogger(__name__)


@dataclass
class FillReport:
    replacements: int = 0
    paragraphs_touched: int = 0
    paragraphs_pruned: int = 0
    unfilled_tokens: list[str] = field(default_factory=list)  # tokens still in the doc after fill

    @property
    def is_clean(self) -> bool:
        return not self.unfilled_tokens


def _nearest_p_ancestor(elem):
    """Return the closest `<w:p>` ancestor of `elem`, or None."""
    el = elem.getparent()
    while el is not None and el.tag != qn("w:p"):
        el = el.getparent()
    return el


def _replace_in_paragraph(paragraph_element, values: dict[str, str]) -> int:
    """Replace `[TOKEN]` occurrences in a `<w:p>` element. Returns count.

    Strategy:
      1. Gather direct-line `<w:t>` text (only runs whose closest `<w:p>`
         ancestor is THIS paragraph — skips runs nested inside text-box
         paragraphs).
      2. Find all `[TOKEN]` occurrences; for each with a value in `values`,
         build the replaced string.
      3. If anything was replaced, rewrite all `<w:t>` text into the first
         run and clear later runs' text (preserving the first run's
         formatting).
    """
    runs = [
        r for r in paragraph_element.iter(qn("w:r"))
        if _nearest_p_ancestor(r) is paragraph_element
    ]
    if not runs:
        return 0
    # Collect text per run, then concatenate. CRITICAL: also filter <w:t> by
    # nearest paragraph ancestor — a direct-line run can contain a drawing
    # whose nested paragraphs have their own <w:t> elements, and iter() walks
    # into them. Without this filter we'd pull in nested-paragraph text and
    # wipe it when consolidating.
    run_texts: list[list] = []
    for r in runs:
        texts = [
            t for t in r.iter(qn("w:t"))
            if _nearest_p_ancestor(t) is paragraph_element
        ]
        run_texts.append(texts)
    full = "".join((t.text or "") for ts in run_texts for t in ts)

    new_full, n = _TOKEN_RE.subn(
        lambda m: values.get(normalize_token(m.group(0)), m.group(0)), full,
    )
    if n == 0:
        return 0

    # Write the new full text into the first run's first <w:t>, drop the rest
    first_run_texts = run_texts[0]
    if first_run_texts:
        first_run_texts[0].text = new_full
        # Preserve leading/trailing space behaviour
        if new_full != new_full.strip():
            first_run_texts[0].set(qn("xml:space"), "preserve")
        # Clear any other <w:t> in the first run
        for extra in first_run_texts[1:]:
            extra.text = ""
    # Clear all other runs' text
    for ts in run_texts[1:]:
        for t in ts:
            t.text = ""
    return n


def _walk_and_replace(part_element, values: dict[str, str], report: FillReport) -> None:
    for p in part_element.iter(qn("w:p")):
        n = _replace_in_paragraph(p, values)
        if n:
            report.replacements += n
            report.paragraphs_touched += 1


def _scan_unfilled(part_element) -> list[str]:
    leftover: list[str] = []
    for p in part_element.iter(qn("w:p")):
        text = "".join((t.text or "") for t in p.iter(qn("w:t")))
        for m in _TOKEN_RE.finditer(text):
            leftover.append(m.group(0))
    return leftover


def fill_doc(
    spec: DocSpec,
    output_path: str | Path,
    *,
    prune_empties: bool = True,
) -> tuple[Path, FillReport]:
    """Open the template, replace bracket tokens with `spec.placeholders`
    values, write to `output_path`. Returns (path, report).

    Iterates body + headers + footers across every section. When
    `prune_empties` is True (default), removes whitespace-only body
    paragraphs the agent may have inserted as spacers — paragraph styles
    have built-in space-after, so manual spacers are usually redundant."""
    template_path = Path(spec.template)
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")

    doc = Document(str(template_path))
    report = FillReport()

    # Body
    _walk_and_replace(doc.element.body, spec.placeholders, report)

    # Headers / footers (every section, including first-page variants)
    for section in doc.sections:
        for area in (
            section.header, section.footer,
            section.first_page_header, section.first_page_footer,
        ):
            if area is None:
                continue
            _walk_and_replace(area._element, spec.placeholders, report)

    if prune_empties:
        report.paragraphs_pruned = prune_empty_paragraphs(doc)

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out))

    # Post-fill: scan for any bracket tokens left untouched
    final_doc = Document(str(out))
    leftover: set[str] = set()
    leftover.update(_scan_unfilled(final_doc.element.body))
    for section in final_doc.sections:
        for area in (
            section.header, section.footer,
            section.first_page_header, section.first_page_footer,
        ):
            if area is None:
                continue
            leftover.update(_scan_unfilled(area._element))
    report.unfilled_tokens = sorted(leftover)

    log.info(
        "Wrote %s (replacements=%d paragraphs_touched=%d pruned=%d unfilled=%d)",
        out, report.replacements, report.paragraphs_touched,
        report.paragraphs_pruned, len(report.unfilled_tokens),
    )
    return out, report
