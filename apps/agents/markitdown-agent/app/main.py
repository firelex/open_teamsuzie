"""
markitdown-agent — Markdown ↔ binary conversion for Team Suzie.

Two synchronous endpoints:
- POST /convert        multipart `file` → { markdown }
- POST /export/docx    JSON { markdown, filename? } → DOCX bytes

Heavy lifting is in MarkItDown (file → markdown) and pypandoc (markdown → DOCX).
The agent layer (Node) calls these endpoints; nothing in this service is
LLM-aware.
"""

from __future__ import annotations

import io
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from markitdown import MarkItDown
from pydantic import BaseModel, Field

from app.config import settings


logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
log = logging.getLogger("markitdown-agent")

# MarkItDown is stateless once constructed; reuse one instance across requests.
_markitdown = MarkItDown()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log.info("markitdown-agent starting on port %d", settings.port)
    if settings.reference_docx:
        log.info("DOCX reference template: %s", settings.reference_docx)
    yield


app = FastAPI(title="markitdown-agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ConvertResponse(BaseModel):
    filename: str
    markdown: str


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "markitdown-agent"}


@app.post("/convert", response_model=ConvertResponse)
async def convert(file: UploadFile = File(...)) -> ConvertResponse:
    """Convert any supported binary (DOCX, PDF, PPTX, XLSX, HTML, EPUB, …) to
    Markdown via MarkItDown."""
    if file.size is not None and file.size > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_bytes} bytes")

    suffix = Path(file.filename or "upload").suffix or ""
    contents = await file.read()
    if len(contents) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_bytes} bytes")

    # MarkItDown reads from disk; write to a temp file with the right extension
    # so its content-sniffing picks the correct converter.
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(contents)
            tmp_path = Path(tmp.name)
        result = _markitdown.convert(str(tmp_path))
        return ConvertResponse(filename=file.filename or "upload", markdown=result.text_content)
    except Exception as exc:  # noqa: BLE001 — surface any conversion error as 422
        log.exception("convert failed for %s", file.filename)
        raise HTTPException(status_code=422, detail=f"Conversion failed: {exc}") from exc
    finally:
        if tmp_path and tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


class ExportDocxRequest(BaseModel):
    """JSON body shape (legacy). Kept for backwards compat with JSON callers."""
    markdown: str = Field(..., description="Markdown content to convert.")
    filename: str | None = Field(None, description="Suggested download filename (without extension).")


@app.post("/export/docx")
async def export_docx(
    request: Request,
    # Optional multipart fields:
    markdown_form: Annotated[str | None, Form(alias="markdown")] = None,
    filename_form: Annotated[str | None, Form(alias="filename")] = None,
    reference_doc: Annotated[UploadFile | None, File()] = None,
) -> Response:
    """Convert markdown to DOCX. Two call styles:

    - **JSON body** (legacy): ``{ markdown, filename? }`` → uses default pandoc
      styles (or ``settings.reference_docx`` if configured via env).
    - **Multipart** (new): ``markdown`` form field + optional ``reference_doc``
      file → passes ``--reference-doc=<uploaded file>`` to pandoc, preserving
      the uploaded reference's stylesheet. Falls back to
      ``settings.reference_docx`` if no upload provided.
    """
    import pypandoc  # imported lazily so the service can boot without pandoc on the path

    content_type = request.headers.get("content-type", "")

    # Disambiguate request style. Both multipart (file uploads) and
    # application/x-www-form-urlencoded (markdown-only form posts) get
    # parsed into Form() params by FastAPI, so treat them the same.
    is_form = content_type.startswith("multipart/") or content_type.startswith(
        "application/x-www-form-urlencoded"
    )
    if is_form:
        if markdown_form is None:
            raise HTTPException(status_code=422, detail="Missing 'markdown' form field")
        markdown = markdown_form
        filename = filename_form
    else:
        body = await request.json()
        markdown = body.get("markdown")
        filename = body.get("filename")
        if markdown is None:
            raise HTTPException(status_code=422, detail="Missing 'markdown' in JSON body")

    name = filename or "document"
    if name.lower().endswith(".docx"):
        name = name[:-5]

    extra_args: list[str] = []
    ref_path: str | None = None

    # Priority: multipart upload > settings.reference_docx > none.
    if reference_doc is not None:
        ref_bytes = await reference_doc.read()
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as ref_f:
            ref_f.write(ref_bytes)
            ref_path = ref_f.name
        extra_args.extend(["--reference-doc", ref_path])
    elif settings.reference_docx:
        ref = Path(settings.reference_docx)
        if not ref.exists():
            raise HTTPException(status_code=500, detail=f"reference_docx not found: {ref}")
        extra_args.extend(["--reference-doc", str(ref)])

    out_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
            out_path = Path(tmp.name)
        pypandoc.convert_text(
            markdown,
            "docx",
            format="markdown",
            outputfile=str(out_path),
            extra_args=extra_args,
        )
        bytes_ = out_path.read_bytes()
        suggested = name + ".docx"
        return Response(
            content=bytes_,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{suggested}"'},
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("export/docx failed")
        raise HTTPException(status_code=422, detail=f"DOCX export failed: {exc}") from exc
    finally:
        if out_path and out_path.exists():
            try:
                out_path.unlink()
            except OSError:
                pass
        if ref_path:
            try:
                Path(ref_path).unlink(missing_ok=True)
            except Exception:
                pass


def main() -> None:
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=bool(os.environ.get("MARKITDOWN_AGENT_RELOAD")),
    )


if __name__ == "__main__":
    main()
