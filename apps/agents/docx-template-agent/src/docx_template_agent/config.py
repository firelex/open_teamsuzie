from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


class Config:
    port: int = int(os.environ.get("DOCX_TEMPLATE_AGENT_PORT", "8082"))
    public_base_url: str = os.environ.get(
        "DOCX_TEMPLATE_AGENT_PUBLIC_BASE_URL", "http://localhost:8082"
    )
    output_dir: Path = Path(
        os.environ.get("DOCX_TEMPLATE_AGENT_OUTPUT_DIR", "./output")
    )
    templates_store: Path = Path(
        os.environ.get("DOCX_TEMPLATE_AGENT_TEMPLATES_DIR", "./templates")
    )
    precedents_store: Path = Path(
        os.environ.get("DOCX_TEMPLATE_AGENT_PRECEDENTS_DIR", "./precedents")
    )

    # Primary path for LLM config is pe-settings-host (see settings_host.py):
    # for every generate call the agent resolves proxy_url + master_key +
    # default_model from that service. The env vars below remain only as a
    # degraded-mode fallback for when pe-settings-host is unreachable.
    pe_settings_host_url: str = os.environ.get(
        "PE_SETTINGS_HOST_URL", "http://localhost:19271"
    ).rstrip("/")

    # FALLBACK ONLY — used when pe-settings-host is unavailable.
    llm_proxy_url: str = os.environ.get(
        "LLM_PROXY_URL", "http://localhost:4000"
    ).rstrip("/")
    llm_proxy_api_key: str | None = os.environ.get("LLM_PROXY_API_KEY") or None

    # FALLBACK ONLY — used when pe-settings-host has no default_model
    # configured AND the per-request `model` override is also empty.
    llm_model: str | None = (
        os.environ.get("DOCX_TEMPLATE_AGENT_MODEL")
        or os.environ.get("DEFAULT_LLM_MODEL")
        or None
    )

    admin_service_url: str | None = os.environ.get("ADMIN_SERVICE_URL") or None


config = Config()
