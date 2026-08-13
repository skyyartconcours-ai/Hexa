#!/usr/bin/env bash
#
# Start the (optional) Hexa vision sidecar.
#
#   ./run.sh                 # create venv if needed, install, serve on :8765
#   HEXA_VISION_PORT=9000 ./run.sh
#   HEXA_VISION_RELOAD=1 ./run.sh
#   ./run.sh --reinstall     # force a dependency reinstall
#
# Hexa works without this process running; @hexa/vision falls back to pure-TS
# heuristics and disables identity verification. See README.md.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

VENV="${HEXA_VISION_VENV:-$HERE/.venv}"
PORT="${HEXA_VISION_PORT:-8765}"
HOST="${HEXA_VISION_HOST:-127.0.0.1}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
STAMP="$VENV/.hexa-requirements.sha"

REINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --reinstall) REINSTALL=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "error: $PYTHON_BIN not found. Install Python 3.9+ or set PYTHON_BIN." >&2
  exit 1
fi

if [ ! -d "$VENV" ]; then
  echo "==> creating venv at $VENV"
  "$PYTHON_BIN" -m venv "$VENV"
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"

hash_requirements() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum requirements.txt | awk '{print $1}'
  else
    shasum -a 256 requirements.txt | awk '{print $1}'
  fi
}

WANT="$(hash_requirements)"
HAVE="$(cat "$STAMP" 2>/dev/null || echo none)"

if [ "$REINSTALL" = "1" ] || [ "$WANT" != "$HAVE" ]; then
  echo "==> installing requirements (this pulls ~500MB the first time)"
  python -m pip install --upgrade pip wheel >/dev/null
  python -m pip install -r requirements.txt
  echo "$WANT" > "$STAMP"
else
  echo "==> dependencies up to date"
fi

RELOAD_FLAG=()
if [ "${HEXA_VISION_RELOAD:-0}" = "1" ]; then
  RELOAD_FLAG=(--reload)
fi

echo "==> hexa vision sidecar on http://$HOST:$PORT (health: /health, docs: /docs)"
echo "    models load lazily on first real request; expect a slow first /embed"
exec python -m uvicorn app:app --host "$HOST" --port "$PORT" "${RELOAD_FLAG[@]}"
