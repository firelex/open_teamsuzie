#!/usr/bin/env bash
# Kill any process currently listening on $PORT (or the first arg) and its
# process tree. Used by agent-runtime build dev scripts to avoid the stale-
# tsx-watch problem where a prior process from another session still owns
# the port — silently serving stale code with stale session state.
#
# Lifted from suzie_pe_shared/scripts/dev-all.sh.

set -euo pipefail

port="${1:-${PORT:-3001}}"

_kill_tree() {
  local pid="$1"
  local children
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for child in $children; do _kill_tree "$child"; done
  kill -TERM "$pid" 2>/dev/null || true
  # give it a moment then SIGKILL if still alive
  for _ in 1 2 3 4 5; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  kill -KILL "$pid" 2>/dev/null || true
}

owner=$(lsof -ti ":$port" -sTCP:LISTEN 2>/dev/null | head -1 || true)
if [ -z "$owner" ]; then
  exit 0
fi

# Walk up to the topmost non-shell ancestor and kill that whole tree.
# This catches the wrapping pnpm/tsx parent, not just the leaf node.
root="$owner"
while true; do
  parent=$(ps -o ppid= -p "$root" 2>/dev/null | tr -d ' ')
  if [ -z "$parent" ] || [ "$parent" = "1" ] || [ "$parent" = "0" ]; then
    break
  fi
  parent_comm=$(ps -o comm= -p "$parent" 2>/dev/null | tr -d ' ')
  case "$parent_comm" in
    bash|zsh|sh|fish|tmux*|screen*|login|launchd) break ;;
  esac
  root="$parent"
done

echo "[agent-runtime] killing stale listener on port $port (pid $owner, tree root $root)" >&2
_kill_tree "$root"
sleep 0.3
