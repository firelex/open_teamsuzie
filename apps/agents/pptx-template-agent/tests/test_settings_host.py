from __future__ import annotations

import time
from typing import Any

import httpx
import pytest

from pptx_template_agent.settings_host import (
    SettingsHostClient,
    SettingsHostUnavailable,
)


def _make_client(
    *,
    responses: list[httpx.Response],
    ttl: float = 5.0,
) -> tuple[SettingsHostClient, dict[str, Any]]:
    """Build a SettingsHostClient backed by a MockTransport that yields the
    given responses in order. Returns the client + a counter dict so tests
    can assert on the number of HTTP calls made."""
    counter = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        counter["count"] += 1
        idx = min(counter["count"] - 1, len(responses) - 1)
        return responses[idx]

    transport = httpx.MockTransport(handler)
    http_client = httpx.Client(transport=transport)
    client = SettingsHostClient(
        base_url="http://settings-host.test",
        client=http_client,
        cache_ttl_seconds=ttl,
    )
    return client, counter


def _ok_response(
    *,
    proxy_url: str = "http://localhost:4000",
    default_model: str | None = "claude-sonnet-4-5-20250929",
    master_key: str = "sk-test",
) -> httpx.Response:
    body: dict[str, Any] = {"proxy_url": proxy_url, "master_key": master_key}
    if default_model is not None:
        body["default_model"] = default_model
    return httpx.Response(200, json=body)


def test_resolve_returns_payload():
    client, _ = _make_client(responses=[_ok_response()])
    result = client.resolve()
    assert result.proxy_url == "http://localhost:4000"
    assert result.default_model == "claude-sonnet-4-5-20250929"
    assert result.master_key == "sk-test"


def test_resolve_caches_within_ttl():
    client, counter = _make_client(responses=[_ok_response()], ttl=60.0)
    client.resolve()
    client.resolve()
    client.resolve()
    assert counter["count"] == 1


def test_resolve_refetches_after_ttl():
    client, counter = _make_client(
        responses=[
            _ok_response(default_model="model-a"),
            _ok_response(default_model="model-b"),
        ],
        ttl=0.05,
    )
    first = client.resolve()
    assert first.default_model == "model-a"
    time.sleep(0.1)
    second = client.resolve()
    assert second.default_model == "model-b"
    assert counter["count"] == 2


def test_resolve_raises_on_non_200():
    client, _ = _make_client(responses=[httpx.Response(500, text="boom")])
    with pytest.raises(SettingsHostUnavailable, match="500"):
        client.resolve()


def test_resolve_raises_on_network_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    client = SettingsHostClient(
        base_url="http://settings-host.test", client=http_client
    )
    with pytest.raises(SettingsHostUnavailable, match="unreachable"):
        client.resolve()


def test_resolve_raises_on_malformed_payload():
    client, _ = _make_client(
        responses=[httpx.Response(200, json={"only_this": "field"})]
    )
    with pytest.raises(SettingsHostUnavailable, match="malformed"):
        client.resolve()


def test_resolve_default_model_can_be_none():
    client, _ = _make_client(responses=[_ok_response(default_model=None)])
    result = client.resolve()
    assert result.default_model is None
    assert result.proxy_url == "http://localhost:4000"


def test_resolve_sends_internal_token_header():
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["token"] = request.headers.get("internal-service-token", "")
        return _ok_response()

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    client = SettingsHostClient(
        base_url="http://settings-host.test",
        client=http_client,
        internal_token="pptx-template-agent",
    )
    client.resolve()
    assert captured["token"] == "pptx-template-agent"
