"""Agent loop for pptx drafting.

All LLM traffic flows through a LiteLLM-compatible proxy (OpenAI
chat-completions protocol). The proxy maps model names to providers,
so this loop is provider-agnostic. We translate the Anthropic-style
tool definitions from `agent/tools.py` into OpenAI's `function` schema,
and translate response `tool_calls` back into the dispatcher's input
shape."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Callable

from openai import OpenAI

from ..config import config
from .system_prompt import SYSTEM_PROMPT
from .tools import TOOL_DEFINITIONS, AgentState, dispatch

log = logging.getLogger(__name__)

# Models that emit one tool_call per turn (Qwen on Dashscope via the
# proxy) can need many more turns than batched models. Per-turn cost
# is small.
MAX_TURNS = 120


def _to_openai_tools(anthropic_tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["input_schema"],
            },
        }
        for t in anthropic_tools
    ]


def _make_client() -> OpenAI:
    """OpenAI SDK client pointed at the LLM proxy."""
    return OpenAI(
        base_url=f"{config.llm_proxy_url}/v1",
        api_key=config.llm_proxy_api_key or "no-auth",
    )


def run_loop(
    prompt: str,
    template_path: Path,
    output_path: Path,
    *,
    model: str | None = None,
    on_event: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Run the agent loop. Returns the save report once the model calls save_deck.

    Raises if the loop exceeds MAX_TURNS without saving."""
    chosen_model = model or config.llm_model
    if not chosen_model:
        raise RuntimeError(
            "No LLM model configured. Set PPTX_TEMPLATE_AGENT_MODEL or DEFAULT_LLM_MODEL."
        )

    client = _make_client()
    state = AgentState(template_path=template_path, output_path=output_path)
    tools = _to_openai_tools(TOOL_DEFINITIONS)

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]

    def event(msg: str) -> None:
        log.info(msg)
        if on_event:
            on_event(msg)

    for turn in range(MAX_TURNS):
        event(f"turn {turn + 1}: {chosen_model}")
        resp = client.chat.completions.create(
            model=chosen_model,
            max_tokens=8192,
            messages=messages,
            tools=tools,
        )
        msg = resp.choices[0].message

        assistant_entry: dict[str, Any] = {
            "role": "assistant",
            "content": msg.content or "",
        }
        if msg.tool_calls:
            cleaned_calls = []
            for tc in msg.tool_calls:
                raw = tc.function.arguments or "{}"
                # Some upstreams reject subsequent requests if the assistant's
                # echoed tool_calls contain non-JSON arguments. Validate and
                # collapse to "{}" when malformed so the loop can recover.
                try:
                    json.loads(raw)
                    args_str = raw
                except json.JSONDecodeError:
                    args_str = "{}"
                cleaned_calls.append({
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": args_str},
                })
            assistant_entry["tool_calls"] = cleaned_calls
        messages.append(assistant_entry)

        if not msg.tool_calls:
            event("model returned no tool_calls; ending loop")
            break

        for tc in msg.tool_calls:
            name = tc.function.name
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError as e:
                args = {}
                event(f"  tool: {name} (arg parse error: {e})")

            event(f"  tool: {name}  input_keys={list(args.keys())}")
            try:
                result = dispatch(state, name, args)
                content = json.dumps(result, default=str)
            except Exception as e:  # noqa: BLE001
                event(f"    error: {e}")
                content = json.dumps({"error": str(e)})
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": content,
            })

        if state.saved:
            event("save_deck called; loop done")
            break
    else:
        raise RuntimeError(f"agent loop exceeded {MAX_TURNS} turns without saving")

    if not state.saved or state.save_report is None:
        raise RuntimeError("agent loop ended without saving")
    return state.save_report
