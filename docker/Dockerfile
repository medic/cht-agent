# cht-agent sandboxed image (#114)
#
# NOTE: this base sandbox (Dockerfile + docker/scripts/* + docker/agent/*) is
# VENDORED into the seeding branch so the seeder image builds standalone today,
# without waiting on #114 to merge. REFACTOR once #114 lands: delete this base
# tree and point docker/Dockerfile.seeder at the published cht-agent:local
# image. The docker/scripts/init-agent-git.sh read-only-GH_TOKEN exception
# (CHT_AGENT_ALLOW_READONLY_GH_TOKEN) must also be upstreamed into #114 then.
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
    && apt-get purge -y openssh-client || true \
    && rm -rf /var/lib/apt/lists/*

# cht-conf baked in: the Test Environment Layer (#66) runs the `cht` binary
# against a CHT instance over HTTP — no Docker needed inside the container.
RUN npm install -g cht-conf

# --- Git sandbox layer 2: push hard-blocked at system git config ---
# pushInsteadOf rewrites only PUSH urls, so fetch/clone of public repos stays
# allowed. System-level config requires root to change; the agent user cannot.
# (Adapted from the cht-core PoC .devcontainer: "no remote at all" became
# "remote read OK, push blocked".)
RUN git config --system url."error://push-blocked-by-policy".pushInsteadOf "git@github.com:" && \
    git config --system url."error://push-blocked-by-policy".pushInsteadOf "https://github.com/" && \
    git config --system url."error://push-blocked-by-policy".pushInsteadOf "ssh://git@github.com/" && \
    git config --system push.default nothing && \
    git config --system credential.helper "" && \
    git config --system transfer.fsckObjects true

# No SSH client config anywhere in the image
RUN rm -rf /root/.ssh /etc/ssh/ssh_config.d

# --- Git sandbox layer 1: non-root user, no credentials ---
# uid 1000 matches the typical host user so the bind-mounted cht-core working
# copy is writable both ways. The node base image owns uid 1000 — remove it.
RUN userdel -r node 2>/dev/null || true && \
    useradd -m -s /bin/bash -u 1000 agent

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

# Entrypoint verifies every sandbox layer, then idles for `docker exec`.
ENTRYPOINT ["/usr/local/bin/agent-entrypoint.sh"]
CMD ["sleep", "infinity"]
