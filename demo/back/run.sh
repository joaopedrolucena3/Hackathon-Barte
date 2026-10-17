#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
if ! .venv/bin/python -c 'import openpyxl, fastapi, uvicorn, multipart, pyarrow, jsonschema, httpx' >/dev/null 2>&1; then
  .venv/bin/python -m pip install -r requirements.lock.txt
fi

build_front() {
  tarvo_front=../front
  if [ -f "$tarvo_front/dist/index.html" ] && [ -f "$tarvo_front/dist/.http-build" ] && [ -z "$(find "$tarvo_front/src" "$tarvo_front/index.html" "$tarvo_front/package.json" "$tarvo_front/package-lock.json" "$tarvo_front/vite.config.ts" "$tarvo_front/tsconfig.json" -newer "$tarvo_front/dist/index.html" -print -quit)" ]; then
    return 0
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "Node.js 18+ e npm são necessários para compilar a interface em front/." >&2
    exit 1
  fi
  if [ ! -f "$tarvo_front/node_modules/.package-lock.json" ] || [ "$tarvo_front/package-lock.json" -nt "$tarvo_front/node_modules/.package-lock.json" ]; then
    (cd "$tarvo_front" && npm ci --no-audit --no-fund)
  fi
  (cd "$tarvo_front" && VITE_AGENT_API=http npm run build && touch dist/.http-build)
}

case "${1:-serve}" in
  test) exec .venv/bin/python -m unittest discover -s tests -v ;;
  export) exec .venv/bin/python -m src.app --export ;;
  front) build_front ;;
  serve) build_front; if [ "$#" -gt 0 ]; then shift; fi; exec .venv/bin/python -m src.app "$@" ;;
  *) build_front; exec .venv/bin/python -m src.app "$@" ;;
esac
