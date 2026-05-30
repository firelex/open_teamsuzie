"""Client for pe-settings-host's `/api/settings/effective` endpoint.

pe-settings-host is the single source of truth for LLM configuration
across the PE suite. Every generate call resolves
``{base_url, api_key, model}`` from the host (with a short in-process TTL
cache) and the agent POSTs directly to the upstream's OpenAI-compatible
``/chat/completions`` — there is no in-suite proxy.
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
    base_url: str
    api_key: str
    model: str


class SettingsHostClient:
    """Resolves LLM config from pe-settings-host with a 5s TTL cache.

    Thread-safe enough for FastAPI's threadpool — a single Lock guards
    the cache slot, and httpx.Client is itself thread-safe for ``get()``.
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

        url = f"{self._base_url}/api/settings/effective"
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

        base_url_v = data.get("base_url")
        api_key = data.get("api_key")
        model = data.get("model")
        if (
            not isinstance(base_url_v, str)
            or not isinstance(api_key, str)
            or not isinstance(model, str)
        ):
            raise SettingsHostUnavailable(
                "pe-settings-host returned malformed payload "
                "(missing base_url/api_key/model)"
            )

        value = EffectiveLlmConfig(base_url=base_url_v, api_key=api_key, model=model)
        with self._lock:
            self._cached = value
            self._expires_at = time.monotonic() + self._ttl
        return value
