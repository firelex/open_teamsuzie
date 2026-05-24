"""Templates store: persist uploaded .docx files by content hash.

Mirrors the pptx-template-agent store. Idempotent on content — re-uploading
the same bytes returns the same id and skips the write."""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from ..config import config
from ..injection import TemplateManifest, inspect_template

log = logging.getLogger(__name__)


def _hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def save_template(data: bytes) -> tuple[str, Path]:
    config.templates_store.mkdir(parents=True, exist_ok=True)
    template_id = _hash(data)
    dest = config.templates_store / f"{template_id}.docx"
    if not dest.exists():
        dest.write_bytes(data)
    return template_id, dest


def get_template_path(template_id: str) -> Path:
    path = config.templates_store / f"{template_id}.docx"
    if not path.exists():
        raise FileNotFoundError(f"Unknown template_id: {template_id}")
    return path


def inspect(template_id: str) -> TemplateManifest:
    return inspect_template(get_template_path(template_id))
