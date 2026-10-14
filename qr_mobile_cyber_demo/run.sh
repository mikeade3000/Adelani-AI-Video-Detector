#!/usr/bin/env bash
# Convenience launcher for macOS / Linux.
set -euo pipefail
cd "$(dirname "$0")"
PY="$(command -v python3 || command -v python)"
if [ -z "$PY" ]; then
  echo "Python 3.9+ is required but was not found on PATH." >&2
  exit 1
fi
exec "$PY" server.py "$@"
