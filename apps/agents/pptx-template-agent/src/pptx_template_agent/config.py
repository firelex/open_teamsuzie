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

    # Provider routing. "anthropic" uses the Anthropic SDK directly.
    # "openai" and "dashscope" both use the openai SDK; "dashscope" defaults
    # the base_url to Alibaba's OpenAI-compatible endpoint.
    llm_provider: str = (
        os.environ.get("LLM_PROVIDER")
        or ("dashscope" if os.environ.get("DASHSCOPE_API_KEY") else "anthropic")
    ).lower()
    llm_model: str | None = (
        os.environ.get("PPTX_TEMPLATE_AGENT_MODEL")
        or os.environ.get("DEFAULT_LLM_MODEL")
        or None
    )

    anthropic_api_key: str | None = os.environ.get("ANTHROPIC_API_KEY") or None
    openai_api_key: str | None = os.environ.get("OPENAI_API_KEY") or None
    dashscope_api_key: str | None = os.environ.get("DASHSCOPE_API_KEY") or None
    openai_base_url: str | None = os.environ.get("OPENAI_BASE_URL") or None
    dashscope_base_url: str = (
        os.environ.get("DASHSCOPE_BASE_URL")
        or "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    )

    admin_service_url: str | None = os.environ.get("ADMIN_SERVICE_URL") or None


config = Config()
