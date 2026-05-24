"""List numbering restart support.

Word's numbered lists work via two layered concepts:
  - `<w:abstractNum>` defines the *format* (1./2./3. or i./ii./iii. etc.)
  - `<w:num>` is an *instance* of an abstractNum with its own running counter

A list style (e.g. "List Number 2") references a specific `<w:num>` by id.
Every paragraph using that style shares the same counter. To restart
numbering for a fresh list, we create a new `<w:num>` element that
points to the same `<w:abstractNumId>` (so the visual format is
identical) and override the paragraph's `<w:numPr><w:numId>` to point
at it. The new counter starts at 1.
"""

from __future__ import annotations

from docx.document import Document
from docx.oxml.ns import qn
from lxml import etree


def _is_list_style(style_name: str | None) -> bool:
    if not style_name:
        return False
    n = style_name.lower()
    return "list" in n or "bullet" in n or n.startswith("number")


def _style_to_num_id(doc: Document, style_name: str) -> int | None:
    """Resolve the numId referenced by a paragraph style's `<w:numPr>`.

    Walks `<w:basedOn>` chains so derived styles inherit numbering."""
    seen: set[str] = set()
    style_id = None
    for s in doc.styles:
        if s.name == style_name:
            style_id = s.element.get(qn("w:styleId"))
            break
    if style_id is None:
        return None

    styles_root = doc.styles.element
    while style_id and style_id not in seen:
        seen.add(style_id)
        style_el = None
        for s_el in styles_root.iter(qn("w:style")):
            if s_el.get(qn("w:styleId")) == style_id:
                style_el = s_el
                break
        if style_el is None:
            return None
        num_id_el = style_el.find(qn("w:pPr") + "/" + qn("w:numPr") + "/" + qn("w:numId"))
        if num_id_el is not None:
            v = num_id_el.get(qn("w:val"))
            return int(v) if v else None
        based_on = style_el.find(qn("w:basedOn"))
        style_id = based_on.get(qn("w:val")) if based_on is not None else None
    return None


def _abstract_num_id_for(numbering_root, num_id: int) -> int | None:
    for num in numbering_root.iter(qn("w:num")):
        if int(num.get(qn("w:numId"))) == num_id:
            abs_el = num.find(qn("w:abstractNumId"))
            if abs_el is None:
                return None
            return int(abs_el.get(qn("w:val")))
    return None


def _next_num_id(numbering_root) -> int:
    ids = [int(n.get(qn("w:numId"))) for n in numbering_root.iter(qn("w:num"))]
    return max(ids, default=0) + 1


def _abstract_num_levels(numbering_root, abstract_num_id: int) -> list[int]:
    """Return the list of `<w:ilvl>` values defined for an abstractNum."""
    for an in numbering_root.iter(qn("w:abstractNum")):
        if int(an.get(qn("w:abstractNumId"))) == abstract_num_id:
            return sorted(
                int(lvl.get(qn("w:ilvl")))
                for lvl in an.iter(qn("w:lvl"))
                if lvl.get(qn("w:ilvl")) is not None
            )
    return [0]


def create_restart_num(doc: Document, style_name: str) -> int | None:
    """Append a fresh `<w:num>` to numbering.xml that mirrors the
    abstractNum used by `style_name`, with `<w:lvlOverride>/<w:startOverride>`
    for every level so the counter restarts at 1.

    Returns the new numId, or None if the template has no numbering part
    or the style doesn't resolve to a numId."""
    if doc.part.numbering_part is None:
        return None
    numbering = doc.part.numbering_part.element

    base_num_id = _style_to_num_id(doc, style_name)
    if base_num_id is None:
        return None
    abstract_id = _abstract_num_id_for(numbering, base_num_id)
    if abstract_id is None:
        return None

    levels = _abstract_num_levels(numbering, abstract_id) or [0]

    new_num_id = _next_num_id(numbering)
    new_num = etree.SubElement(numbering, qn("w:num"))
    new_num.set(qn("w:numId"), str(new_num_id))
    abs_el = etree.SubElement(new_num, qn("w:abstractNumId"))
    abs_el.set(qn("w:val"), str(abstract_id))
    # The startOverride is what makes the renderer restart the counter.
    # Without it, the new numId is treated as a continuation of the same
    # abstractNum's counter.
    for lvl in levels:
        override = etree.SubElement(new_num, qn("w:lvlOverride"))
        override.set(qn("w:ilvl"), str(lvl))
        start_override = etree.SubElement(override, qn("w:startOverride"))
        start_override.set(qn("w:val"), "1")
    return new_num_id


def force_paragraph_numbering(paragraph, num_id: int, ilvl: int = 0) -> None:
    """Override the paragraph's numbering reference with the given numId.
    Inserts `<w:pPr><w:numPr><w:ilvl/><w:numId/></w:numPr></w:pPr>` if not
    already present, mutating in place."""
    p = paragraph._p
    pPr = p.find(qn("w:pPr"))
    if pPr is None:
        pPr = etree.SubElement(p, qn("w:pPr"))
        # pPr must be the first child of <w:p>
        p.insert(0, pPr)
    numPr = pPr.find(qn("w:numPr"))
    if numPr is None:
        numPr = etree.SubElement(pPr, qn("w:numPr"))
    ilvl_el = numPr.find(qn("w:ilvl"))
    if ilvl_el is None:
        ilvl_el = etree.SubElement(numPr, qn("w:ilvl"))
    ilvl_el.set(qn("w:val"), str(ilvl))
    num_id_el = numPr.find(qn("w:numId"))
    if num_id_el is None:
        num_id_el = etree.SubElement(numPr, qn("w:numId"))
    num_id_el.set(qn("w:val"), str(num_id))


def restart_paragraph_numbering(doc: Document, paragraph, style_name: str) -> bool:
    """High-level: create a fresh num for the style and bind it to the
    paragraph. Returns True if a restart was applied, False if the style
    doesn't carry numbering (so there's nothing to restart)."""
    new_num_id = create_restart_num(doc, style_name)
    if new_num_id is None:
        return False
    force_paragraph_numbering(paragraph, new_num_id, ilvl=0)
    return True
