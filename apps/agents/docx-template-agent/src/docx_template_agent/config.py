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

    # All LLM traffic flows through a LiteLLM-compatible proxy that exposes
    # an OpenAI chat-completions endpoint. The agent does not need to know
    # which provider serves a given model — the proxy maps model names to
    # providers and holds provider keys centrally.
    llm_proxy_url: str = os.environ.get(
        "LLM_PROXY_URL", "http://localhost:4000"
    ).rstrip("/")
    llm_proxy_api_key: str | None = os.environ.get("LLM_PROXY_API_KEY") or None

    llm_model: str | None = (
        os.environ.get("DOCX_TEMPLATE_AGENT_MODEL")
        or os.environ.get("DEFAULT_LLM_MODEL")
        or None
    )

    admin_service_url: str | None = os.environ.get("ADMIN_SERVICE_URL") or None


config = Config()
