"""FastAPI server for docx-template-agent.

Endpoints:
  GET  /api/health
  POST /api/templates                       upload .docx, returns id + manifest
  GET  /api/templates/{id}/inspect          return manifest
  POST /api/documents/fill                  spec-driven fill (no LLM)
  POST /api/documents/generate              prompt-driven generation (v2 — returns 501)
  GET  /api/documents/{job}/status
  GET  /api/documents/{job}/download
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .agent.loop import run_loop
from .config import config
from .injection import fill_doc
from .injection.inspect import TemplateManifest
from .models import DocSpec
from .precedents.loader import PrecedentManifest
from .services import jobs, templates
from .services import precedents as precedents_svc
from .services.jobs import Job
from .services.webhook import fire_completion_webhook, get_agent_api_key

log = logging.getLogger(__name__)
app = FastAPI(title="docx-template-agent", version="0.1.0")


# ---- Health ------------------------------------------------------------------

@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "docx-template-agent"}


# ---- Templates ---------------------------------------------------------------

class TemplateUploadResponse(BaseModel):
    template_id: str
    manifest: TemplateManifest


@app.post("/api/templates", response_model=TemplateUploadResponse)
async def upload_template(file: UploadFile = File(...)) -> TemplateUploadResponse:
    if not file.filename or not file.filename.lower().endswith(".docx"):
        raise HTTPException(400, "file must be .docx")
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


# ---- Precedents --------------------------------------------------------------

class PrecedentUploadResponse(BaseModel):
    precedent_id: str
    manifest: PrecedentManifest


@app.post("/api/precedents", response_model=PrecedentUploadResponse)
async def upload_precedent(file: UploadFile = File(...)) -> PrecedentUploadResponse:
    if not file.filename:
        raise HTTPException(400, "filename required")
    suffix = "." + file.filename.lower().rsplit(".", 1)[-1] if "." in file.filename else ""
    if suffix not in (".pdf", ".docx"):
        raise HTTPException(400, "precedent must be .pdf or .docx")
    data = await file.read()
    precedent_id, _ = precedents_svc.save_precedent(data, suffix)
    return PrecedentUploadResponse(
        precedent_id=precedent_id,
        manifest=precedents_svc.inspect(precedent_id),
    )


@app.get("/api/precedents/{precedent_id}/inspect", response_model=PrecedentManifest)
async def inspect_precedent_endpoint(precedent_id: str) -> PrecedentManifest:
    try:
        return precedents_svc.inspect(precedent_id)
    except FileNotFoundError:
        raise HTTPException(404, "unknown precedent_id")


# ---- Documents: spec-driven --------------------------------------------------

class FillRequest(BaseModel):
    template_id: str
    spec: DocSpec  # spec.template is overridden by template_id


class FillResponse(BaseModel):
    job_id: str
    file_path: str
    replacements: int
    paragraphs_touched: int
    unfilled_tokens: list[str] = Field(default_factory=list)


@app.post("/api/documents/fill", response_model=FillResponse)
async def fill(req: FillRequest) -> FillResponse:
    try:
        template_path = templates.get_template_path(req.template_id)
    except FileNotFoundError:
        raise HTTPException(404, "unknown template_id")

    job_id = str(uuid.uuid4())
    output_path = config.output_dir / f"{job_id}.docx"
    bound_spec = req.spec.model_copy(update={"template": str(template_path)})
    path, report = fill_doc(bound_spec, output_path)

    jobs.create(Job(
        id=job_id,
        status="completed",
        file_path=str(path),
        template_id=req.template_id,
        replacements=report.replacements,
        unfilled_tokens=report.unfilled_tokens,
    ))
    return FillResponse(
        job_id=job_id,
        file_path=str(path),
        replacements=report.replacements,
        paragraphs_touched=report.paragraphs_touched,
        unfilled_tokens=report.unfilled_tokens,
    )


# ---- Documents: prompt-driven (LLM agent loop) ------------------------------

class GenerateRequest(BaseModel):
    template_id: str
    instructions: str
    precedent_ids: list[str] = Field(default_factory=list)
    # Optional per-request model override. Defaults to config.llm_model
    # (DOCX_TEMPLATE_AGENT_MODEL / DEFAULT_LLM_MODEL). The proxy routes the
    # named model to the appropriate provider; the agent never sees keys.
    model: str | None = None


@app.post("/api/documents/generate")
async def generate(req: GenerateRequest, request: Request) -> dict[str, str]:
    try:
        template_path = templates.get_template_path(req.template_id)
    except FileNotFoundError:
        raise HTTPException(404, "unknown template_id")

    for pid in req.precedent_ids:
        try:
            precedents_svc.get_precedent_path(pid)
        except FileNotFoundError:
            raise HTTPException(404, f"unknown precedent_id: {pid}")

    job_id = str(uuid.uuid4())
    output_path = config.output_dir / f"{job_id}.docx"
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
                precedent_ids=req.precedent_ids or None,
                model=req.model,
                on_event=lambda m: log.info("[%s] %s", job_id[:8], m),
            )
            job.status = "completed"
            job.file_path = report["path"]
            job.replacements = report["replacements"]
            job.unfilled_tokens = report["unfilled_tokens"]
            if agent_api_key:
                download_url = (
                    f"{config.public_base_url}/api/documents/{job_id}/download"
                )
                try:
                    await fire_completion_webhook(
                        job_id, Path(report["path"]).name, download_url, agent_api_key,
                    )
                except Exception as e:  # noqa: BLE001
                    log.warning("[%s] webhook failed: %s", job_id[:8], e)
        except Exception as e:  # noqa: BLE001
            job.status = "failed"
            job.error = str(e)
            log.exception("[%s] generate failed", job_id[:8])

    asyncio.create_task(runner())
    return {"job_id": job_id, "status": "processing"}


# ---- Status / download -------------------------------------------------------

@app.get("/api/documents/{job_id}/status")
async def status(job_id: str) -> JSONResponse:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job_id")
    return JSONResponse({
        "job_id": job.id,
        "status": job.status,
        "file_available": bool(job.file_path),
        "error": job.error,
        "replacements": job.replacements,
        "unfilled_tokens": job.unfilled_tokens,
    })


@app.get("/api/documents/{job_id}/download")
async def download(job_id: str) -> FileResponse:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job_id")
    if not job.file_path:
        raise HTTPException(409, "file not yet available")
    return FileResponse(
        job.file_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=Path(job.file_path).name,
    )
