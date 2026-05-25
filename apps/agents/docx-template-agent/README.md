# docx-template-agent

Template-injection Word agent. Sibling to `pptx-template-agent`: bring your
own `.docx` template, the agent inspects it, detects `[BRACKETED TOKENS]`
as named placeholders, and fills them on demand without touching the
template's styles, letterhead, headers/footers, or section structure.

## What it does (v1)

1. **Inspect** a `.docx` and return:
   - Every style (paragraph / character / table / numbering) with an
     `inferred_role` (`heading` / `body` / `list` / `caption` / `quote` / `other`).
   - Every `[BRACKETED TOKEN]` found in body, headers, footers, drawings,
     and text-box content — with location, section index, and the
     paragraph style they live in.
   - Section page setup and outline (whichever the template provides;
     both are optional).
2. **Fill** the template by giving the agent a `placeholders: {name: value}`
   dict and an output path. Tokens are replaced in place, paragraph styles
   stay intact, and the post-fill linter reports any tokens still
   unfilled.
3. **Optional ingestion fixup** — `wrap_bracket_tokens(path)` upgrades
   detected text tokens into real Word content controls (`<w:sdt>`) so
   future fills can address them by tag name. Idempotent.

Out of scope for v1 (reserved for v2):
- LLM tool-use loop that drafts body from a prompt + precedent
- Precedent upload + heading-outline extraction
- Section-aware content insertion (block list keyed by section)

## Quick start

```bash
pip install -e ".[dev]"
pytest -q

# Inspect a template
python -c "from docx_template_agent.injection import inspect_template; import json; print(json.dumps(inspect_template('templates/engagement-letter.docx'), indent=2, default=str))"

# Fill the engagement letter with Blixt letterhead
python examples/blixt_letterhead.py output/engagement-letter-blixt.docx

# Convert to PDF for preview
soffice --headless --convert-to pdf --outdir output output/engagement-letter-blixt.docx
```

## LLM configuration

The agent calls the upstream LLM provider's OpenAI-compatible
`/chat/completions` endpoint directly. No provider keys live in this
service: configuration (base URL, API key, model) is resolved per-request
from `pe-settings-host`.

- `PE_SETTINGS_HOST_URL` — base URL of pe-settings-host
  (default `http://localhost:19271`). The Settings UI lets the user pick
  a provider (OpenAI / Anthropic / Qwen / Custom), paste an API key, and
  choose a default model. Callers can still override per-request via the
  `model` field on `POST /api/documents/generate`.

## Token format

Bracket tokens follow this convention to keep prose like `[note]` or `[1]`
from being mistaken for placeholders:

- Opening `[`
- Leading uppercase letter (`A-Z`)
- 1–40 chars from `A-Z a-z 0-9 space & . / -`
- Closing `]`

Examples that match: `[COMPANY NAME]`, `[Contact Person]`, `[Phone & Fax]`.
Examples that don't: `[note]`, `[1]`, `[hello world]`.

The agent normalises every token to a stable name for spec/API use:
`[COMPANY NAME]` → `company_name`, `[Contact Person]` → `contact_person`.

## Precedents (planned for v2)

Templates govern *layout and styles*. Precedents (PDFs or finished `.docx`
files) govern *content and tone*. They are uploaded separately, never
modify the template, and feed into the v2 LLM drafting loop as
"write like this" context. The endpoints will mirror templates: upload,
inspect (return extracted text + heading outline), reference by id.

## Repo layout

```
docx-template-agent/
├── pyproject.toml
├── README.md
├── .env.example
├── templates/              # uploaded templates (gitignored)
├── precedents/             # uploaded precedents (gitignored, v2)
├── output/                 # generated documents
├── examples/
│   └── blixt_letterhead.py # validation: fill engagement letter with Blixt info
├── src/docx_template_agent/
│   ├── config.py
│   ├── models.py
│   ├── injection/
│   │   ├── tokens.py       # [BRACKETED TOKEN] detection + replacement
│   │   ├── inspect.py      # template manifest
│   │   ├── filler.py       # fill_doc — replace tokens, preserve structure
│   │   └── controls.py     # optional <w:sdt> wrapping at ingestion
│   ├── precedents/         # v2 — text extraction + outline detection
│   └── services/           # v2 — templates + precedents store
└── tests/                  # pytest
```

## Why python-docx + lxml

`python-docx` exposes the high-level API for styles / sections / headers /
footers cleanly. But many real-world templates put the letterhead in a
drawing's text box (`<w:txbxContent>` deeply nested) or alternate-content
fallback — and `python-docx`'s `body.paragraphs` doesn't descend into
those. We use `python-docx` for the typed API and fall back to direct
lxml walks (`element.iter(qn("w:p"))`) when we need full coverage. The
filler must filter `<w:t>` elements by *nearest paragraph ancestor* —
otherwise consolidating one paragraph's text would suck up nested
text-box paragraphs and wipe them.
