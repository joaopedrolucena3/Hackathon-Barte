#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
if ! .venv/bin/python -c 'import openpyxl' >/dev/null 2>&1; then
  .venv/bin/python -m pip install -r requirements.txt
fi

# Compiles ../front into ../front/dist when the build is missing or older than the sources.
build_front() {
  front=../front
  if [ -f "$front/dist/index.html" ] && [ -z "$(find "$front/src" "$front/index.html" "$front/package.json" "$front/vite.config.ts" -newer "$front/dist/index.html" 2>/dev/null | head -n 1)" ]; then
    return 0
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "Node.js 18+ e npm são necessários para compilar a interface em front/." >&2
    exit 1
  fi
  if [ ! -d "$front/node_modules" ]; then
    (cd "$front" && npm install --no-audit --no-fund)
  fi
  (cd "$front" && npm run build)
}

case "${1:-serve}" in
  test) exec .venv/bin/python -m unittest discover -s tests -v ;;
  export) exec .venv/bin/python -m src.app --export ;;
  front) build_front ;;
  serve) build_front; if [ "$#" -gt 0 ]; then shift; fi; exec .venv/bin/python -m src.app "$@" ;;
  *) build_front; exec .venv/bin/python -m src.app "$@" ;;
esac
