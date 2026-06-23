#!/bin/bash
# Initializes and verifies the cht-agent git/credential sandbox (#114).
# Runs on every container start via agent-entrypoint.sh.
#
# Model: remote READ is allowed (cht-core and cht-agent are public repos);
# remote WRITE is impossible — only the host user pushes. Adapted from the
# cht-core PoC .devcontainer, which blocked remotes entirely; here fetch/clone
# stay open and only push is blocked.
#
#   1. Exports a dummy git identity via environment (no config writes needed)
#   2. Installs a pre-push hook in the cht-core working copy (if mounted)
#   3. Verifies every sandbox layer; exits non-zero if a critical layer is down
#
# The independent layers (any one is sufficient; all should be active):
#   L1  no write credentials, no Docker socket (image + compose)
#   L2  system git pushInsteadOf -> error://, push.default=nothing (image)
#   L3  nothing to authenticate a push with (no tokens/keys in env or fs)
#   L4  pre-push hook + dummy identity (this script)
#   L5  agent instructions (~/.claude/CLAUDE.md + settings.json deny rules)

set -uo pipefail

CHT_CORE_PATH="${CHT_CORE_PATH:-/workspace/cht-core}"
FAILURES=0

ok()   { echo "  [OK]   $1"; }
warn() { echo "  [WARN] $1"; }
fail() { echo "  [FAIL] $1"; FAILURES=$((FAILURES + 1)); }

echo "[cht-agent] Initializing git/credential sandbox..."

# 1. Dummy identity via environment — overrides any config without write
# access, and persists for `docker exec` sessions through bashrc.
export GIT_AUTHOR_NAME="CHT Agent"
export GIT_AUTHOR_EMAIL="agent@cht-agent.local"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

if ! grep -q "GIT_AUTHOR_NAME" /home/agent/.bashrc 2>/dev/null; then
  cat >> /home/agent/.bashrc << 'EOF'
export GIT_AUTHOR_NAME="CHT Agent"
export GIT_AUTHOR_EMAIL="agent@cht-agent.local"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
EOF
fi

# 2. Pre-push hook in the working copy (defense in depth — push is already
# blocked at the system git config and there is nothing to authenticate with).
if git -C "$CHT_CORE_PATH" rev-parse --git-dir > /dev/null 2>&1; then
  HOOKS_DIR="$(git -C "$CHT_CORE_PATH" rev-parse --absolute-git-dir)/hooks"
  mkdir -p "$HOOKS_DIR"
  cat > "$HOOKS_DIR/pre-push" << 'HOOK'
#!/bin/bash
echo "========================================"
echo "  BLOCKED: the cht-agent cannot push."
echo "  All work stays on local branches."
echo "  The host user reviews and pushes."
echo "========================================"
exit 1
HOOK
  chmod +x "$HOOKS_DIR/pre-push"
else
  # Cloning in here is impossible by design: the hardened .git/config shadow
  # mount requires the .git directory to exist before the container starts.
  warn "cht-core working copy not found at $CHT_CORE_PATH — run docker/scripts/bootstrap-workspace.sh on the HOST, then restart"
fi

echo "[cht-agent] Sandbox verification:"

# L2: system-level push block
if [ "$(git config --system url.error://push-blocked-by-policy.pushInsteadOf 2>/dev/null | head -1)" != "" ]; then
  ok "system pushInsteadOf rewrites GitHub push URLs to error://"
else
  fail "system pushInsteadOf block is missing"
fi
if [ "$(git config --system push.default 2>/dev/null)" = "nothing" ]; then
  ok "push.default=nothing"
else
  fail "push.default is not 'nothing'"
fi

# L1/L3: no way to authenticate a write
if command -v ssh > /dev/null 2>&1; then
  fail "ssh binary present"
else
  ok "no ssh binary"
fi
if ls /home/agent/.ssh/id_* > /dev/null 2>&1; then
  fail "SSH keys found in /home/agent/.ssh"
else
  ok "no SSH keys"
fi
# Exception: the seeding pipeline container (docker-compose.seeder.yml) carries
# a READ-ONLY GH_TOKEN (classic PAT, read:org scope only — cannot write to any
# repo) for gh-based scraping. It must declare that explicitly; any other token
# still fails.
for tok in GH_TOKEN GITHUB_TOKEN GIT_TOKEN GITLAB_TOKEN; do
  if [ -n "${!tok:-}" ]; then
    if [ "$tok" = "GH_TOKEN" ] && [ "${CHT_AGENT_ALLOW_READONLY_GH_TOKEN:-}" = "1" ]; then
      warn "GH_TOKEN present (declared read-only via CHT_AGENT_ALLOW_READONLY_GH_TOKEN — must be a read:org-only classic PAT)"
    else
      fail "$tok is set in the environment"
    fi
  fi
done
ok "git write-token check done (GH_TOKEN, GITHUB_TOKEN, ...)"
if [ "$(git config --system credential.helper 2>/dev/null)" = "" ]; then
  ok "no credential helper"
else
  fail "a credential helper is configured"
fi

# L1: no Docker access (the agent never runs Docker; bring-up is human-gated)
if [ -S /var/run/docker.sock ]; then
  fail "Docker socket is mounted — this grants host-root; remove it"
else
  ok "no Docker socket"
fi
if command -v docker > /dev/null 2>&1; then
  fail "docker binary present"
else
  ok "no docker binary"
fi

# Working-copy hardening (compose shadows .git/config read-only)
if [ -e "$CHT_CORE_PATH/.git/config" ]; then
  if [ -w "$CHT_CORE_PATH/.git/config" ]; then
    warn ".git/config is writable — mount the hardened config read-only (see compose)"
  else
    ok "working copy .git/config is read-only"
  fi
fi

# Read path stays open: cht-conf present for the Test Environment Layer
if command -v cht > /dev/null 2>&1; then
  ok "cht-conf available ($(cht --version 2>/dev/null | head -1))"
else
  fail "cht-conf (cht binary) not found"
fi

echo "  identity = $GIT_AUTHOR_NAME <$GIT_AUTHOR_EMAIL>"

if [ "$FAILURES" -gt 0 ]; then
  echo "[cht-agent] Sandbox verification FAILED ($FAILURES check(s)). Refusing to start."
  exit 1
fi
echo "[cht-agent] Sandbox verified. Remote read OK, push impossible, no Docker."
