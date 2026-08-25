#!/usr/bin/env bash
#
# Human-run restart for the Test Environment Layer (reset tier: restart).
# The cht-agent NEVER runs this or any Docker command itself.
# Usage: scripts/test-env-restart.sh <cht-core-path>
# COUCHDB_* must be supplied even here: the compose files declare
# ${COUCHDB_PASSWORD:?...}, which compose resolves for every subcommand.
set -euo pipefail

CHT_CORE_PATH="${1:?Usage: test-env-restart.sh <cht-core-path>}"
OVERRIDE="$(cd "$(dirname "$0")/.." && pwd)/docker/cht-agent-net.override.yml"

cd "$CHT_CORE_PATH/local-build"
COUCHDB_USER="${COUCHDB_USER:-medic}" COUCHDB_PASSWORD="${COUCHDB_PASSWORD:-password}" docker compose \
  -f cht-couchdb.yml -f cht-core.yml -f "$OVERRIDE" restart

echo "CHT services restarted. The agent should re-confirm health (provision/waitForReady)."
