# shellcheck shell=bash
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
#                         set 443 to reach the stack from another device, and then also set
#                         COUCHDB_PASSWORD: the default admin is medic / password)
#   COMMON_NAME           cert CN (default nginx, the host name the containerized agent uses)

TEST_ENV_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ENV_OVERRIDE="$TEST_ENV_REPO_ROOT/docker/cht-agent-net.override.yml"
# Must match the external network in docker/cht-agent-net.override.yml.
TEST_ENV_NETWORK="cht-agent-net"

test_env_default_target() {
  local path="${1:-}"
  printf '%s\n' "${path:-${CHT_CORE_PATH:-${CHT_CORE_CLONE_DIR:-$TEST_ENV_REPO_ROOT/.cht-core}}}"
  return $?
}

test_env_hash() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi | cut -c1-8
  return $?
}

# Sets TEST_ENV_TARGET (physical path) and TEST_ENV_PROJECT for an existing checkout.
test_env_select() {
  local path="$1" base
  TEST_ENV_TARGET="$(cd "$path" && pwd -P)"
  base="$(basename "$TEST_ENV_TARGET" | LC_ALL=C tr '[:upper:]' '[:lower:]' | LC_ALL=C sed -e 's/[^a-z0-9_-]/-/g' -e 's/^-*//')"
  TEST_ENV_PROJECT="${CHT_TEST_ENV_PROJECT:-cht-agent-${base}-$(printf '%s' "$TEST_ENV_TARGET" | test_env_hash)}"
  return $?
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
  return $?
}

# Refuse a project that another checkout started. With a shared CHT_TEST_ENV_PROJECT,
# up would recreate that checkout's containers, and down -v would delete them and its volumes.
test_env_require_owner() {
  local dirs dir
  dirs="$(docker ps -a --filter "label=com.docker.compose.project=$TEST_ENV_PROJECT" \
    --format '{{.Label "com.docker.compose.project.working_dir"}}' | sort -u)"
  while IFS= read -r dir; do
    if [[ -n "$dir" && "$dir" != "$TEST_ENV_TARGET/local-build" ]]; then
      echo "error: Compose project '$TEST_ENV_PROJECT' has containers from $dir, which is not $TEST_ENV_TARGET/local-build." >&2
      exit 1
    fi
  done <<< "$dirs"
  return 0
}

# restart and down would otherwise report success against a project with nothing in it.
test_env_require_containers() {
  local containers
  containers="$(test_env_compose ps -a -q)"
  if [[ -z "$containers" ]]; then
    echo "error: Compose project '$TEST_ENV_PROJECT' has no containers." >&2
    echo "       'docker compose ls -a' lists the projects that exist; a stack this checkout" >&2
    echo "       started under another name needs CHT_TEST_ENV_PROJECT=<name>." >&2
    exit 1
  fi
  test_env_require_owner
  return 0
}
