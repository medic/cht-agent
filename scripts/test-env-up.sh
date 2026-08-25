#!/usr/bin/env bash
#
# Human-run bring-up for the Test Environment Layer (Model A — rebuild on change).
# The cht-agent NEVER runs this or any Docker command itself; the agent's
# provision() only polls /api/v2/monitoring and waits for this to finish. The
# clone/install below is this HUMAN script's convenience — the agent still never
# clones, installs, or runs Docker.
#
# Usage: scripts/test-env-up.sh [<cht-core-path>]
#
# With no argument the stack is built from $CHT_CORE_PATH, or from a managed
# checkout at $CHT_CORE_CLONE_DIR (default <repo>/.cht-core), cloned from master
# on first use. A path you pass is used as-is and is never cloned into.
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

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OVERRIDE="$REPO_ROOT/docker/cht-agent-net.override.yml"
# Must match the external network in docker/cht-agent-net.override.yml.
NETWORK="cht-agent-net"
CLONE_DIR="${CHT_CORE_CLONE_DIR:-$REPO_ROOT/.cht-core}"
CHT_CORE_UPSTREAM="${CHT_CORE_UPSTREAM:-https://github.com/medic/cht-core.git}"
CHT_CORE_BRANCH="${CHT_CORE_BRANCH:-master}"

# cht-core's own engines require Node >= 22.15; npm ci and the image build both
# fail in confusing ways on older runtimes.
NODE_MAJOR="$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')"
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 22 ]; then
  echo "error: cht-core needs Node >= 22.15 (found: $(node -v 2>/dev/null || echo 'no node')). Try 'nvm use 22'." >&2
  exit 1
fi

TARGET="${1:-${CHT_CORE_PATH:-}}"
if [ -z "$TARGET" ]; then
  TARGET="$CLONE_DIR"
  if [ ! -d "$TARGET/.git" ]; then
    echo "No cht-core path given — cloning $CHT_CORE_BRANCH into $TARGET (shallow)."
    echo "Pass a path, or set CHT_CORE_PATH, to build from a working copy instead."
    # Shallow is safe: cht-core derives its image version from the branch name
    # (cht-core's scripts/build/versions.js), not from git tags.
    git clone --depth 1 --branch "$CHT_CORE_BRANCH" "$CHT_CORE_UPSTREAM" "$TARGET"
  fi
fi

if [ ! -d "$TARGET" ]; then
  echo "error: cht-core path not found: $TARGET" >&2
  exit 1
fi

# `npm run local-images` builds from node_modules (bowser, uglifyjs, cleancss);
# without them it dies on an opaque `cp: cannot stat` deep inside the build.
if [ ! -d "$TARGET/node_modules" ]; then
  echo "Installing cht-core dependencies in $TARGET (npm ci — several minutes, ~1.2GB)."
  ( cd "$TARGET" && npm ci )
elif [ ! -e "$TARGET/node_modules/bowser/bundled.js" ] || [ ! -x "$TARGET/node_modules/.bin/uglifyjs" ]; then
  echo "error: cht-core dependencies in $TARGET look incomplete (the image build needs" >&2
  echo "       bowser + uglifyjs). Run 'npm ci' there yourself — this script will not" >&2
  echo "       replace an existing node_modules." >&2
  exit 1
fi

# 1. Shared network the cht-agent and CHT both join (idempotent).
docker network create "$NETWORK" 2>/dev/null || true

# 2. Build the app. `npm run local-images` only PACKAGES an already-built tree:
# build-service-images.sh copies into api/build/static/, which is created by
# build-prepare.sh (ddocs, enketo css, admin app) and filled by build-webapp-dev.
# npm ci alone does not produce it — build-dev also runs the per-module installs.
if [ ! -d "$TARGET/api/build/static" ] || [ "${CHT_CORE_REBUILD:-}" = "1" ]; then
  echo "Building cht-core in $TARGET (npm run build-dev — several minutes)."
  ( cd "$TARGET" && npm run build-dev )
else
  echo "Reusing the existing cht-core build in $TARGET."
  echo "Set CHT_CORE_REBUILD=1 to rebuild after changing cht-core source (Model A is rebuild-on-change)."
fi

# 3. Package those build outputs into local Docker images.
( cd "$TARGET" && npm run local-images )

# 4. Start the stack, joined to the shared network via the override.
cd "$TARGET/local-build"
COUCHDB_USER="${COUCHDB_USER:-medic}" COUCHDB_PASSWORD="${COUCHDB_PASSWORD:-password}" docker compose \
  -f cht-couchdb.yml -f cht-core.yml -f "$OVERRIDE" up -d

echo "CHT starting on network '$NETWORK'. The agent will poll /api/v2/monitoring until healthy."
