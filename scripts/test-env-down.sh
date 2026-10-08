#!/usr/bin/env bash
#
# Human-run teardown for the Test Environment Layer.
# The cht-agent NEVER runs this or any Docker command itself.
# Usage: scripts/test-env-down.sh [<cht-core-path>]   (overrides: scripts/lib/test-env.sh)
set -euo pipefail
source "$(dirname "$0")/lib/test-env.sh"

# Same resolution as test-env-up.sh, minus the clone: the stack must already exist.
TARGET="$(test_env_default_target "${1:-}")"
test_env_require_build "$TARGET"
test_env_select "$TARGET"
test_env_require_containers
test_env_compose down -v

echo "CHT environment '$TEST_ENV_PROJECT' torn down. -v removed its named volumes; CouchDB data in the" \
  "${COUCHDB_DATA:-$TEST_ENV_TARGET/local-build/srv-$TEST_ENV_PROJECT} bind mount stays."
