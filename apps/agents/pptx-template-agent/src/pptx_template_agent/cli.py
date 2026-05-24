"""Command-line entry points.

Usage:
  pptx-template-agent inspect <template.pptx>
  pptx-template-agent fill <spec.json> --template <template.pptx> [--output <path>]
  pptx-template-agent generate "<prompt>" --template <template.pptx> [--output <path>] [--model <id>]
  pptx-template-agent serve [--port 8081]
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from .config import config
from .injection import fill_deck, inspect_template
from .models import DeckSpec


def _cmd_inspect(args: argparse.Namespace) -> int:
    manifest = inspect_template(args.template)
    json.dump(manifest, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")
    return 0


def _cmd_fill(args: argparse.Namespace) -> int:
    raw = json.loads(Path(args.spec).read_text())
    raw.setdefault("template", args.template)
    if args.template:
        raw["template"] = args.template
    spec = DeckSpec.model_validate(raw)
    out = Path(args.output) if args.output else config.output_dir / f"{spec.deal_name}.pptx"
    path, report = fill_deck(spec, out)
    print(f"Wrote {path}")
    print(f"  fields={report.fields_applied} tables={report.tables_applied} rag={report.rag_applied}")
    if not report.is_clean:
        print(f"  missing fields: {report.fields_missing}")
        print(f"  missing tables: {report.tables_missing}")
        print(f"  missing rag:    {report.rag_missing}")
    return 0


def _cmd_generate(args: argparse.Namespace) -> int:
    from .agent.loop import run_loop  # lazy import — anthropic SDK is heavy

    out = Path(args.output) if args.output else config.output_dir / "generated.pptx"
    report = run_loop(
        args.prompt,
        Path(args.template),
        out,
        model=args.model,
        on_event=lambda m: print(f"  {m}"),
    )
    print(f"\nWrote {report['path']}")
    print(f"  fields={report['fields_applied']} tables={report['tables_applied']} rag={report['rag_applied']}")
    return 0


def _cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    uvicorn.run(
        "pptx_template_agent.server:app",
        host="0.0.0.0",
        port=args.port,
        reload=args.reload,
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pptx-template-agent")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_inspect = sub.add_parser("inspect", help="dump a template's manifest as JSON")
    p_inspect.add_argument("template")
    p_inspect.set_defaults(func=_cmd_inspect)

    p_fill = sub.add_parser("fill", help="fill a template from a JSON spec (no LLM)")
    p_fill.add_argument("spec", help="path to a DeckSpec JSON file")
    p_fill.add_argument("--template", required=True)
    p_fill.add_argument("--output")
    p_fill.set_defaults(func=_cmd_fill)

    p_gen = sub.add_parser("generate", help="prompt-driven generation via LLM agent loop")
    p_gen.add_argument("prompt")
    p_gen.add_argument("--template", required=True)
    p_gen.add_argument("--output")
    p_gen.add_argument("--model")
    p_gen.set_defaults(func=_cmd_generate)

    p_serve = sub.add_parser("serve", help="run the FastAPI server")
    p_serve.add_argument("--port", type=int, default=config.port)
    p_serve.add_argument("--reload", action="store_true")
    p_serve.set_defaults(func=_cmd_serve)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
