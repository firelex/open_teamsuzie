from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _path_or_none(env: str) -> Path | None:
    v = os.environ.get(env, "").strip()
    return Path(v) if v else None


class Config:
    port: int = int(os.environ.get("PPTX_TEMPLATE_AGENT_PORT", "8081"))
    public_base_url: str = os.environ.get(
        "PPTX_TEMPLATE_AGENT_PUBLIC_BASE_URL", "http://localhost:8081"
    )
    output_dir: Path = Path(
        os.environ.get("PPTX_TEMPLATE_AGENT_OUTPUT_DIR", "./output")
    )
    templates_store: Path = Path(
        os.environ.get("PPTX_TEMPLATE_AGENT_TEMPLATES_DIR", "./templates")
    )
    # Optional convenience default — only used when CLI/clients don't pass one.
    # The agent itself never assumes any particular template.
    default_template: Path | None = _path_or_none("PPTX_TEMPLATE_AGENT_TEMPLATE")

    # LLM config is resolved per-request from pe-settings-host (see
    # settings_host.py). The agent calls the upstream provider's
    # OpenAI-compatible /chat/completions directly — there is no in-suite
    # proxy and no env-mode fallback.
    pe_settings_host_url: str = os.environ.get(
        "PE_SETTINGS_HOST_URL", "http://localhost:19271"
    ).rstrip("/")

    admin_service_url: str | None = os.environ.get("ADMIN_SERVICE_URL") or None


config = Config()
