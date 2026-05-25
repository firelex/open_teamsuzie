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

    # All LLM traffic flows through a LiteLLM-compatible proxy that exposes
    # an OpenAI chat-completions endpoint. The agent does not need to know
    # which provider serves a given model — the proxy maps model names to
    # providers and holds provider keys centrally.
    llm_proxy_url: str = os.environ.get(
        "LLM_PROXY_URL", "http://localhost:4000"
    ).rstrip("/")
    llm_proxy_api_key: str | None = os.environ.get("LLM_PROXY_API_KEY") or None

    llm_model: str | None = (
        os.environ.get("PPTX_TEMPLATE_AGENT_MODEL")
        or os.environ.get("DEFAULT_LLM_MODEL")
        or None
    )

    admin_service_url: str | None = os.environ.get("ADMIN_SERVICE_URL") or None


config = Config()
