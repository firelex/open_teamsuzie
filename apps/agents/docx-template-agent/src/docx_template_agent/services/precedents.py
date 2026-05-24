"""Precedents store: persist uploaded PDFs / DOCX precedents by content hash.

Mirrors the templates store. A precedent never modifies layout — it is
read-only context the LLM agent uses to mimic structure and tone."""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from ..config import config
from ..precedents.loader import PrecedentManifest, load_precedent

log = logging.getLogger(__name__)


def _hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def save_precedent(data: bytes, suffix: str) -> tuple[str, Path]:
    """Persist a precedent and return (precedent_id, path). The id is the
    content hash; suffix (`.pdf` / `.docx`) is preserved on disk so the
    loader can dispatch correctly."""
    if suffix not in (".pdf", ".docx"):
        raise ValueError(f"unsupported precedent suffix: {suffix}")
    config.precedents_store.mkdir(parents=True, exist_ok=True)
    precedent_id = _hash(data)
    dest = config.precedents_store / f"{precedent_id}{suffix}"
    if not dest.exists():
        dest.write_bytes(data)
    return precedent_id, dest


def get_precedent_path(precedent_id: str) -> Path:
    """Resolve the stored precedent by id, regardless of suffix."""
    for suffix in (".pdf", ".docx"):
        p = config.precedents_store / f"{precedent_id}{suffix}"
        if p.exists():
            return p
    raise FileNotFoundError(f"Unknown precedent_id: {precedent_id}")


def inspect(precedent_id: str) -> PrecedentManifest:
    return load_precedent(get_precedent_path(precedent_id))
