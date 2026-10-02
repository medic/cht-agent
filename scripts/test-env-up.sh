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
# Project, credential, port and cert overrides: see scripts/lib/test-env.sh.
#
# TLS: the stack serves a SAN-less self-signed cert whose CN is COMMON_NAME (nginx).
# The agent's cht-conf child accepts it via --accept-self-signed-certs; the agent's
# own fetch (readiness/discovery/reset) needs it trusted via NODE_EXTRA_CA_CERTS
# (copy command printed at the end). NODE_TLS_REJECT_UNAUTHORIZED=0 disables
# verification for ALL of the agent's traffic (LLM/MCP included) and is acceptable
# only inside a disposable runner container.
set -euo pipefail
source "$(dirname "$0")/lib/test-env.sh"

CLONE_DIR="${CHT_CORE_CLONE_DIR:-$TEST_ENV_REPO_ROOT/.cht-core}"
CHT_CORE_UPSTREAM="${CHT_CORE_UPSTREAM:-https://github.com/medic/cht-core.git}"
CHT_CORE_BRANCH="${CHT_CORE_BRANCH:-master}"

# cht-core's own engines require Node >= 22.15; npm ci and the image build both
# fail in confusing ways on older runtimes.
NODE_MAJOR="$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')"
if [[ -z "$NODE_MAJOR" ]] || [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "error: cht-core needs Node >= 22.15 (found: $(node -v 2>/dev/null || echo 'no node')). Try 'nvm use 22'." >&2
  exit 1
fi

TARGET="${1:-${CHT_CORE_PATH:-}}"
if [[ -z "$TARGET" ]]; then
  TARGET="$CLONE_DIR"
  if [[ ! -d "$TARGET/.git" ]]; then
    echo "No cht-core path given — cloning $CHT_CORE_BRANCH into $TARGET (shallow)."
    echo "Pass a path, or set CHT_CORE_PATH, to build from a working copy instead."
    # Shallow is safe: cht-core derives its image version from the branch name
    # (cht-core's scripts/build/versions.js), not from git tags.
    git clone --depth 1 --branch "$CHT_CORE_BRANCH" "$CHT_CORE_UPSTREAM" "$TARGET"
  fi
fi

if [[ ! -d "$TARGET" ]]; then
  echo "error: cht-core path not found: $TARGET" >&2
  exit 1
fi
test_env_select "$TARGET"

# 1. Shared network the cht-agent and CHT both join.
docker network inspect "$TEST_ENV_NETWORK" >/dev/null 2>&1 || docker network create "$TEST_ENV_NETWORK" >/dev/null

# The agent reaches CHT as https://nginx on that network; a second stack's nginx
# there would split the name between two instances.
nginx_projects="$(docker ps --filter "network=$TEST_ENV_NETWORK" --filter label=com.docker.compose.service=nginx \
  --format '{{.Label "com.docker.compose.project"}}')"
while IFS= read -r project; do
  if [[ -n "$project" && "$project" != "$TEST_ENV_PROJECT" ]]; then
    echo "error: Compose project '$project' already has an nginx on $TEST_ENV_NETWORK." >&2
    echo "       Tear it down first: CHT_TEST_ENV_PROJECT='$project' scripts/test-env-down.sh <its cht-core path>" >&2
    exit 1
  fi
done <<< "$nginx_projects"

# `npm run local-images` builds from node_modules (bowser, uglifyjs, cleancss);
# without them it dies on an opaque `cp: cannot stat` deep inside the build.
if [[ ! -d "$TARGET/node_modules" ]]; then
  echo "Installing cht-core dependencies in $TARGET (npm ci — several minutes, ~1.2GB)."
  # Lifecycle scripts must run: cht-core's postinstall is patch-package, and skipping
  # it leaves the patches unapplied and the build broken. This is why --ignore-scripts
  # is not used here. The code being installed is the same tree we are about to build
  # images from and run, so npm scripts add no privilege beyond what follows.
  ( cd "$TARGET" && npm ci )
elif [[ ! -e "$TARGET/node_modules/bowser/bundled.js" ]] || [[ ! -x "$TARGET/node_modules/.bin/uglifyjs" ]]; then
  echo "error: cht-core dependencies in $TARGET look incomplete (the image build needs" >&2
  echo "       bowser + uglifyjs). Run 'npm ci' there yourself — this script will not" >&2
  echo "       replace an existing node_modules." >&2
  exit 1
fi

# 2. Build the app. `npm run local-images` only PACKAGES an already-built tree:
# build-service-images.sh copies into api/build/static/, which is created by
# build-prepare.sh (ddocs, enketo css, admin app) and filled by build-webapp-dev.
# npm ci alone does not produce it — build-dev also runs the per-module installs.
if [[ ! -d "$TARGET/api/build/static" ]] || [[ "${CHT_CORE_REBUILD:-}" = "1" ]]; then
  echo "Building cht-core in $TARGET (npm run build-dev — several minutes)."
  ( cd "$TARGET" && npm run build-dev )
else
  echo "Reusing the existing cht-core build in $TARGET."
  echo "Set CHT_CORE_REBUILD=1 to rebuild after changing cht-core source (Model A is rebuild-on-change)."
fi

# 3. Package those build outputs into local Docker images.
( cd "$TARGET" && npm run local-images )

# 4. Start the stack, joined to the shared network via the override.
test_env_compose up -d

echo "CHT starting as Compose project '$TEST_ENV_PROJECT' on '$TEST_ENV_NETWORK'. The agent will poll /api/v2/monitoring until healthy."
echo "To trust its cert: docker cp $TEST_ENV_PROJECT-nginx-1:/etc/nginx/private/cert.pem <file>, then NODE_EXTRA_CA_CERTS=<file> for the agent."
