# Operator Runbook — Containerized Memory Seeding

Runs the memory distillation pipeline (scrape → filter → distill, PR #109)
over a large batch of merged cht-core PRs, inside a sandboxed container, with
`claude -p` as the LLM backend (no API key) and a **read-only** GitHub token.

> **Scope note:** the pipeline operates on **merged PRs** — each PR's linked
> issues are scraped in as context. "The last 1000 issues" therefore means the
> newest 1000 merged PRs and the issues they reference.
>
> **No write path:** the container cannot write to GitHub at any layer. Drafts
> land in your host `agent-memory/_pending/<domain>/`; promoting them to
> per-domain review PRs (`npm run open-review-pr`) is a manual, host-side step
> you run yourself when ready.

## 1. One-time setup

**Read-only token** — classic PAT with **only the `read:org` scope** (github.com
→ Settings → Developer settings → Tokens (classic)). It passes the scraper's
medic-org membership check (`gh api /orgs/medic/members/<user>` → 204) but has
no `repo`/`public_repo`/`workflow` scope, so it cannot push, open PRs, or
write anything. Verify:

```bash
export GH_TOKEN=ghp_...
gh auth status                                      # scopes: read:org
gh api -X POST repos/medic/cht-agent/issues -f title=probe   # MUST fail (403/404)
```

**Build the images** (seeder layers on the base agent image):

```bash
docker build -f docker/Dockerfile -t cht-agent:local .
docker build -f docker/Dockerfile.seeder -t cht-agent-seeder:local .
```

**Start and log in to Claude once** (OAuth persists in a named volume):

```bash
GH_TOKEN=$GH_TOKEN docker compose -f docker/docker-compose.seeder.yml up -d
docker logs cht-seeder        # sandbox verification; GH_TOKEN shows as a declared [WARN]
docker exec -it cht-seeder claude   # complete OAuth, then /exit
```

### Model and effort

The compose file pins every `claude -p` call to **Opus 4.8 at max effort** via
`ANTHROPIC_MODEL=claude-opus-4-8` and `CLAUDE_CODE_EFFORT_LEVEL=max` (override
with `SEEDER_MODEL` / `SEEDER_EFFORT`). These env vars outrank the CLI's
settings.json; only explicit `--model`/`--effort` flags rank higher, and the
pipeline passes neither. Note `max` effort is env/flag-only — it cannot be
persisted in settings.json (`effortLevel` accepts up to `xhigh`).

Verify inside the container before a long run:

```bash
docker exec -it cht-seeder bash -lc \
  'echo "Reply with the single word OK" | claude -p --output-format json' | grep -o 'claude-opus-4-8[^"]*'
```

The JSON result's model/usage fields should name `claude-opus-4-8`. If you see
a different model, check that nothing in the claude-config volume overrides it
(`docker exec cht-seeder cat /home/agent/.claude/settings.json`).

> **Named-volume caveat.** `/home/agent/.claude` is a named volume
> (`seeder-claude-config`) that is seeded from the image **only on first
> creation**. Rebuilding the image after changing the baked `CLAUDE.md` /
> `settings.json` will **not** update an existing volume. To pick up those
> changes (or to recover from a corrupted config) recreate it:
> ```bash
> docker compose -f docker/docker-compose.seeder.yml down
> docker volume rm cht-agent_seeder-claude-config   # then `up` re-seeds + re-login
> ```
> The OAuth login persists in this volume, so you will need to re-run the login
> step afterwards.

## 2. Run the batch

```bash
docker exec -it cht-seeder npm run run-pipeline -- --last 1000 --resume
```

- `--last 1000` — newest 1000 merged PRs (instead of the time-window `--since`).
- `--resume` — skips PRs that already have a draft or an audit-log entry, so
  an interrupted run can simply be re-executed. The resume state lives in the
  bind-mounted `agent-memory/` (drafts + `_skipped.ndjson`), so it survives
  container rebuilds.

### Concurrency

`--concurrency N` (default 1, clamped to 10) processes N PRs at a time. Only
the `claude -p` legs overlap — gh scraping is synchronous and stays serial,
which also keeps GitHub's burst-sensitive secondary rate limits happy. Under
concurrency every log line is prefixed `[#<pr>]`.

- **3–5 is the sweet spot** with the default 2g memory limit.
- Going wider: each claude process is its own Node runtime (several hundred
  MB) — raise the limit, e.g.
  `SEEDER_MEMORY_LIMIT=8g SEEDER_MODEL=... docker compose ... up -d`.
- Parallelism compresses, not reduces, subscription usage: N-wide burns the
  5-hour window ~N× faster, and a mid-run limit event stamps everything in
  flight (see the recovery recipe below).

```bash
docker exec -it cht-seeder npm run run-pipeline -- --last 200 --resume --concurrency 4
```

For an unattended run, detach it and follow the log:

```bash
docker exec -d cht-seeder bash -lc 'cd /app && npm run run-pipeline -- --last 1000 --resume > /tmp/seed-run.log 2>&1'
docker exec -it cht-seeder tail -f /tmp/seed-run.log
```

**Budgeting:** the scraper makes ~4–6 gh calls per PR; with the token's
5,000 req/h limit a 1000-PR batch is borderline — if you hit secondary rate
limits, stop and re-run later with `--resume`. Most PRs are filtered
deterministically (bots, chores, lockfiles, translations) and never reach the
LLM; only the gray-area and distill-worthy ones invoke `claude -p`.

## 2b. Force-distilling specific PRs / closed issues

The filter stage skips most PRs deterministically (bots, reverts,
chore/docs/ci/build titles, lockfile- and translation-only diffs) and sends
gray-area PRs to a cheap LLM triage that can also decide `skip` or
`flag-for-human` — so a PR you care about may never reach distillation.
`--force` bypasses the entire filter and distills directly (it requires an
explicit `--pr` list, so a batch can never be force-distilled by accident):

```bash
docker exec -it cht-seeder npm run run-pipeline -- --pr 12345,11987 --force
```

The pipeline's unit is the merged PR; to force-distill a **closed issue**,
resolve it to the PR(s) that closed it first:

```bash
gh api graphql -f query='{repository(owner:"medic",name:"cht-core"){
  issue(number:9281){closedByPullRequestsReferences(first:5){nodes{number title}}}}}'
```

(Read-only token is sufficient — public repo.) Candidates worth forcing:
substantive fixes hiding behind a `chore:`/`docs:` title, and the
`flag-for-human` backlog — list it with:

```bash
grep flag-for-human agent-memory/_skipped.ndjson | python3 -c \
  'import json,sys; [print(json.loads(l)["prNumber"], json.loads(l)["reason"]) for l in sys.stdin]' | sort -u
```

Forced runs overwrite any existing draft for that PR number (same output
path), so re-forcing after a prompt tweak is safe.

## 3. Review the output (host)

Drafts appear in your working copy as the run progresses:

```bash
ls agent-memory/_pending/*/            # drafts grouped by CHT domain
wc -l agent-memory/_skipped.ndjson     # audit log of skip / flag-for-human decisions
npm run validate-schema                # re-validate all pending drafts
```

## 4. Promote to PRs — manual, host-side, later

When you're ready (this is your step, with your own write-capable auth — the
read-only seeding token cannot do it):

```bash
npm run open-review-pr                 # dry-run: shows per-domain PR plan
npm run open-review-pr -- --apply     # creates branch + PR per domain
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| startup: `Sandbox verification FAILED` mentioning GH_TOKEN | `CHT_AGENT_ALLOW_READONLY_GH_TOKEN=1` not set (compose sets it), or a token other than GH_TOKEN leaked into the env. |
| `claude` exits with auth error mid-run | OAuth token expired — `docker exec -it cht-seeder claude` to re-login, then re-run with `--resume`. |
| gh: `HTTP 403 ... rate limit` | Secondary rate limit on the scraper. Wait, then re-run with `--resume`. |
| drafts not appearing on host | `agent-memory` bind mount missing — run compose from the repo root with the file in `docker/`. |
| filter says `flag-for-human` for everything | `claude -p` backend not reachable (not logged in) — the pipeline fails safe to flagging. Check the login step. |
