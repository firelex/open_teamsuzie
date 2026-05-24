"""Command-line entry points.

Usage:
  docx-template-agent inspect <template.docx>
  docx-template-agent fill <spec.json> --template <template.docx> [--output <path>]
  docx-template-agent serve [--port 8082]
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from .config import config
from .injection import fill_doc, inspect_template
from .models import DocSpec


def _cmd_inspect(args: argparse.Namespace) -> int:
    manifest = inspect_template(args.template)
    json.dump(manifest, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")
    return 0


def _cmd_fill(args: argparse.Namespace) -> int:
    raw = json.loads(Path(args.spec).read_text())
    if args.template:
        raw["template"] = args.template
    spec = DocSpec.model_validate(raw)
    out = Path(args.output) if args.output else config.output_dir / f"{spec.doc_name}.docx"
    path, report = fill_doc(spec, out)
    print(f"Wrote {path}")
    print(f"  replacements: {report.replacements}")
    print(f"  paragraphs touched: {report.paragraphs_touched}")
    if report.unfilled_tokens:
        print(f"  unfilled tokens: {report.unfilled_tokens}")
    return 0


def _cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    uvicorn.run(
        "docx_template_agent.server:app",
        host="0.0.0.0",
        port=args.port,
        reload=args.reload,
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="docx-template-agent")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_inspect = sub.add_parser("inspect", help="dump a template's manifest as JSON")
    p_inspect.add_argument("template")
    p_inspect.set_defaults(func=_cmd_inspect)

    p_fill = sub.add_parser("fill", help="fill a template from a JSON spec (no LLM)")
    p_fill.add_argument("spec", help="path to a DocSpec JSON file")
    p_fill.add_argument("--template", required=True)
    p_fill.add_argument("--output")
    p_fill.set_defaults(func=_cmd_fill)

    p_serve = sub.add_parser("serve", help="run the FastAPI server")
    p_serve.add_argument("--port", type=int, default=config.port)
    p_serve.add_argument("--reload", action="store_true")
    p_serve.set_defaults(func=_cmd_serve)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
