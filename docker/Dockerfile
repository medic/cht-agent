# cht-agent sandboxed image (#114)
#
# Bakes in the tools the agent drives (cht-conf, headless Chromium for
# cht-conf-test-harness; code-generation tools later) and hardens git so
# autonomous loops can READ public remotes but never push. The container has no Docker access — CHT environment bring-up is
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
#   The bare https:// and http:// rewrites are catch-alls (#134): they close
#   embedded-credential URLs (https://user:token@github.com/... does not match
#   the github.com prefix) and non-GitHub hosts, e.g. remotes of a mounted
#   deployment-config repo. In-container pushes are impossible by design;
#   the host user pushes from the host.
# - python3 also serves cht-conf's convert-app-forms: its xls2xform-medic is a
#   self-contained pyxform zipapp needing only a system Python >= 3.10
#   (bookworm ships 3.11) — no pip packages required.
# - The libX11/nss/gtk/asound block is the shared-library set for the headless
#   Chromium that cht-conf-test-harness drives (tier-2 Enketo QA, step 6b of
#   docs/handoffs/demo-runbook.md). The binary itself is the rev-901912
#   (Chromium 93) snapshot puppeteer-chromium-resolver downloads during
#   `npm ci` below — distro chromium canNOT be substituted: resolver 10.0.0
#   reads no env vars (PUPPETEER_EXECUTABLE_PATH is ignored) and hard-pins the
#   revision from puppeteer-core 10.4.0. Both the workbench harness (5.0.4) and
#   the deployment config repo's harness (3.0.15) pin resolver ^10, so this one
#   snapshot serves either. The list covers every NEEDED soname of the
#   rev-901912 binary (verified via readelf -d; fontconfig/freetype come in
#   transitively through libgtk-3-0). A build-time launch check below fails
#   the build closed if this lib set ever goes stale.
# (Adapted from the cht-core PoC .devcontainer: "no remote at all" became
# "remote read OK, push blocked".)
RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl bash jq build-essential python3 ca-certificates \
        fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
        libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libexpat1 \
        libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
        libpangocairo-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
        libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxkbcommon0 \
        libxrandr2 libxrender1 libxshmfence1 libxss1 libxtst6 xdg-utils \
    && { apt-get purge -y openssh-client 2>/dev/null || true; } \
    && rm -rf /var/lib/apt/lists/* \
    && ! command -v ssh \
    && npm install -g cht-conf \
    && git config --system --add url."error://push-blocked-by-policy".pushInsteadOf "git@github.com:" \
    && git config --system --add url."error://push-blocked-by-policy".pushInsteadOf "https://github.com/" \
    && git config --system --add url."error://push-blocked-by-policy".pushInsteadOf "ssh://git@github.com/" \
    && git config --system --add url."error://push-blocked-by-policy".pushInsteadOf "https://" \
    && git config --system --add url."error://push-blocked-by-policy".pushInsteadOf "http://" \
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
# npm ci runs as root, so puppeteer-chromium-resolver's install script drops
# the Chromium 93 snapshot in /root/.chromium-browser-snapshots — invisible to
# the runtime `agent` user, whose resolver looks in ITS home (the resolver
# offers no env-var override). Move it where the agent will find it. The `mv`
# doubles as a fail-closed assert that the download actually happened; the
# stale .stats.json (it records the /root path) is dropped so first use
# re-detects and rewrites it.
RUN npm ci \
    && mv /root/.chromium-browser-snapshots /home/agent/.chromium-browser-snapshots \
    && chown -R agent:agent /home/agent/.chromium-browser-snapshots \
    && rm -f node_modules/puppeteer-chromium-resolver/.stats.json
# Copy only what the build (src + tsconfig) and runtime need — not the whole
# context — so no stray or sensitive files enter the image. Runtime pieces:
# agent-memory + tickets (workflow inputs), test + .mocharc* (the tier-2
# harness suite, `npm run test:harness`, runs in-container against demo/'s
# stand-in config), demo (also provides `npm run demo:build-seed`, the runbook
# 2b seed generator). tsc only compiles src/** — test/demo ride along uncompiled
# (mocha loads specs via ts-node at runtime).
COPY tsconfig.json .mocharc.json .mocharc.harness.json ./
COPY src ./src
COPY agent-memory ./agent-memory
COPY tickets ./tickets
COPY test ./test
COPY demo ./demo
RUN npm run build \
    && mkdir -p /workspace/cht-core /workspace/cht-conf-project /home/agent/.claude \
    && chown -R agent:agent /app /workspace /home/agent/.claude

# Sandbox init (layer 4) + agent-session rules (layer 5)
COPY docker/scripts/agent-entrypoint.sh /usr/local/bin/agent-entrypoint.sh
COPY docker/scripts/init-agent-git.sh /usr/local/bin/init-agent-git.sh
COPY docker/agent/CLAUDE.md /home/agent/.claude/CLAUDE.md
COPY docker/agent/settings.json /home/agent/.claude/settings.json
RUN chmod 755 /usr/local/bin/agent-entrypoint.sh /usr/local/bin/init-agent-git.sh \
    && chown agent:agent /home/agent/.claude/CLAUDE.md /home/agent/.claude/settings.json

# --- Code-generation layer: Claude Code CLI (#134) ---
# Installed above `USER agent` so it lands system-wide. Respects the sandbox:
# no credentials baked, no Docker required. Runtime auth is the READ-ONLY
# ~/.claude/.credentials.json mount (claude-code OAuth), not an API key — with
# this CLI as the execution layer the ~/.claude/settings.json allow/deny lists
# and the credentials mount now take runtime effect (re-audited with #134 PR5:
# settings.json is baked read-only above; the mount stays :ro in compose).
RUN npm install -g @anthropic-ai/claude-code

# Deployment-pinned cht-conf 3.x (mounted config repos via CHT_CONF_BIN)
# predates the bundled xls2xform zipapp: its convert-app-forms shells out to
# the `xls2xform-medic` binary from medic's pyxform fork — without it the
# app-forms bucket (QA applyConfig) and manual 2b uploads fail. The tarball
# URL avoids git+https (the system git push-block stays untouched);
# --break-system-packages is bookworm PEP 668 (no other python payload here).
# Trailing -h run fails the build closed if the fork stops importing on the
# image's Python. (The image's own cht-conf ≥4 needs only system python3.)
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --break-system-packages \
        "https://github.com/medic/pyxform/archive/refs/heads/medic-conf-1.17.tar.gz#egg=pyxform-medic" \
    && xls2xform-medic -h > /dev/null

USER agent

# Layer 4 (defense in depth): dummy identity — init-agent-git.sh also exports
# it via environment on every start. safe.directory: the bind-mounted working
# copy is owned by the host uid.
RUN git config --global user.name "CHT Agent" \
    && git config --global user.email "agent@cht-agent.local" \
    && git config --global credential.helper "" \
    && git config --global push.default nothing \
    && git config --global --add safe.directory /workspace/cht-core \
    && git config --global --add safe.directory /workspace/cht-conf-project

# Fail-closed launch check for the tier-2 harness capability: resolve the baked
# Chromium AS THE AGENT USER and actually launch it headless. Catches a missing
# shared lib or a mislocated snapshot at build time, not on demo day. The
# --no-sandbox/--disable-dev-shm-usage args mirror what the harness spec passes
# (mandatory at runtime: compose runs the container with cap_drop ALL).
RUN node -e "const PCR=require('/app/node_modules/puppeteer-chromium-resolver'); \
    PCR({silent:true}).then(async (s)=>{ \
      const b=await s.puppeteer.launch({headless:true,executablePath:s.executablePath,args:['--no-sandbox','--disable-dev-shm-usage']}); \
      console.log('harness chromium ok:', await b.version(), s.executablePath); \
      await b.close(); \
    }).catch((e)=>{console.error('harness chromium launch FAILED:',e.message);process.exit(1);})"

ENV CLAUDE_CONFIG_DIR=/home/agent/.claude
ENV CHT_CORE_PATH=/workspace/cht-core
# Deployment config mount (layer: cht-conf tickets develop HERE, never in
# cht-core) and the canonical baseline it is diffed against (#134).
ENV CHT_CONF_PATH=/workspace/cht-conf-project
ENV CANONICAL_CONF=/workspace/cht-core/config/standard
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Reinforces the sandbox at runtime: unhealthy if cht-conf or the Claude Code
# CLI vanished, or an ssh binary ever appeared (the idle `sleep infinity`
# container is otherwise opaque).
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
  CMD command -v cht > /dev/null && command -v claude > /dev/null && ! command -v ssh > /dev/null

# Entrypoint verifies every sandbox layer, then idles for `docker exec`.
ENTRYPOINT ["/usr/local/bin/agent-entrypoint.sh"]
CMD ["sleep", "infinity"]
