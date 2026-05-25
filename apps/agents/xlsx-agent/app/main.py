import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from app.agent.loop import run_agent_loop
from app.config import settings
from app.services.webhook import (
    fire_completion_webhook,
    fire_failure_webhook,
    get_agent_api_key,
)

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
CSV_MEDIA_TYPE = "text/csv"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
log = logging.getLogger("xlsx-agent")


@dataclass
class Job:
    id: str
    status: str  # "processing" | "completed" | "failed"
    created_at: datetime = field(default_factory=datetime.utcnow)
    file_path: Path | None = None
    filename: str | None = None
    media_type: str = XLSX_MEDIA_TYPE
    error: str | None = None
    agent_api_key: str | None = None


JOBS: dict[str, Job] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting XLSX Agent on %s:%s", settings.host, settings.port)
    log.info("LLM proxy: %s  model: %s", settings.llm_proxy_url, settings.model)
    log.info("Output dir: %s", settings.output_dir)
    yield
    log.info("Shutting down XLSX Agent")


app = FastAPI(
    title="XLSX Agent",
    description="LLM-powered Excel workbook builder using openpyxl",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class GenerateRequest(BaseModel):
    instructions: str
    # Optional per-request model override. Defaults to settings.model
    # (XLSX_AGENT_MODEL / DEFAULT_LLM_MODEL). The proxy routes the named
    # model to the appropriate provider; xlsx-agent never sees keys.
    model: str | None = None


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "xlsx-agent"}


async def _process_job(job: Job, instructions: str, model: str | None = None) -> None:
    job_dir = settings.output_dir / job.id
    job_dir.mkdir(parents=True, exist_ok=True)

    def log_progress(msg: str) -> None:
        log.info("[JOB %s] %s", job.id[:8], msg)

    try:
        result = await run_agent_loop(
            user_prompt=instructions,
            job_dir=job_dir,
            on_progress=log_progress,
            model=model,
        )
        job.file_path = result.file_path
        job.filename = result.filename
        job.status = "completed"
        log_progress(f"Completed: {result.filename}")

        if job.agent_api_key:
            download_url = f"{settings.public_base_url}/api/spreadsheets/{job.id}/download"
            try:
                await fire_completion_webhook(
                    job_id=job.id,
                    filename=result.filename,
                    download_url=download_url,
                    agent_api_key=job.agent_api_key,
                )
            except Exception as e:
                log.exception("[JOB %s] Webhook failed: %s", job.id[:8], e)
    except Exception as e:
        # Record a useful error string. `str(e)` is empty for some httpx
        # exceptions (e.g. ReadTimeout) — prepend the type so the agent
        # always sees something meaningful.
        err_text = f"{type(e).__name__}: {e}".rstrip(": ")
        job.status = "failed"
        job.error = err_text
        log.exception("[JOB %s] Failed: %s", job.id[:8], err_text)

        # Fire the failure webhook so the agent is unblocked instead of
        # waiting indefinitely for a completion that will never come.
        if job.agent_api_key:
            try:
                await fire_failure_webhook(
                    job_id=job.id,
                    error_summary=err_text,
                    agent_api_key=job.agent_api_key,
                )
            except Exception as webhook_err:
                log.exception(
                    "[JOB %s] Failure webhook failed: %s",
                    job.id[:8],
                    webhook_err,
                )


@app.post("/api/spreadsheets/generate", status_code=202)
async def generate(req: Request, body: GenerateRequest) -> JSONResponse:
    if not body.instructions.strip():
        raise HTTPException(status_code=400, detail="Missing required field: instructions")

    agent_api_key = get_agent_api_key(dict(req.headers))
    job_id = str(uuid.uuid4())
    job = Job(id=job_id, status="processing", agent_api_key=agent_api_key)
    JOBS[job_id] = job

    asyncio.create_task(_process_job(job, body.instructions, body.model))

    return JSONResponse(
        status_code=202,
        content={
            "job_id": job_id,
            "status": "processing",
            "message": "Spreadsheet generation started. You will be notified via webhook when ready.",
        },
    )


@app.get("/api/spreadsheets/{job_id}/status")
async def status_endpoint(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    response: dict = {
        "job_id": job.id,
        "status": job.status,
        "created_at": job.created_at.isoformat(),
    }
    if job.status == "completed" and job.file_path:
        response["download_url"] = f"{settings.public_base_url}/api/spreadsheets/{job.id}/download"
        response["filename"] = job.filename
    if job.status == "failed":
        response["error"] = job.error
    return response


@app.get("/api/spreadsheets/{job_id}/download")
async def download(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "completed" or not job.file_path or not job.file_path.exists():
        raise HTTPException(status_code=404, detail="File not ready")

    return FileResponse(
        path=str(job.file_path),
        media_type=job.media_type,
        filename=job.filename or "workbook.xlsx",
    )


async def _proxy_conversion(
    endpoint: str,
    file: UploadFile,
    form: dict[str, str],
    output_ext: str,
    media_type: str,
) -> Job:
    contents = await file.read()
    files = {"file": (file.filename or f"upload{output_ext}", contents, file.content_type or "application/octet-stream")}
    data = {k: v for k, v in form.items() if v is not None}

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(
                f"{settings.python_tools_url}{endpoint}",
                files=files,
                data=data,
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"conversion service unreachable: {e}")

    if res.status_code >= 400:
        detail = res.text
        try:
            detail = res.json().get("detail", detail)
        except Exception:
            pass
        raise HTTPException(status_code=res.status_code, detail=detail)

    job_id = str(uuid.uuid4())
    job_dir = settings.output_dir / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    source_stem = Path(file.filename).stem if file.filename else "data"
    filename = f"{source_stem}{output_ext}"
    file_path = job_dir / f"result{output_ext}"
    file_path.write_bytes(res.content)

    job = Job(
        id=job_id,
        status="completed",
        file_path=file_path,
        filename=filename,
        media_type=media_type,
    )
    JOBS[job_id] = job
    return job


def _conversion_response(job: Job) -> dict:
    return {
        "job_id": job.id,
        "status": job.status,
        "filename": job.filename,
        "download_url": f"{settings.public_base_url}/api/spreadsheets/{job.id}/download",
        "created_at": job.created_at.isoformat(),
    }


@app.post("/api/spreadsheets/csv-to-xlsx")
async def csv_to_xlsx_proxy(
    file: UploadFile = File(...),
    sheet_name: str | None = Form(None),
    delimiter: str | None = Form(None),
):
    job = await _proxy_conversion(
        endpoint="/csv-to-xlsx",
        file=file,
        form={"sheet_name": sheet_name, "delimiter": delimiter},
        output_ext=".xlsx",
        media_type=XLSX_MEDIA_TYPE,
    )
    return _conversion_response(job)


@app.post("/api/spreadsheets/xlsx-to-csv")
async def xlsx_to_csv_proxy(
    file: UploadFile = File(...),
    sheet: str | None = Form(None),
):
    job = await _proxy_conversion(
        endpoint="/xlsx-to-csv",
        file=file,
        form={"sheet": sheet},
        output_ext=".csv",
        media_type=CSV_MEDIA_TYPE,
    )
    return _conversion_response(job)
