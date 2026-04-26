# markitdown-agent

Markdown ↔ binary conversion for Team Suzie agents. Two synchronous endpoints, FastAPI.

## What it does

- **`POST /convert`** — multipart `file` upload → `{ filename, markdown }`. Uses [MarkItDown](https://github.com/microsoft/markitdown). Handles DOCX, PDF, PPTX, XLSX, HTML, EPUB, and more. (Image OCR and audio transcription require `markitdown[all]` — see Limitations.)
- **`POST /export/docx`** — JSON `{ markdown, filename? }` → DOCX bytes (returned in the response body). Uses `pypandoc-binary` (ships pandoc with the package, no separate install).
- **`GET /health`** — `{ status: "ok", service: "markitdown-agent" }`.

This service is the conversion layer for agentic document workflows: starter-chat auto-converts uploaded binaries to markdown so the agent can read them, and uses `/export/docx` to deliver finished drafts.

## Run

Python 3.10+ recommended. The fastest path is the workspace alias, which calls the bundled `dev.sh` — it creates and populates a venv on first run, then just serves on subsequent runs:

```bash
# From the repo root:
pnpm dev:markitdown-agent
```

`dev.sh` is idempotent — safe to call any number of times. It only re-installs requirements when `requirements.txt` is newer than the install marker, so subsequent starts are fast.

Manual setup (if you'd rather drive it yourself):

```bash
cd apps/agents/markitdown-agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 3013
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `MARKITDOWN_AGENT_PORT` | `3013` | HTTP port |
| `MARKITDOWN_AGENT_HOST` | `0.0.0.0` | Bind address |
| `MARKITDOWN_AGENT_MAX_UPLOAD_BYTES` | `52428800` (50MB) | Per-file upload cap |
| `MARKITDOWN_AGENT_REFERENCE_DOCX` | unset | Path to a styled `.docx` passed to pandoc as `--reference-doc` so DOCX exports inherit fonts/headings/styles. Set this for firm-template fidelity. |
| `MARKITDOWN_AGENT_RELOAD` | unset | If truthy, uvicorn reloads on code changes |

## Why a separate Python service

MarkItDown is the pragmatic choice for "any binary → markdown" — it handles ten formats with one library. Pypandoc covers the reverse direction better than any pure-Node option. Both are Python; running them as a sidecar service keeps the Node agent stack clean and lets you scale conversion independently.

The Node side talks to this service via HTTP (`@teamsuzie/agent-loop`'s `convert_to_markdown` and `export_to_docx` tools) — no Python on the agent host required.

## Limitations / TODO

- `/export/docx` doesn't support tables of contents, page breaks beyond what markdown specifies, or footnotes that pandoc doesn't already emit. For richer output, point `MARKITDOWN_AGENT_REFERENCE_DOCX` at a template with the styles you want.
- Image OCR works only if the runtime has tesseract installed (`apt install tesseract-ocr`). Without it, scanned PDFs return empty markdown.
- No auth — intended to run as a sidecar on a private network. If you expose it publicly, front it with `@teamsuzie/shared-auth`'s `SimpleApiKeyAuth`.
