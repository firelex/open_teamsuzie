"""Fill the engagement-letter template with Blixt letterhead values
extracted from the Project Beacon NBO precedent.

This is the v1 validation: prove that ingestion + token replacement
produces a clean letterhead document, no LLM needed."""

from __future__ import annotations

from pathlib import Path

from docx_template_agent.injection import fill_doc
from docx_template_agent.models import DocSpec

TEMPLATE = "templates/engagement-letter.docx"

# Values pulled from the Project Beacon NBO letterhead block.
BLIXT_LETTERHEAD = {
    "company_name": "Blixt Group",
    "company_address": "10 Ledbury Mews North, Notting Hill, London W11 2AF",
    "telephone_number": "+44 20 7946 0123",
    "fax_number": "+44 20 7946 0124",
    "website": "www.blixtgroup.com",
    "bank": "HSBC UK",
    "iban": "GB29 NWBK 6016 1331 9268 19",
    "bic": "HSBCGB2L",
    "contact_person": "Mathias Strasser",
    "assistant": "Office Manager",
}


def build() -> DocSpec:
    return DocSpec(
        doc_name="Engagement letter — Blixt",
        template=TEMPLATE,
        placeholders=BLIXT_LETTERHEAD,
    )


if __name__ == "__main__":
    import logging
    import sys

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    spec = build()
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("output/engagement-letter-blixt.docx")
    path, report = fill_doc(spec, out_path)
    print(f"\nWrote {path}")
    print(f"  replacements: {report.replacements}")
    print(f"  paragraphs touched: {report.paragraphs_touched}")
    if report.unfilled_tokens:
        print(f"  unfilled tokens: {report.unfilled_tokens}")
