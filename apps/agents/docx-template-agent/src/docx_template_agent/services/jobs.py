from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

JobStatus = Literal["processing", "completed", "failed"]


@dataclass
class Job:
    id: str
    status: JobStatus = "processing"
    file_path: str | None = None
    error: str | None = None
    template_id: str | None = None
    replacements: int = 0
    unfilled_tokens: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    agent_api_key: str | None = None


_jobs: dict[str, Job] = {}


def create(job: Job) -> None:
    _jobs[job.id] = job


def get(job_id: str) -> Job | None:
    return _jobs.get(job_id)


def all_jobs() -> list[Job]:
    return list(_jobs.values())
