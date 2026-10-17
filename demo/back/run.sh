#!/bin/sh
set -eu
cd "$(dirname "$0")"

require_python_313() {
  if ! tarvo_version=$("$1" -c 'import sys; print("%s.%s" % sys.version_info[:2])' 2>/dev/null); then
    echo "Não foi possível executar o Python em $1." >&2
    return 1
  fi
  if [ "$tarvo_version" != "3.13" ]; then
    echo "Python $tarvo_version incompatível em $1. Este projeto requer Python 3.13; Python 3.14 não é suportado pelas dependências fixadas." >&2
    return 1
  fi
}

# TARVO_PYTHON selects the interpreter when creating the environment.
# Existing environments are validated and are never replaced automatically.
if [ -e .venv ] || [ -L .venv ]; then
  if [ ! -x .venv/bin/python ]; then
    echo "O ambiente .venv existe, mas não contém um Python executável. Ele foi preservado; renomeie-o antes de criar outro com Python 3.13." >&2
    exit 1
  fi
  if ! require_python_313 .venv/bin/python; then
    echo "O ambiente .venv foi preservado. Renomeie-o antes de executar novamente com Python 3.13." >&2
    exit 1
  fi
else
  tarvo_python=${TARVO_PYTHON:-python3.13}
  if ! command -v "$tarvo_python" >/dev/null 2>&1; then
    echo "Python 3.13 não encontrado ($tarvo_python). Instale Python 3.13 ou informe TARVO_PYTHON=/caminho/para/python3.13." >&2
    exit 1
  fi
  require_python_313 "$tarvo_python"
  "$tarvo_python" -m venv .venv
  require_python_313 .venv/bin/python
fi
if ! .venv/bin/python -c 'import openpyxl, fastapi, uvicorn, multipart, pyarrow, jsonschema, httpx, duckdb, anthropic'>/dev/null 2>&1; then
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
  delivery) shift; exec .venv/bin/python -m src.delivery "$@" ;;
  export) exec .venv/bin/python -m src.app --export ;;
  front) build_front ;;
  serve) build_front; if [ "$#" -gt 0 ]; then shift; fi; exec .venv/bin/python -m src.app "$@" ;;
  *) build_front; exec .venv/bin/python -m src.app "$@" ;;
esac
