"""Optional: upgrade detected `[BRACKET TOKENS]` to real Word content
controls (`<w:sdt>`) at ingestion time.

A content control is the proper Word way to mark a named injection point.
Once wrapped, the token survives copy/paste, ordering changes, and editing
in Word without the agent losing track of it.

Note: python-docx doesn't have first-class API for sdt creation, so we
build the elements with lxml. The wrap is non-destructive — the token
text remains, just enclosed in <w:sdt>/<w:sdtContent>."""

from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.oxml.ns import nsmap, qn
from lxml import etree

from .tokens import _TOKEN_RE, normalize_token

W = nsmap["w"]


def _make_sdt(tag_name: str, alias: str, inner_runs: list) -> etree._Element:
    """Build a <w:sdt> wrapper around the given runs."""
    sdt = etree.SubElement(etree.Element(qn("w:sdt")), qn("w:sdt"))  # placeholder; replaced below
    sdt = etree.Element(qn("w:sdt"))
    sdt_pr = etree.SubElement(sdt, qn("w:sdtPr"))
    etree.SubElement(sdt_pr, qn("w:tag"), {qn("w:val"): tag_name})
    etree.SubElement(sdt_pr, qn("w:alias"), {qn("w:val"): alias})
    etree.SubElement(sdt_pr, qn("w:id"), {qn("w:val"): str(abs(hash(tag_name)) % 10_000_000)})
    sdt_content = etree.SubElement(sdt, qn("w:sdtContent"))
    for r in inner_runs:
        sdt_content.append(r)
    return sdt


def _wrap_tokens_in_paragraph(p_element) -> int:
    """Find runs that together form `[TOKEN]` and wrap each token in a
    <w:sdt>. Currently handles tokens that fit within a single `<w:r>`.

    Returns the number of tokens wrapped."""
    wrapped = 0
    for r in list(p_element.iter(qn("w:r"))):
        # Skip runs already inside an sdt
        parent = r.getparent()
        if parent is not None and parent.tag == qn("w:sdtContent"):
            continue
        ts = list(r.iter(qn("w:t")))
        text = "".join((t.text or "") for t in ts)
        match = _TOKEN_RE.search(text)
        if not match:
            continue
        # Only wrap if the entire run's text is the token (keep v1 simple).
        if text != match.group(0):
            continue
        token = match.group(0)
        name = normalize_token(token)
        parent = r.getparent()
        idx = list(parent).index(r)
        sdt = _make_sdt(tag_name=name, alias=token.strip("[]"), inner_runs=[r])
        parent.remove(r)
        parent.insert(idx, sdt)
        wrapped += 1
    return wrapped


def wrap_bracket_tokens(template_path: str | Path) -> int:
    """Modify the template in place: every full-run bracket token gets
    wrapped in a `<w:sdt>` tagged with its normalized name. Returns the
    number of tokens wrapped."""
    path = Path(template_path)
    doc = Document(str(path))
    wrapped = 0
    for p in doc.element.body.iter(qn("w:p")):
        wrapped += _wrap_tokens_in_paragraph(p)
    for section in doc.sections:
        for area in (
            section.header, section.footer,
            section.first_page_header, section.first_page_footer,
        ):
            if area is None:
                continue
            for p in area._element.iter(qn("w:p")):
                wrapped += _wrap_tokens_in_paragraph(p)
    if wrapped:
        doc.save(str(path))
    return wrapped
