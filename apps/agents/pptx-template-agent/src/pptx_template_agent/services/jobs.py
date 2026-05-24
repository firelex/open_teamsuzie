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
    slide_count: int = 0
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    agent_api_key: str | None = None
    missing: dict[str, list[str]] = field(default_factory=dict)


_jobs: dict[str, Job] = {}


def create(job: Job) -> None:
    _jobs[job.id] = job


def get(job_id: str) -> Job | None:
    return _jobs.get(job_id)


def all_jobs() -> list[Job]:
    return list(_jobs.values())
