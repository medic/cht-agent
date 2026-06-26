# cht-agent sandboxed image (#114)
#
# Bakes in the tools the agent drives (cht-conf today; code-generation tools
# later) and hardens git so autonomous loops can READ public remotes but never
# push. The container has no Docker access — CHT environment bring-up is
# human-gated on the host (see docs/docker-agent-runbook.md and
# designs/layer_recommendations/test-environment-layer.md).

# Pinned to the major+distro tag, not a digest: this is a locally-rebuilt dev
# sandbox (image: cht-agent:local), so we want OS security patches on each
# rebuild. Pin to a @sha256 digest if you need byte-reproducible builds.
FROM node:22-bookworm

# Root-level setup in one layer: tools the agent drives, the system-level git
# push block, and removal of all ssh client config.
# - openssh-client is purged so git ssh:// URLs fail closed (reads use HTTPS);
#   the trailing `! command -v ssh` fails the build closed if ssh survived.
# - pushInsteadOf rewrites only PUSH urls, so fetch/clone of public repos stays
#   allowed; system config needs root, which the agent user lacks. --add is
#   required (pushInsteadOf is multi-valued; a plain set drops the https value).
# (Adapted from the cht-core PoC .devcontainer: "no remote at all" became
# "remote read OK, push blocked".)
RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl bash jq build-essential python3 ca-certificates \
    && { apt-get purge -y openssh-client 2>/dev/null || true; } \
    && rm -rf /var/lib/apt/lists/* \
    && ! command -v ssh \
    && npm install -g cht-conf \
    && git config --system --add url."error://push-blocked-by-policy".pushInsteadOf "git@github.com:" \
    && git config --system --add url."error://push-blocked-by-policy".pushInsteadOf "https://github.com/" \
    && git config --system --add url."error://push-blocked-by-policy".pushInsteadOf "ssh://git@github.com/" \
    && git config --system push.default nothing \
    && git config --system credential.helper "" \
    && git config --system transfer.fsckObjects true \
    && rm -rf /root/.ssh /etc/ssh/ssh_config.d

# --- Git sandbox layer 1: non-root user, no credentials ---
# AGENT_UID must match the host user that owns the cht-core working copy so the
# bind mount is writable both ways (override with --build-arg AGENT_UID=$(id -u)).
# The node base image owns uid 1000 — remove it before reusing the uid. The
# root-owned, read-only ~/.ssh stops the agent adding keys or ssh config.
ARG AGENT_UID=1000
RUN { userdel -r node 2>/dev/null || true; } \
    && useradd -m -s /bin/bash -u "${AGENT_UID}" agent \
    && mkdir -p /home/agent/.ssh \
    && echo "# SSH disabled for the cht-agent sandbox" > /home/agent/.ssh/config \
    && chmod 444 /home/agent/.ssh/config \
    && chmod 555 /home/agent/.ssh \
    && chown -R root:root /home/agent/.ssh

# --- App build ---
WORKDIR /app
# husky's postinstall needs a .git directory; HUSKY=0 skips hook installation.
ENV HUSKY=0
COPY package.json package-lock.json ./
RUN npm ci
# Copy only what the build (src + tsconfig) and runtime (agent-memory, tickets)
# need — not the whole context — so no stray or sensitive files enter the image.
COPY tsconfig.json ./
COPY src ./src
COPY agent-memory ./agent-memory
COPY tickets ./tickets
RUN npm run build \
    && mkdir -p /workspace/cht-core /home/agent/.claude \
    && chown -R agent:agent /app /workspace /home/agent/.claude

# Sandbox init (layer 4) + agent-session rules (layer 5)
COPY docker/scripts/agent-entrypoint.sh /usr/local/bin/agent-entrypoint.sh
COPY docker/scripts/init-agent-git.sh /usr/local/bin/init-agent-git.sh
COPY docker/agent/CLAUDE.md /home/agent/.claude/CLAUDE.md
COPY docker/agent/settings.json /home/agent/.claude/settings.json
RUN chmod 755 /usr/local/bin/agent-entrypoint.sh /usr/local/bin/init-agent-git.sh \
    && chown agent:agent /home/agent/.claude/CLAUDE.md /home/agent/.claude/settings.json

# --- Extension point: code-generation tools (deferred — see #114) ---
# The tool set is still being decided. When chosen, bake tools here (above
# `USER agent` so they install system-wide), e.g.:
#   RUN npm install -g @anthropic-ai/claude-code
# Tools must respect the sandbox: no credentials baked, no Docker required.
# NOTE: the ~/.claude/settings.json allow/deny lists and the .credentials.json
# mount only take runtime effect once such a CLI is the execution layer — until
# then they are inert. Re-audit both when this extension point is filled.

USER agent

# Layer 4 (defense in depth): dummy identity — init-agent-git.sh also exports
# it via environment on every start. safe.directory: the bind-mounted working
# copy is owned by the host uid.
RUN git config --global user.name "CHT Agent" \
    && git config --global user.email "agent@cht-agent.local" \
    && git config --global credential.helper "" \
    && git config --global push.default nothing \
    && git config --global --add safe.directory /workspace/cht-core

ENV CLAUDE_CONFIG_DIR=/home/agent/.claude
ENV CHT_CORE_PATH=/workspace/cht-core
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Reinforces the sandbox at runtime: unhealthy if cht-conf vanished or an ssh
# binary ever appeared (the idle `sleep infinity` container is otherwise opaque).
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
  CMD command -v cht > /dev/null && ! command -v ssh > /dev/null

# Entrypoint verifies every sandbox layer, then idles for `docker exec`.
ENTRYPOINT ["/usr/local/bin/agent-entrypoint.sh"]
CMD ["sleep", "infinity"]
