# pptx-template-agent

Template-injection PowerPoint agent built on `python-pptx`. Sibling to
`pptx-agent` (which generates decks from primitives via `PptxGenJS`) — this
agent takes the opposite approach: it **composes decks from an existing .pptx
template** by writing content into named shapes, leaving the template's slide
masters, layouts, fonts and brand untouched.

Bring your own template. The agent has no built-in template; the IC sample
under `templates/` (gitignored) is just convenient for local development.

## What it does

1. Accepts a `.pptx` upload, persists it by content hash → `template_id`.
2. Inspects the template and returns a JSON manifest: slide index, layout
   name, shape names, current placeholder text, table dimensions.
3. Fills the template either:
   - **Spec-driven** (`POST /api/presentations/fill`): client sends a
     `DeckSpec` referencing the shape names from the manifest.
   - **Prompt-driven** (`POST /api/presentations/generate`): an LLM agent
     loop calls `inspect_template`, `update_slide`, `save_deck` as tools.
4. Serves the resulting `.pptx` for download. Fires an optional completion
   webhook to a configured admin service.

## Quick start

```bash
# Install dev deps
pip install -e ".[dev]"

# Run tests (skips if no template is present)
pytest -q

# Dump a template's manifest
python -m pptx_template_agent.cli inspect path/to/template.pptx

# Spec-driven fill (no LLM)
python -m pptx_template_agent.cli fill spec.json --template path/to/template.pptx --output out.pptx

# Prompt-driven generate (needs ANTHROPIC_API_KEY + PPTX_TEMPLATE_AGENT_MODEL)
python -m pptx_template_agent.cli generate "Build an IC deck for AquaPure" \
    --template path/to/template.pptx --model claude-opus-4-7

# HTTP server
python -m pptx_template_agent.cli serve --port 8081
```

## HTTP contract

| Method | Path                                       | Purpose                                  |
| ------ | ------------------------------------------ | ---------------------------------------- |
| GET    | `/api/health`                              | liveness                                 |
| POST   | `/api/templates`                           | upload `.pptx`, returns id + manifest    |
| GET    | `/api/templates/{id}/inspect`              | manifest for a previously uploaded template |
| POST   | `/api/presentations/fill`                  | spec-driven generation, returns report   |
| POST   | `/api/presentations/generate`              | prompt-driven (LLM) generation, async    |
| GET    | `/api/presentations/{job}/status`          | job state                                |
| GET    | `/api/presentations/{job}/download`        | download the `.pptx`                     |

`/api/presentations/generate` matches the `pptx-agent` webhook contract — pass
`x-agent-api-key` to enable completion delivery via the admin service.

## DeckSpec shape

```python
class SlideUpdate:
    slide_index: int
    fields: dict[str, str | list[str]]   # shape name -> text or list of paragraphs
    tables: dict[str, list[list[str]]]   # table shape name -> 2D matrix
    rag: dict[str, "green|amber|red|grey"]  # shape name OR "TableName!r,c"

class DeckSpec:
    deal_name: str
    template: str                # path (ignored over HTTP — template_id is authoritative)
    slides: list[SlideUpdate]
    metadata: dict[str, str]
```

## Worked example: Project AquaPure

`examples/aquapure.py` builds a 10-slide IC deck for a hypothetical
modular industrial water purification platform. Run:

```bash
python examples/aquapure.py output/aquapure.pptx
```

Open the result, or convert to PDF for preview:

```bash
soffice --headless --convert-to pdf --outdir output output/aquapure.pptx
```

## Design notes

- **Template-agnostic.** The injection layer (`pptx_template_agent.injection`)
  knows nothing about any specific template. It operates on shape names and
  table cells; the spec is the contract.
- **Style preservation.** When replacing text, we clone the first run's
  formatting (font, size, color, weight) onto the new runs. This keeps the
  template's typography intact — the alternative (`text_frame.text = "..."`)
  wipes formatting and produces ugly defaults.
- **No template surgery.** We never add/remove/clone slides at runtime. If
  the template doesn't have a slide for what you want, the manifest is the
  signal; the client either picks a different slide or the upstream prepares
  a richer template.
- **Pre-styled tables.** Templates with row-by-row formatting (subtotal rows
  bold/larger, sub-rows indented italic) impose a schema. Spec authors must
  match content to the template's row intent or rows will look mismatched.
  This is a deliberate trade-off — preserving the template's design wins
  over flexibility.

## Why python-pptx (vs `PptxGenJS` / `pptx-automizer`)?

- `PptxGenJS` builds decks from primitives — great when there is no
  template, but you re-derive every layout and color manually.
- `pptx-automizer` (Node) and `python-pptx` (Python) both compose decks
  from existing templates. We chose `python-pptx` for its larger ecosystem,
  more mature table/chart manipulation, and simpler font-style preservation.
- Trade-off: this agent runs as a Python service rather than reusing the
  Node stack. The HTTP boundary keeps the rest of the platform unaffected.

## Configuration

Copy `.env.example` to `.env`. Notable env vars:

- `PPTX_TEMPLATE_AGENT_PORT` — HTTP port (default 8081, so pptx-agent on
  8080 and this on 8081 can coexist locally).
- `PPTX_TEMPLATE_AGENT_OUTPUT_DIR` — where generated `.pptx` files are
  written.
- `PPTX_TEMPLATE_AGENT_TEMPLATES_DIR` — where uploaded templates are
  persisted (keyed by content hash).
- `ANTHROPIC_API_KEY` + `PPTX_TEMPLATE_AGENT_MODEL` (or `DEFAULT_LLM_MODEL`)
  — required for the prompt-driven generate path.
- `ADMIN_SERVICE_URL` — base URL for completion webhook delivery (optional).
