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
    # Monotonic event log appended by the agent loop's `on_event` callback.
    # Read by the status endpoint so the drafter can surface per-turn /
    # per-tool progress on its SSE stream. Capped at MAX_EVENTS to bound
    # memory; oldest entries are dropped first.
    events: list[str] = field(default_factory=list)


MAX_EVENTS = 200


def append_event(job: Job, msg: str) -> None:
    """Append an event string to the job's log, dropping the oldest if cap hit.

    Called from the agent thread (run_loop runs in asyncio.to_thread). CPython's
    GIL makes list.append + slicing atomic enough for this single-producer /
    single-consumer pattern; no lock needed.
    """
    job.events.append(msg)
    if len(job.events) > MAX_EVENTS:
        del job.events[: len(job.events) - MAX_EVENTS]


_jobs: dict[str, Job] = {}


def create(job: Job) -> None:
    _jobs[job.id] = job


def get(job_id: str) -> Job | None:
    return _jobs.get(job_id)


def all_jobs() -> list[Job]:
    return list(_jobs.values())
