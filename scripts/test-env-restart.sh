#!/usr/bin/env bash
#
# Human-run restart for the Test Environment Layer (reset tier: restart).
# The cht-agent NEVER runs this or any Docker command itself.
# Usage: scripts/test-env-restart.sh [<cht-core-path>]
# COUCHDB_* must be supplied even here: the compose files declare
# ${COUCHDB_PASSWORD:?...}, which compose resolves for every subcommand.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OVERRIDE="$REPO_ROOT/docker/cht-agent-net.override.yml"
# Same resolution as test-env-up.sh, minus the clone: an env we tore up must already exist.
TARGET="${1:-${CHT_CORE_PATH:-${CHT_CORE_CLONE_DIR:-$REPO_ROOT/.cht-core}}}"
if [ ! -d "$TARGET/local-build" ]; then
  echo "error: no cht-core build at $TARGET (pass a path or set CHT_CORE_PATH)" >&2
  exit 1
fi

cd "$TARGET/local-build"
COUCHDB_USER="${COUCHDB_USER:-medic}" COUCHDB_PASSWORD="${COUCHDB_PASSWORD:-password}" docker compose \
  -f cht-couchdb.yml -f cht-core.yml -f "$OVERRIDE" restart

echo "CHT services restarted. The agent should re-confirm health (provision/waitForReady)."
