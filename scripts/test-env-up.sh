#!/usr/bin/env bash
#
# Human-run bring-up for the Test Environment Layer (Model A — rebuild on change).
# The cht-agent NEVER runs this or any Docker command itself; the agent's
# provision() only polls /api/v2/monitoring and waits for this to finish.
#
# Usage: scripts/test-env-up.sh <cht-core-path>
#
# Env overrides: CHT_AGENT_NET (default cht-agent-net), COUCHDB_PASSWORD (default password)
set -euo pipefail

CHT_CORE_PATH="${1:?Usage: test-env-up.sh <cht-core-path>}"
NETWORK="${CHT_AGENT_NET:-cht-agent-net}"
OVERRIDE="$(cd "$(dirname "$0")/.." && pwd)/docker/cht-agent-net.override.yml"

# 1. Shared network the cht-agent and CHT both join (idempotent).
docker network create "$NETWORK" 2>/dev/null || true

# 2. Build images from local code.
( cd "$CHT_CORE_PATH" && npm run local-images )

# 3. Start the stack, joined to the shared network via the override.
cd "$CHT_CORE_PATH/local-build"
COUCHDB_PASSWORD="${COUCHDB_PASSWORD:-password}" docker compose \
  -f cht-couchdb.yml -f cht-core.yml -f "$OVERRIDE" up -d

echo "CHT starting on network '$NETWORK'. The agent will poll /api/v2/monitoring until healthy."
