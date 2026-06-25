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

ok()   { local msg="$1"; echo "  [OK]   $msg"; return 0; }
warn() { local msg="$1"; echo "  [WARN] $msg"; return 0; }
fail() { local msg="$1"; echo "  [FAIL] $msg"; FAILURES=$((FAILURES + 1)); return 0; }

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
  mkdir -p "$HOOKS_DIR" 2>/dev/null || true
  cat > "$HOOKS_DIR/pre-push" 2>/dev/null << 'HOOK'
#!/bin/bash
echo "========================================"
echo "  BLOCKED: the cht-agent cannot push."
echo "  All work stays on local branches."
echo "  The host user reviews and pushes."
echo "========================================"
exit 1
HOOK
  # set -e is intentionally off; if .git/hooks is owned by another uid the
  # write fails silently, so verify and warn rather than assume L4 is up.
  if [[ -f "$HOOKS_DIR/pre-push" ]] && chmod +x "$HOOKS_DIR/pre-push" 2>/dev/null; then
    ok "pre-push hook installed in working copy"
  else
    warn "could not install pre-push hook (working copy .git owned by another uid?) — L4 degraded; push still blocked by L2/L3"
  fi
else
  # Cloning in here is impossible by design: the hardened .git/config shadow
  # mount requires the .git directory to exist before the container starts.
  warn "cht-core working copy not found at $CHT_CORE_PATH — run docker/scripts/bootstrap-workspace.sh on the HOST, then restart"
fi

echo "[cht-agent] Sandbox verification:"

# L2: system-level push block. Check each scheme explicitly — pushInsteadOf is
# multi-valued, so a "some value exists" check would miss a clobbered https
# rewrite (which is the scheme the agent's clones actually use).
SYS_REWRITES="$(git config --system --get-all url.error://push-blocked-by-policy.pushInsteadOf 2>/dev/null)"
for scheme in "https://github.com/" "git@github.com:" "ssh://git@github.com/"; do
  if printf '%s\n' "$SYS_REWRITES" | grep -qxF "$scheme"; then
    ok "system pushInsteadOf rewrites $scheme push URLs to error://"
  else
    fail "system pushInsteadOf is missing the $scheme rewrite"
  fi
done
if [[ "$(git config --system push.default 2>/dev/null)" == "nothing" ]]; then
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
TOKENS_FOUND=0
for tok in GH_TOKEN GITHUB_TOKEN GITHUB_ACCESS_TOKEN GH_ENTERPRISE_TOKEN \
           GIT_TOKEN GITLAB_TOKEN CR_PAT GIT_ASKPASS GIT_USERNAME GIT_PASSWORD; do
  if [[ -n "${!tok:-}" ]]; then
    fail "$tok is set in the environment"
    TOKENS_FOUND=1
  fi
done
for credfile in "$HOME/.netrc" "$HOME/.git-credentials"; do
  if [[ -e "$credfile" ]]; then
    fail "credential file present: $credfile"
    TOKENS_FOUND=1
  fi
done
[[ "$TOKENS_FOUND" -eq 0 ]] && ok "no git write tokens or credential files (env + ~/.netrc + ~/.git-credentials)"
if [[ -z "$(git config --system credential.helper 2>/dev/null)" ]]; then
  ok "no credential helper"
else
  fail "a credential helper is configured"
fi

# L1: no Docker access (the agent never runs Docker; bring-up is human-gated)
if [[ -S /var/run/docker.sock ]]; then
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
if [[ -e "$CHT_CORE_PATH/.git/config" ]]; then
  if [[ -w "$CHT_CORE_PATH/.git/config" ]]; then
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

if [[ "$FAILURES" -gt 0 ]]; then
  echo "[cht-agent] Sandbox verification FAILED ($FAILURES check(s)). Refusing to start."
  exit 1
fi
echo "[cht-agent] Sandbox verified. Remote read OK, push impossible, no Docker."
