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

    # LLM config is resolved per-request from pe-settings-host (see
    # settings_host.py). The agent calls the upstream provider's
    # OpenAI-compatible /chat/completions directly — there is no in-suite
    # proxy and no env-mode fallback.
    pe_settings_host_url: str = os.environ.get(
        "PE_SETTINGS_HOST_URL", "http://localhost:19271"
    ).rstrip("/")

    admin_service_url: str | None = os.environ.get("ADMIN_SERVICE_URL") or None


config = Config()
