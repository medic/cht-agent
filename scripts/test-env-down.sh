#!/usr/bin/env bash
#
# Human-run teardown for the Test Environment Layer.
# Usage: scripts/test-env-down.sh <cht-core-path>
set -euo pipefail

CHT_CORE_PATH="${1:?Usage: test-env-down.sh <cht-core-path>}"
OVERRIDE="$(cd "$(dirname "$0")/.." && pwd)/docker/cht-agent-net.override.yml"

cd "$CHT_CORE_PATH/local-build"
docker compose -f cht-couchdb.yml -f cht-core.yml -f "$OVERRIDE" down -v

echo "CHT environment torn down (-v removed volumes for a clean slate)."
