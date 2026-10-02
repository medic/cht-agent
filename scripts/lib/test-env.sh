# Shared by scripts/test-env-{up,down,restart}.sh (sourced, not run).
#
# Every cht-core checkout builds in a directory named `local-build`, and Compose
# names a project after its directory, so without -p all checkouts share one project
# and `down -v` on one deletes another's stack. Each checkout therefore gets its own
# project, and with it its own internal network (the couchdb/api/haproxy names),
# CouchDB bind mount, and cert volume. Only nginx joins the shared cht-agent-net.
#
# Env overrides:
#   CHT_TEST_ENV_PROJECT  Compose project (default cht-agent-<dir>-<path hash>)
#   COUCHDB_USER / COUCHDB_PASSWORD  admin (default medic / password, the agent's DEFAULT_AUTH)
#   COUCHDB_DATA          CouchDB bind mount (default local-build/srv-<project>)
#   NGINX_HTTP_PORT / NGINX_HTTPS_PORT  host binds (default 127.0.0.1:80 / 127.0.0.1:443;
#                         set 443 to reach the stack from another device)
#   COMMON_NAME           cert CN (default nginx, the host name the containerized agent uses)

TEST_ENV_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ENV_OVERRIDE="$TEST_ENV_REPO_ROOT/docker/cht-agent-net.override.yml"
# Must match the external network in docker/cht-agent-net.override.yml.
TEST_ENV_NETWORK="cht-agent-net"

test_env_default_target() {
  local path="${1:-}"
  printf '%s\n' "${path:-${CHT_CORE_PATH:-${CHT_CORE_CLONE_DIR:-$TEST_ENV_REPO_ROOT/.cht-core}}}"
}

test_env_hash() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi | cut -c1-8
}

# Sets TEST_ENV_TARGET (physical path) and TEST_ENV_PROJECT for an existing checkout.
test_env_select() {
  local path="$1" base
  TEST_ENV_TARGET="$(cd "$path" && pwd -P)"
  base="$(basename "$TEST_ENV_TARGET" | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9_-]/-/g' -e 's/^-*//')"
  TEST_ENV_PROJECT="${CHT_TEST_ENV_PROJECT:-cht-agent-${base}-$(printf '%s' "$TEST_ENV_TARGET" | test_env_hash)}"
}

test_env_require_build() {
  local path="$1"
  if [[ ! -d "$path/local-build" ]]; then
    echo "error: no cht-core build at $path (pass a path or set CHT_CORE_PATH)" >&2
    exit 1
  fi
}

# COUCHDB_PASSWORD goes to every subcommand: the compose files declare ${COUCHDB_PASSWORD:?...}.
test_env_compose() {
  ( cd "$TEST_ENV_TARGET/local-build" &&
    COUCHDB_USER="${COUCHDB_USER:-medic}" COUCHDB_PASSWORD="${COUCHDB_PASSWORD:-password}" \
    CHT_NETWORK="$TEST_ENV_PROJECT-net" COUCHDB_DATA="${COUCHDB_DATA:-./srv-$TEST_ENV_PROJECT}" \
    NGINX_HTTP_PORT="${NGINX_HTTP_PORT:-127.0.0.1:80}" NGINX_HTTPS_PORT="${NGINX_HTTPS_PORT:-127.0.0.1:443}" \
    COMMON_NAME="${COMMON_NAME:-nginx}" \
    docker compose -p "$TEST_ENV_PROJECT" -f cht-couchdb.yml -f cht-core.yml -f "$TEST_ENV_OVERRIDE" "$@" )
}

# restart and down would otherwise report success against a project with nothing in it.
test_env_require_containers() {
  local containers
  containers="$(test_env_compose ps -a -q)"
  if [[ -z "$containers" ]]; then
    echo "error: Compose project '$TEST_ENV_PROJECT' has no containers." >&2
    echo "       'docker compose ls -a' lists the projects that exist; a stack started under" >&2
    echo "       another name needs CHT_TEST_ENV_PROJECT=<name> (earlier versions of these" >&2
    echo "       scripts left it to Compose, which named every stack 'local-build')." >&2
    exit 1
  fi
}
