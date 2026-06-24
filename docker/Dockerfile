# cht-agent sandboxed image (#114)
#
# Bakes in the tools the agent drives (cht-conf today; code-generation tools
# later) and hardens git so autonomous loops can READ public remotes but never
# push. The container has no Docker access — CHT environment bring-up is
# human-gated on the host (see docs/docker-agent-runbook.md and
# designs/layer_recommendations/test-environment-layer.md).

FROM node:22-bookworm

# Tools the agent drives. openssh-client is purged: all remote reads go over
# HTTPS, and without an ssh binary git ssh:// URLs fail closed.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    bash \
    jq \
    build-essential \
    python3 \
    ca-certificates \
    && apt-get purge -y openssh-client 2>/dev/null || true \
    && rm -rf /var/lib/apt/lists/* \
    && ! command -v ssh   # fail the build closed if an ssh binary survived

# cht-conf baked in: the Test Environment Layer (#66) runs the `cht` binary
# against a CHT instance over HTTP — no Docker needed inside the container.
RUN npm install -g cht-conf

# --- Git sandbox layer 2: push hard-blocked at system git config ---
# pushInsteadOf rewrites only PUSH urls, so fetch/clone of public repos stays
# allowed. System-level config requires root to change; the agent user cannot.
# --add is required: pushInsteadOf is multi-valued, and a plain `git config`
# set would clobber to the last value, silently dropping the https rewrite.
# (Adapted from the cht-core PoC .devcontainer: "no remote at all" became
# "remote read OK, push blocked".)
RUN git config --system --add url."error://push-blocked-by-policy".pushInsteadOf "git@github.com:" && \
    git config --system --add url."error://push-blocked-by-policy".pushInsteadOf "https://github.com/" && \
    git config --system --add url."error://push-blocked-by-policy".pushInsteadOf "ssh://git@github.com/" && \
    git config --system push.default nothing && \
    git config --system credential.helper "" && \
    git config --system transfer.fsckObjects true

# No SSH client config anywhere in the image
RUN rm -rf /root/.ssh /etc/ssh/ssh_config.d

# --- Git sandbox layer 1: non-root user, no credentials ---
# AGENT_UID must match the host user that owns the cht-core working copy so the
# bind mount is writable both ways (override with --build-arg AGENT_UID=$(id -u)).
# The node base image owns uid 1000 — remove it before reusing the uid.
ARG AGENT_UID=1000
RUN userdel -r node 2>/dev/null || true && \
    useradd -m -s /bin/bash -u "${AGENT_UID}" agent

# Root-owned, read-only ~/.ssh so the agent cannot add keys or ssh config.
RUN mkdir -p /home/agent/.ssh && \
    echo "# SSH disabled for the cht-agent sandbox" > /home/agent/.ssh/config && \
    chmod 444 /home/agent/.ssh/config && \
    chmod 555 /home/agent/.ssh && \
    chown -R root:root /home/agent/.ssh

# --- App build ---
WORKDIR /app
# husky's postinstall needs a .git directory; HUSKY=0 skips hook installation.
ENV HUSKY=0
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && chown -R agent:agent /app

# Mount points: the cht-core working copy is an INPUT (a standing local clone
# the agent branches locally and edits in place — it never clones or pushes it).
RUN mkdir -p /workspace/cht-core /home/agent/.claude && \
    chown -R agent:agent /workspace /home/agent/.claude

# Sandbox init (layer 4) + agent-session rules (layer 5)
COPY docker/scripts/agent-entrypoint.sh /usr/local/bin/agent-entrypoint.sh
COPY docker/scripts/init-agent-git.sh /usr/local/bin/init-agent-git.sh
COPY docker/agent/CLAUDE.md /home/agent/.claude/CLAUDE.md
COPY docker/agent/settings.json /home/agent/.claude/settings.json
RUN chmod 755 /usr/local/bin/agent-entrypoint.sh /usr/local/bin/init-agent-git.sh && \
    chown agent:agent /home/agent/.claude/CLAUDE.md /home/agent/.claude/settings.json

# --- Extension point: code-generation tools (deferred — see #114) ---
# The tool set is still being decided. When chosen, bake tools here (above
# `USER agent` so they install system-wide), e.g.:
#   RUN npm install -g @anthropic-ai/claude-code
# Tools must respect the sandbox: no credentials baked, no Docker required.

USER agent

# Layer 4 (defense in depth): dummy identity — init-agent-git.sh also exports
# it via environment on every start. safe.directory: the bind-mounted working
# copy is owned by the host uid.
RUN git config --global user.name "CHT Agent" && \
    git config --global user.email "agent@cht-agent.local" && \
    git config --global credential.helper "" && \
    git config --global push.default nothing && \
    git config --global --add safe.directory /workspace/cht-core

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
