"""Client for pe-settings-host's `/api/settings/llm/effective` endpoint.

pe-settings-host is the single source of truth for the LiteLLM proxy URL,
proxy master key, and default LLM model across the PE suite. Every LLM
call resolves these three values from the host (with a short in-process
TTL cache) instead of reading them from this agent's own env vars.

Env vars (`LLM_PROXY_URL`, `LLM_PROXY_API_KEY`, `DEFAULT_LLM_MODEL`) remain
as a degraded-mode fallback used only when the host is unreachable —
see `agent/loop.py`.
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass

import httpx


class SettingsHostUnavailable(RuntimeError):
    """Raised when pe-settings-host can't be reached or returns a non-200."""


@dataclass(frozen=True)
class EffectiveLlmConfig:
    proxy_url: str
    default_model: str | None
    master_key: str


class SettingsHostClient:
    """Resolves LLM config from pe-settings-host with a 5s TTL cache.

    Thread-safe enough for FastAPI's threadpool — a single Lock guards
    the cache slot, and httpx.Client is itself thread-safe for `get()`.
    """

    def __init__(
        self,
        *,
        base_url: str | None = None,
        internal_token: str = "docx-template-agent",
        cache_ttl_seconds: float = 5.0,
        client: httpx.Client | None = None,
    ) -> None:
        resolved_base = (
            base_url
            if base_url is not None
            else os.environ.get("PE_SETTINGS_HOST_URL", "http://localhost:19271")
        )
        self._base_url = resolved_base.rstrip("/")
        self._internal_token = internal_token
        self._ttl = cache_ttl_seconds
        self._client = client or httpx.Client(timeout=5.0)
        self._lock = threading.Lock()
        self._cached: EffectiveLlmConfig | None = None
        self._expires_at: float = 0.0

    def resolve(self) -> EffectiveLlmConfig:
        now = time.monotonic()
        with self._lock:
            if self._cached is not None and self._expires_at > now:
                return self._cached

        url = f"{self._base_url}/api/settings/llm/effective"
        headers = {"internal-service-token": self._internal_token}
        try:
            resp = self._client.get(url, headers=headers)
        except httpx.HTTPError as e:
            raise SettingsHostUnavailable(
                f"pe-settings-host unreachable at {url}: {e}"
            ) from e

        if resp.status_code != 200:
            raise SettingsHostUnavailable(
                f"pe-settings-host returned {resp.status_code} at {url}: "
                f"{resp.text[:200]}"
            )

        try:
            data = resp.json()
        except ValueError as e:
            raise SettingsHostUnavailable(
                f"pe-settings-host returned non-JSON payload: {e}"
            ) from e

        proxy_url = data.get("proxy_url")
        master_key = data.get("master_key")
        default_model = data.get("default_model")
        if not isinstance(proxy_url, str) or not isinstance(master_key, str):
            raise SettingsHostUnavailable(
                "pe-settings-host returned malformed payload "
                "(missing proxy_url/master_key)"
            )

        value = EffectiveLlmConfig(
            proxy_url=proxy_url,
            default_model=default_model if isinstance(default_model, str) and default_model else None,
            master_key=master_key,
        )
        with self._lock:
            self._cached = value
            self._expires_at = time.monotonic() + self._ttl
        return value
