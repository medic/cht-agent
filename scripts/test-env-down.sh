#!/usr/bin/env bash
#
# Human-run teardown for the Test Environment Layer.
# Usage: scripts/test-env-down.sh <cht-core-path>
# COUCHDB_* must be supplied even here: the compose files declare
# ${COUCHDB_PASSWORD:?...}, which compose resolves for every subcommand.
set -euo pipefail

CHT_CORE_PATH="${1:?Usage: test-env-down.sh <cht-core-path>}"
OVERRIDE="$(cd "$(dirname "$0")/.." && pwd)/docker/cht-agent-net.override.yml"

cd "$CHT_CORE_PATH/local-build"
COUCHDB_USER="${COUCHDB_USER:-medic}" COUCHDB_PASSWORD="${COUCHDB_PASSWORD:-password}" docker compose \
  -f cht-couchdb.yml -f cht-core.yml -f "$OVERRIDE" down -v

echo "CHT environment torn down (-v removed volumes for a clean slate)."
