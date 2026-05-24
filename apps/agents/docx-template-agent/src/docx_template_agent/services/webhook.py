from __future__ import annotations

import logging
from typing import Mapping

import httpx

from ..config import config

log = logging.getLogger(__name__)


def get_agent_api_key(headers: Mapping[str, str]) -> str | None:
    for key in ("x-agent-api-key", "X-Agent-Api-Key"):
        if key in headers:
            return headers[key]
    return None


async def fire_completion_webhook(
    job_id: str,
    filename: str,
    download_url: str,
    agent_api_key: str,
) -> None:
    """POST a completion notification to the admin service via the same
    resolve-by-key contract pptx-template-agent uses."""
    if not config.admin_service_url:
        log.warning("No ADMIN_SERVICE_URL configured; skipping webhook for %s", job_id)
        return

    async with httpx.AsyncClient(timeout=10.0) as client:
        resolve_url = f"{config.admin_service_url}/api/agents/resolve-by-key"
        resp = await client.get(resolve_url, headers={"x-agent-api-key": agent_api_key})
        if resp.status_code != 200:
            raise RuntimeError(f"resolve-by-key failed: {resp.status_code} {resp.text}")
        webhook_url = resp.json().get("webhookUrl")
        if not webhook_url:
            raise RuntimeError("admin returned no webhookUrl")

        payload = {
            "job_id": job_id,
            "filename": filename,
            "download_url": download_url,
            "status": "completed",
        }
        delivery = await client.post(webhook_url, json=payload)
        if delivery.status_code >= 400:
            raise RuntimeError(f"webhook delivery failed: {delivery.status_code}")
