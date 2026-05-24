"""Templates store: persist uploaded .pptx files by ID and look them up.

The store is a directory of `<template_id>.pptx` files. IDs are deterministic
(content hash) so the same upload returns the same ID."""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from pptx import Presentation

from ..config import config
from ..injection import TemplateManifest, inspect_template
from ..injection.template_fixup import auto_resolve_collisions

log = logging.getLogger(__name__)


def _hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def save_template(data: bytes, *, auto_fix: bool = True) -> tuple[str, Path]:
    """Persist a .pptx and return (template_id, path). Idempotent on content.

    When `auto_fix` is True (default), runs collision detection at ingestion
    and writes a normalized copy: any shape that the template's tables would
    visually collide with at render time is shifted down to clear the table.
    The original upload bytes are not preserved separately — the content
    hash still identifies *this* upload, and subsequent uploads with the
    same bytes will skip re-saving."""
    config.templates_store.mkdir(parents=True, exist_ok=True)
    template_id = _hash(data)
    dest = config.templates_store / f"{template_id}.pptx"
    if not dest.exists():
        dest.write_bytes(data)
        if auto_fix:
            prs = Presentation(str(dest))
            fixes = auto_resolve_collisions(prs)
            if fixes:
                prs.save(str(dest))
                log.info(
                    "template %s: auto-resolved %d collision shift(s)",
                    template_id, len(fixes),
                )
    return template_id, dest


def get_template_path(template_id: str) -> Path:
    path = config.templates_store / f"{template_id}.pptx"
    if not path.exists():
        raise FileNotFoundError(f"Unknown template_id: {template_id}")
    return path


def inspect(template_id: str) -> TemplateManifest:
    return inspect_template(get_template_path(template_id))
