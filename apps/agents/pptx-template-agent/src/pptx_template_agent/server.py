"""FastAPI server.

Endpoints:
  GET  /api/health
  POST /api/templates                  upload a .pptx, get back template_id + manifest
  GET  /api/templates/{id}/inspect     return the manifest
  POST /api/presentations/generate     prompt-driven (LLM) deck generation
  POST /api/presentations/fill         spec-driven (no LLM) deck generation
  GET  /api/presentations/{id}/status
  GET  /api/presentations/{id}/download
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Header, Request, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .agent.loop import run_loop
from .config import config
from .injection import fill_deck
from .injection.inspect import TemplateManifest
from .models import DeckSpec
from .services import jobs, templates
from .services.jobs import Job
from .services.webhook import fire_completion_webhook, get_agent_api_key

log = logging.getLogger(__name__)
app = FastAPI(title="pptx-template-agent", version="0.1.0")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "pptx-template-agent"}


# ---- Templates ---------------------------------------------------------------

class TemplateUploadResponse(BaseModel):
    template_id: str
    manifest: TemplateManifest


@app.post("/api/templates", response_model=TemplateUploadResponse)
async def upload_template(file: UploadFile = File(...)) -> TemplateUploadResponse:
    if not file.filename or not file.filename.lower().endswith(".pptx"):
        raise HTTPException(400, "file must be .pptx")
    data = await file.read()
    template_id, _ = templates.save_template(data)
    return TemplateUploadResponse(
        template_id=template_id,
        manifest=templates.inspect(template_id),
    )


@app.get("/api/templates/{template_id}/inspect", response_model=TemplateManifest)
async def inspect_template_endpoint(template_id: str) -> TemplateManifest:
    try:
        return templates.inspect(template_id)
    except FileNotFoundError:
        raise HTTPException(404, "unknown template_id")


@app.get("/api/templates/{template_id}/binary")
async def get_template_binary(template_id: str) -> FileResponse:
    """Return the raw .pptx bytes for a stored template. Mirrors the docx
    agent's analogous endpoint; consumers (the drafter) use this to fetch
    the source deck so downstream pipelines can use it as a style reference.
    """
    try:
        path = templates.get_template_path(template_id)
    except FileNotFoundError:
        raise HTTPException(404, "unknown template_id")
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=path.name,
    )


# ---- Presentations: spec-driven ---------------------------------------------

class FillRequest(BaseModel):
    template_id: str
    spec: DeckSpec  # spec.template is ignored — we resolve from template_id


class FillResponse(BaseModel):
    job_id: str
    file_path: str
    fields_applied: int
    tables_applied: int
    rag_applied: int
    missing_fields: list[str] = Field(default_factory=list)
    missing_tables: list[str] = Field(default_factory=list)
    missing_rag: list[str] = Field(default_factory=list)
    overflows: list[str] = Field(default_factory=list)
    unfilled: list[dict] = Field(default_factory=list)


@app.post("/api/presentations/fill", response_model=FillResponse)
async def fill(req: FillRequest) -> FillResponse:
    try:
        template_path = templates.get_template_path(req.template_id)
    except FileNotFoundError:
        raise HTTPException(404, "unknown template_id")

    job_id = str(uuid.uuid4())
    output_path = config.output_dir / f"{job_id}.pptx"
    # Override the spec's template with the one resolved from template_id
    bound_spec = req.spec.model_copy(update={"template": str(template_path)})
    path, report = fill_deck(bound_spec, output_path)

    jobs.create(Job(
        id=job_id,
        status="completed",
        file_path=str(path),
        template_id=req.template_id,
        slide_count=len(bound_spec.slides),
        missing={
            "fields": report.fields_missing,
            "tables": report.tables_missing,
            "rag": report.rag_missing,
        },
    ))
    return FillResponse(
        job_id=job_id,
        file_path=str(path),
        fields_applied=report.fields_applied,
        tables_applied=report.tables_applied,
        rag_applied=report.rag_applied,
        missing_fields=report.fields_missing,
        missing_tables=report.tables_missing,
        missing_rag=report.rag_missing,
        overflows=report.overflows,
        unfilled=[dict(w) for w in report.unfilled],
    )


# ---- Presentations: prompt-driven (LLM agent loop) ---------------------------

class GenerateRequest(BaseModel):
    template_id: str
    instructions: str
    # Optional per-request model override. Defaults to config.llm_model
    # (PPTX_TEMPLATE_AGENT_MODEL / DEFAULT_LLM_MODEL). The proxy routes the
    # named model to the appropriate provider; the agent never sees keys.
    model: str | None = None


@app.post("/api/presentations/generate")
async def generate(req: GenerateRequest, request: Request) -> dict[str, str]:
    try:
        template_path = templates.get_template_path(req.template_id)
    except FileNotFoundError:
        raise HTTPException(404, "unknown template_id")

    job_id = str(uuid.uuid4())
    output_path = config.output_dir / f"{job_id}.pptx"
    config.output_dir.mkdir(parents=True, exist_ok=True)
    agent_api_key = get_agent_api_key({k: v for k, v in request.headers.items()})

    job = Job(id=job_id, template_id=req.template_id, agent_api_key=agent_api_key)
    jobs.create(job)

    async def runner() -> None:
        try:
            report = await asyncio.to_thread(
                run_loop,
                req.instructions,
                template_path,
                output_path,
                model=req.model,
                on_event=lambda m: log.info("[%s] %s", job_id[:8], m),
            )
            job.status = "completed"
            job.file_path = report["path"]
            job.missing = {
                "fields": report["missing_fields"],
                "tables": report["missing_tables"],
                "rag": report["missing_rag"],
            }
            if agent_api_key:
                download_url = (
                    f"{config.public_base_url}/api/presentations/{job_id}/download"
                )
                try:
                    await fire_completion_webhook(
                        job_id, Path(report["path"]).name, download_url, agent_api_key
                    )
                except Exception as e:  # noqa: BLE001
                    log.warning("[%s] webhook failed: %s", job_id[:8], e)
        except Exception as e:  # noqa: BLE001
            job.status = "failed"
            job.error = str(e)
            log.exception("[%s] failed", job_id[:8])

    asyncio.create_task(runner())
    return {"job_id": job_id, "status": "processing"}


# ---- Status / download -------------------------------------------------------

@app.get("/api/presentations/{job_id}/status")
async def status(job_id: str) -> JSONResponse:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job_id")
    return JSONResponse({
        "job_id": job.id,
        "status": job.status,
        "file_available": bool(job.file_path),
        "error": job.error,
        "missing": job.missing,
    })


@app.get("/api/presentations/{job_id}/download")
async def download(job_id: str) -> FileResponse:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job_id")
    if not job.file_path:
        raise HTTPException(409, "file not yet available")
    return FileResponse(
        job.file_path,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=Path(job.file_path).name,
    )
