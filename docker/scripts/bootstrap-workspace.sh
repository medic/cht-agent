#!/bin/bash
# Host-side workspace bootstrap for the dockerized cht-agent (#114, #66 follow-up).
#
# Run by the OPERATOR before `docker compose up` — never inside the container.
# Cloning cannot happen in the container: compose shadow-mounts the hardened
# git config over <working copy>/.git/config read-only, which requires a .git
# directory to exist at the mount target before the container starts.
#
#   docker/scripts/bootstrap-workspace.sh [path-to-cht-core]
#
# Idempotent: clones cht-core if absent, fast-forwards main if present,
# ensures cht-agent-net exists, then prints the compose command to run.

set -euo pipefail

CHT_CORE_PATH="${1:-${CHT_CORE_PATH:-$HOME/src/cht-core}}"
CHT_CORE_REPO="https://github.com/medic/cht-core.git"
NETWORK="cht-agent-net"
COMPOSE_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/docker-compose.cht-agent.yml"

echo "[bootstrap] cht-core working copy: $CHT_CORE_PATH"

# 1. Provide the working copy (public repo, read-only use — the agent
# local-branches off main; only the operator ever pushes).
if [ ! -e "$CHT_CORE_PATH" ]; then
  echo "[bootstrap] Cloning cht-core (this is large; first run takes a while)..."
  git clone "$CHT_CORE_REPO" "$CHT_CORE_PATH"
elif [ -f "$CHT_CORE_PATH/.git" ]; then
  # A worktree's .git is a FILE — the read-only config shadow mount needs a directory.
  echo "[bootstrap] ERROR: $CHT_CORE_PATH is a git worktree (.git is a file)." >&2
  echo "[bootstrap] Use a full clone — the hardened .git/config mount requires a .git directory." >&2
  exit 1
elif [ ! -d "$CHT_CORE_PATH/.git" ]; then
  echo "[bootstrap] ERROR: $CHT_CORE_PATH exists but is not a git repository." >&2
  exit 1
fi

# 2. Fresh main as the base the agent branches from. ff-only: never rewrite
# or merge over local work — if main has local commits, stop and let the
# operator decide.
echo "[bootstrap] Updating main (ff-only)..."
git -C "$CHT_CORE_PATH" checkout main
git -C "$CHT_CORE_PATH" pull --ff-only

# 3. Shared network the agent and the CHT stack both join.
if docker network inspect "$NETWORK" > /dev/null 2>&1; then
  echo "[bootstrap] Docker network $NETWORK already exists."
else
  docker network create "$NETWORK"
  echo "[bootstrap] Created Docker network $NETWORK."
fi

echo
echo "[bootstrap] Workspace ready. Start the agent with:"
echo
echo "  CHT_CORE_PATH=$CHT_CORE_PATH \\"
echo "    docker compose -f $COMPOSE_FILE up -d --build"
