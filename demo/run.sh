#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
if ! .venv/bin/python -c 'import openpyxl' >/dev/null 2>&1; then
  .venv/bin/python -m pip install -r requirements.txt
fi
case "${1:-serve}" in
  test) exec .venv/bin/python -m unittest discover -s tests -v ;;
  export) exec .venv/bin/python -m src.app --export ;;
  serve) if [ "$#" -gt 0 ]; then shift; fi; exec .venv/bin/python -m src.app "$@" ;;
  *) exec .venv/bin/python -m src.app "$@" ;;
esac
