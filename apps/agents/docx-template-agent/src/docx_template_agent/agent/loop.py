"""Provider-dispatching agent loop for docx drafting.

Reads `config.llm_provider` (or the `provider=` override) and routes to
either the Anthropic-native loop or the OpenAI-compatible loop (which
covers OpenAI, Dashscope and other OpenAI-protocol providers)."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Callable

from anthropic import Anthropic

from ..config import config
from .openai_loop import run_loop_openai
from .system_prompt import SYSTEM_PROMPT
from .tools import TOOL_DEFINITIONS, AgentState, dispatch

log = logging.getLogger(__name__)

MAX_TURNS = 30


def _run_loop_anthropic(
    prompt: str,
    template_path: Path,
    output_path: Path,
    *,
    precedent_ids: list[str] | None = None,
    model: str | None = None,
    on_event: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    chosen_model = model or config.llm_model
    if not chosen_model:
        raise RuntimeError(
            "No LLM model configured. Set DOCX_TEMPLATE_AGENT_MODEL or DEFAULT_LLM_MODEL."
        )
    if not config.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set.")

    state = AgentState(template_path=template_path, output_path=output_path)
    client = Anthropic(api_key=config.anthropic_api_key)

    user_msg = prompt
    if precedent_ids:
        user_msg += "\n\nPrecedent IDs available for reference: " + ", ".join(precedent_ids)

    messages: list[dict[str, Any]] = [{"role": "user", "content": user_msg}]

    def event(msg: str) -> None:
        log.info(msg)
        if on_event:
            on_event(msg)

    for turn in range(MAX_TURNS):
        event(f"turn {turn + 1}: anthropic/{chosen_model}")
        resp = client.messages.create(
            model=chosen_model,
            max_tokens=8192,
            system=SYSTEM_PROMPT,
            tools=TOOL_DEFINITIONS,
            messages=messages,
        )
        messages.append({"role": "assistant", "content": resp.content})

        tool_uses = [b for b in resp.content if b.type == "tool_use"]
        if not tool_uses:
            event("model produced no tool_use; ending loop")
            break

        tool_results: list[dict[str, Any]] = []
        for use in tool_uses:
            event(f"  tool: {use.name}  input_keys={list(use.input.keys())}")
            try:
                result = dispatch(state, use.name, use.input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": use.id,
                    "content": json.dumps(result, default=str),
                })
            except Exception as e:  # noqa: BLE001
                event(f"    error: {e}")
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": use.id,
                    "content": f"error: {e}",
                    "is_error": True,
                })

        messages.append({"role": "user", "content": tool_results})

        if state.saved:
            event("save_doc called; loop done")
            break
    else:
        raise RuntimeError(f"agent loop exceeded {MAX_TURNS} turns without saving")

    if not state.saved or state.save_report is None:
        raise RuntimeError("agent loop ended without saving")
    return state.save_report


def run_loop(
    prompt: str,
    template_path: Path,
    output_path: Path,
    *,
    precedent_ids: list[str] | None = None,
    model: str | None = None,
    provider: str | None = None,
    on_event: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Run the agent loop against the configured (or overridden) provider.

    Returns the save report when the model calls save_doc. Raises if the
    loop exceeds the per-provider turn cap without saving."""
    chosen_provider = (provider or config.llm_provider).lower()

    if chosen_provider == "anthropic":
        return _run_loop_anthropic(
            prompt, template_path, output_path,
            precedent_ids=precedent_ids, model=model, on_event=on_event,
        )
    if chosen_provider in ("openai", "dashscope"):
        return run_loop_openai(
            prompt, template_path, output_path,
            precedent_ids=precedent_ids, model=model,
            provider=chosen_provider, on_event=on_event,
        )
    raise ValueError(f"Unknown LLM provider: {chosen_provider!r}")
