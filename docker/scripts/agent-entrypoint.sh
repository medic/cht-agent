#!/bin/bash
# Entrypoint for the sandboxed cht-agent container (#114).
# Verifies the git/credential sandbox on every start, then hands off to CMD
# (default: sleep infinity, so the operator can `docker exec` the pipeline CLI).
set -euo pipefail

/usr/local/bin/init-agent-git.sh

exec "$@"
