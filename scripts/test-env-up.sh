#!/usr/bin/env bash
#
# Human-run bring-up for the Test Environment Layer (Model A — rebuild on change).
# The cht-agent NEVER runs this or any Docker command itself; the agent's
# provision() only polls /api/v2/monitoring and waits for this to finish.
#
# Usage: scripts/test-env-up.sh <cht-core-path>
#
# Env overrides: COUCHDB_USER (default medic), COUCHDB_PASSWORD (default password).
# These defaults match the agent's DEFAULT_AUTH — the local-build stack would
# otherwise default the admin user to 'admin' and every authed agent call would 401.
# The network name is NOT overridable: docker/cht-agent-net.override.yml hardcodes
# `cht-agent-net` as an external network, so renaming needs an edit there too.
#
# TLS: the stack serves a self-signed cert. The agent's cht-conf child trusts it via
# --accept-self-signed-certs; the agent's OWN fetch (readiness/discovery/reset) needs
# the cert trusted in Node — prefer NODE_EXTRA_CA_CERTS=<pem> on the agent process.
# NODE_TLS_REJECT_UNAUTHORIZED=0 disables verification for ALL of the agent's traffic
# (LLM/MCP included) and is acceptable only inside a disposable runner container.
set -euo pipefail

CHT_CORE_PATH="${1:?Usage: test-env-up.sh <cht-core-path>}"
# Must match the external network in docker/cht-agent-net.override.yml.
NETWORK="cht-agent-net"
OVERRIDE="$(cd "$(dirname "$0")/.." && pwd)/docker/cht-agent-net.override.yml"

# 1. Shared network the cht-agent and CHT both join (idempotent).
docker network create "$NETWORK" 2>/dev/null || true

# 2. Build images from local code.
( cd "$CHT_CORE_PATH" && npm run local-images )

# 3. Start the stack, joined to the shared network via the override.
cd "$CHT_CORE_PATH/local-build"
COUCHDB_USER="${COUCHDB_USER:-medic}" COUCHDB_PASSWORD="${COUCHDB_PASSWORD:-password}" docker compose \
  -f cht-couchdb.yml -f cht-core.yml -f "$OVERRIDE" up -d

echo "CHT starting on network '$NETWORK'. The agent will poll /api/v2/monitoring until healthy."
