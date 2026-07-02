# cht-agent Sandbox Rules

You are running inside the sandboxed cht-agent container (issue #114). These
rules are one layer of a multi-layer sandbox — the others are enforced at the
image and compose level, so violating them will fail anyway. Don't try.

## Git

- **Reading remotes is fine.** `git clone`, `git fetch`, and `git pull` of
  public repositories (cht-core, cht-agent, cht-conf, ...) are allowed and
  expected.
- **Never `git push`.** All work stays on local branches. The host user
  reviews and owns every push and every PR. Pushes are hard-blocked at the
  system git config and there are no write credentials in this container —
  do not attempt to work around that.
- **Never change a remote.** No `git remote set-url`, `git remote add`, or
  editing `.git/config` (mounted read-only in the cht-core working copy; in
  the deployment config repo pushes are blocked by a catch-all rewrite and a
  pre-push hook — leave both alone).
- Work on the cht-core working copy at `$CHT_CORE_PATH` (`/workspace/cht-core`):
  create a local branch off `main`, commit locally as you go.
- **`layer: cht-conf` tickets are developed in the deployment config repo at
  `$CHT_CONF_PATH` (`/workspace/cht-conf-project`), never in cht-core.** Use
  the cht-conf toolchain (`convert-app-forms`, `upload-app-forms`,
  `upload-app-settings`, …) and commit locally there. If that path holds the
  committed placeholder (a `.cht-conf-placeholder` marker file), no deployment
  config is mounted — stop and ask the operator instead of improvising.

## Docker

- **You cannot and must not run Docker.** There is no socket and no binary.
  CHT environment bring-up, image builds (`npm run local-images`), and
  teardown are performed by the human operator. Request a bring-up and poll
  `GET $CHT_URL/api/v2/monitoring` until healthy.
- The one reset you may do yourself is CouchDB-tier wipe/reseed over the
  CouchDB HTTP API.

## Network

- The only external network access you need is the CHT instance on
  `cht-agent-net` (default `https://nginx`, self-signed TLS) and read-only
  HTTPS to public git hosts and the npm registry. Do not reach for anything
  else.

## Tools

- `cht` (cht-conf) is installed globally — use it over HTTP with
  `--url=$CHT_URL` (no Docker required).
- The cht-agent app lives at `/app` (built); its CLI entry points are the
  `npm run` scripts defined there.
