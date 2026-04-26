#!/usr/bin/env bash
# Start markitdown-agent for local dev.
#
# Creates and populates a Python venv on first run. On subsequent runs, just
# activates and serves. Idempotent — safe to call any number of times.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR=".venv"
PORT="${MARKITDOWN_AGENT_PORT:-3013}"
HOST="${MARKITDOWN_AGENT_HOST:-0.0.0.0}"

log() { echo "[markitdown-agent] $*"; }

if ! command -v python3 >/dev/null 2>&1; then
  log "error: python3 not on PATH" >&2
  exit 1
fi

if [ ! -d "$VENV_DIR" ]; then
  log "creating venv at $SCRIPT_DIR/$VENV_DIR"
  python3 -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

# Compare requirements mtime against the marker so we only re-install when
# requirements.txt actually changed. Saves ~5s on every run.
MARKER="$VENV_DIR/.requirements.installed"
if [ ! -f "$MARKER" ] || [ "requirements.txt" -nt "$MARKER" ]; then
  log "installing/updating dependencies"
  python -m pip install --quiet --upgrade pip
  python -m pip install --quiet -r requirements.txt
  touch "$MARKER"
fi

log "starting on http://$HOST:$PORT"
exec python -m uvicorn app.main:app --host "$HOST" --port "$PORT" --reload
