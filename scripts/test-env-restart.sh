#!/usr/bin/env bash
#
# Human-run restart for the Test Environment Layer (reset tier: restart).
# The cht-agent NEVER runs this or any Docker command itself.
# Usage: scripts/test-env-restart.sh [<cht-core-path>]   (overrides: scripts/lib/test-env.sh)
set -euo pipefail
source "$(dirname "$0")/lib/test-env.sh"

# Same resolution as test-env-up.sh, minus the clone: the stack must already exist.
TARGET="$(test_env_default_target "${1:-}")"
test_env_require_build "$TARGET"
test_env_select "$TARGET"
test_env_require_containers
test_env_compose restart

echo "CHT services in '$TEST_ENV_PROJECT' restarted. The agent should re-confirm health (provision/waitForReady)."
