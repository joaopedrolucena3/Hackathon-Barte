#!/bin/sh
set -eu
tarvo_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$tarvo_root/demo/back/run.sh" delivery "$@"
