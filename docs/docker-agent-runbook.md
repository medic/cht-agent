# Operator Runbook — Dockerized cht-agent

Issue: [#114](https://github.com/medic/cht-agent/issues/114) · Design: [`designs/layer_recommendations/test-environment-layer.md`](https://github.com/medic/cht-agent/blob/main/designs/layer_recommendations/test-environment-layer.md)

The cht-agent runs inside a sandboxed container on the shared `cht-agent-net`
Docker network. It can read public git remotes, edit the mounted cht-core
working copy, and drive `cht-conf` over HTTP — but it can never push, reach
the host, or run Docker. **You (the host operator) are the control plane**:
you bring CHT up and down, approve gated phases, and own every push.

## Security model — what actually contains the agent

Be honest about the threat model before trusting this sandbox with an
autonomous or untrusted agent:

- **The real push-block is credential absence.** The agent runs arbitrary code
  (`node -e`, `npm`, `python3`) and controls its own environment, so the
  `pushInsteadOf` rewrites, the read-only `.git/config` shadow, the pre-push
  hook, and the `settings.json` deny-list are **accident-prevention** layers,
  not a wall — a determined or prompt-injected agent can bypass each one
  (`GIT_CONFIG_SYSTEM=/dev/null`, `git push --no-verify`, `cp` the repo
  elsewhere, push to a non-GitHub host). What it cannot do is authenticate a
  push, because no git write credential exists in the container.
- **Anything mounted or passed as a credential is readable and exfiltratable.**
  The agent can `cat` the mounted `.credentials.json` and read `ANTHROPIC_API_KEY`,
  and it has outbound HTTPS via `curl`. **Use a disposable, narrowly-scoped API
  key — never your personal Claude OAuth credentials.** Treat whatever you mount
  here as compromised the moment an untrusted ticket runs.
- **Recommended hardening for untrusted runs (not yet implemented):** restrict
  the container's outbound network to the CHT instance + a read-only git/npm
  proxy, so push and credential-exfil are blocked at the network layer rather
  than relying on credential absence alone. Tracked as a follow-up.

## Division of labour

| Agent (in container) | You (host) |
|---|---|
| local branches + commits in the working copy | all `git push` / PRs |
| Research → Development → QA pipeline | phase approvals (checkpoints) |
| `cht-conf` over HTTP, CouchDB-tier reset | `npm run local-images`, `docker compose up/down` |
| polls `/api/v2/monitoring` for readiness | attaches CHT to `cht-agent-net` |

## 1. Bootstrap the workspace (host)

```bash
# Clones cht-core if absent (full clone — worktrees are rejected), fast-forwards
# main, creates cht-agent-net, and prints the compose command to run next.
docker/scripts/bootstrap-workspace.sh ~/src/cht-core
```

This must run on the host, before the container starts: the compose file
shadow-mounts the hardened `.git/config` read-only, which requires the
working copy's `.git` directory to already exist — so the container can never
clone for itself. Re-running is safe (idempotent).

If your model credentials file doesn't exist yet, create it (or point
`CLAUDE_CREDENTIALS` at the right path / set `ANTHROPIC_API_KEY` instead):

```bash
touch ~/.claude/.credentials.json
```

## 2. Build and start the agent

From the cht-agent repo root:

```bash
ANTHROPIC_API_KEY=sk-ant-... CHT_CORE_PATH=$HOME/src/cht-core \
  docker compose -f docker/docker-compose.cht-agent.yml up -d --build
```

The key is passed into the container's environment at start, so the
`docker exec` pipeline runs (step 3) pick it up without re-passing it.

The entrypoint runs `init-agent-git.sh`, which verifies every sandbox layer
and **refuses to start** if one is missing. Check it:

```bash
docker logs cht-agent
```

Expected: `[OK]` for the system push block, no ssh, no tokens, no Docker
socket/binary, cht-conf present — ending in `Sandbox verified.`

### Verify the sandbox by hand (acceptance checks)

```bash
docker exec -it cht-agent bash

# read is allowed (public clone/fetch)
git clone --depth 1 https://github.com/medic/cht-agent.git /tmp/probe

# push is blocked even from a fresh clone (no pre-push hook there — this tests
# the system pushInsteadOf layer). MUST fail with: "remote-error is not a git
# command", NOT a username prompt.
cd /tmp/probe && git commit --allow-empty -m probe && git push origin HEAD

# local branch + commit on the working copy succeed
cd /workspace/cht-core
git checkout -b cht-agent/sandbox-probe
git commit --allow-empty -m "sandbox probe"

# push from the working copy is also blocked (pre-push hook banner + error://)
git push origin HEAD   # MUST fail

# no docker, no ssh
docker ps              # MUST fail: command not found
ssh -V                 # MUST fail: command not found
```

## 3. Run the pipeline

Run the Research Supervisor against a sample ticket (uses the
`ANTHROPIC_API_KEY` passed at start):

```bash
docker exec -it cht-agent bash -lc 'cd /app && npm run research -- tickets/simple-example.md'
```

Expect the research output for the ticket (no push, no Docker — purely the
in-container pipeline). Swap in any file under `tickets/` or a path you mount.

(Development and QA supervisor CLIs land in later issues; the container is the
place they'll run.)

## 4. Human-gated CHT bring-up

When the Test Environment Layer (#66) requests an environment, the agent
*waits and polls* — you bring it up:

```bash
# Build images from the agent's edited working copy (Model A rebuild-on-change)
cd ~/src/cht-core && npm run local-images

# Start the stack, attaching nginx to cht-agent-net via the #66 override
docker compose -f <cht-core compose files> \
  -f <cht-agent repo>/docker/cht-agent-net.override.yml up -d
```

> The override file `docker/cht-agent-net.override.yml` ships with #66.
> Validate service/network names against your generated compose before
> relying on it (see the comments in that file).

The agent detects readiness via `GET https://nginx/api/v2/monitoring` and
continues. CouchDB-tier resets it does itself over HTTP; container restarts
and rebuilds come back to you.

## 5. Review and push (host only)

When the pipeline finishes (HUMAN CHECKPOINT #2):

```bash
cd ~/src/cht-core
git log --oneline main..cht-agent/<ticket>   # review the agent's local branch
git diff main...cht-agent/<ticket>
# satisfied? you push from the host — the container never can
git push origin cht-agent/<ticket>
```

## 6. Teardown

```bash
docker compose -f docker/docker-compose.cht-agent.yml down
# CHT stack: docker compose -f <cht-core compose files> down -v
# Full cleanup of the shared network (only once nothing else uses it):
docker network rm cht-agent-net
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| compose fails mounting `git-config.hardened` over `.git/config` | working copy is a git worktree (`.git` is a file) or missing. Run `docker/scripts/bootstrap-workspace.sh` on the host. |
| `Sandbox verification FAILED` in `docker logs` | a hardening layer is missing — read which `[FAIL]` fired; don't bypass it. |
| working-copy files unwritable from container | host uid ≠ 1000. Rebuild with a matching uid or chown the copy. |
| agent can't reach `https://nginx` | CHT stack not attached to `cht-agent-net` — re-run compose with the #66 override; `docker network inspect cht-agent-net` should list nginx. |
| `fetch` fails for an `ssh://` or `git@` URL | by design (no ssh binary). Use the `https://` URL. |
