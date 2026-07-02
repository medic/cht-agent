# Mission 02b report — #66 Test Environment Layer, Phase 3

**Branch:** `66-test-environment-layer-implementation` (commits appended; the 5 pre-existing
commits untouched; integration branch untouched)
**Code tip SHA:** `5864e43` (this report's commit follows it as the branch tip)
**Session:** cht-workbench, 2026-07-02, ultracode (concurrent with missions 01/02a/02c per
`00-conventions.md`; worktree `.claude/worktrees/m02b`, removed at mission end)

## What landed

Phase 3 fills the remaining NOT_IMPLEMENTED real paths in `src/agents/test-environment-agent.ts`:

1. **`discoverConfig` real path** — `GET /api/v1/settings` + form-doc revs from
   `GET /medic/_all_docs` over the `form:` key range, parsed into `DiscoveredConfig`. New
   optional `formVersions` map (form id → CouchDB rev) is the post-applyConfig verification
   primitive: a re-upload changes the rev; a `skipped` bucket leaves it unchanged. When the
   instance settings define no `contact_types`, discovery keeps `[]` (it reflects only what
   the API returns, like the sibling parsers) and warns that cht-core is running on its
   built-in default hierarchy.
2. **`prepareTestData` real path** — clears stale `json_docs` (csv-to-docs writes alongside
   leftovers and would re-upload a superseded dataset), runs one `cht` process for
   `csv-to-docs upload-docs` (ordered actions), then `create-users` only when
   `<dataPath>/users.csv` exists (cht-conf throws on a missing file). Counts are classified
   from `<dataPath>/json_docs/*.doc.json` against the discovered config (custom
   `person: true` contact types count as people; `user` docs are csv-to-docs artifacts, not
   accounts — `usersCreated` is parsed from cht-conf's `Creating user <name>` stdout lines,
   discounting the attempt that failed on a non-zero exit). Child cwd points at the data
   project so `upload-docs.<ts>.log.json` droppings stay out of the repo. Only a successful,
   non-empty seed (re)defines the reset worklist. `TestDataResult` gained `succeeded` +
   `seededDocIds` (evidence for the QA verify step).
3. **`reset('couchdb')`** — the one agent-owned reset (no Docker): pre-flights the reseed
   source **before** the destructive wipe (a vanished data project fails closed), fetches the
   CURRENT revs of the tracked docs (sentinel may have bumped them), POSTs `_bulk_docs`
   tombstones, then reseeds pristine copies via `upload-docs` (deterministic uuid5 ids come
   back with fresh revs). Requires the reseed summary to cover the on-disk doc count —
   upload-docs exits 0 with *no* summary when it uploads nothing, so absence is failure, and
   the summary total is only the on-disk file count so it is never measured against itself.
   Tracking (per handle URL) refreshes to the reseeded set and is cleared by `teardown`.
   Deployed config is untouched throughout.
4. **`CHT_URL` provision fallback** — `options.url ?? CHT_URL (trimmed; blank ignored) ??
   'https://nginx'`, canonicalized (no trailing slash — appended paths and the tracking key
   depend on it). Credentials embedded in the resolved URL are **stripped** (`handle.url` is
   logged everywhere, and undici's `fetch()` rejects credentialed URLs outright) and demoted
   to an auth fallback, tolerating raw-`%` userinfo. Auth resolution:
   `options.auth ?? embedded-URL creds ?? COUCHDB_USER/COUCHDB_PASSWORD (the
   scripts/test-env-up.sh seam) ?? medic/password`. Documented in `.env.example`.

New utils (side-effect isolation mirrors `cht-readiness.ts`):

- `src/utils/cht-api.ts` — all instance HTTP (settings, form revs, current doc revs,
  `_bulk_docs`); basic auth via header only; bounded requests (`AbortSignal.timeout`); creds
  never appear in errors or logs.
- `src/utils/test-data.ts` — ANSI-stripping stdout parsers (verified against installed
  cht-conf 6.5.0 `lib/log.js`), `json_docs` reader/cleaner (fs isolated), config-driven doc
  classification.
- `src/utils/cht-conf-runner.ts` — generalized: `runChtConf` (generic ordered-verb spawn,
  minimal env allow-list, optional cwd, never rejects) with `runBucket` now a thin classifier
  on top; phase-2 spec assertions pass unchanged.

## Phase-2 bug found and fixed (form-filter argv)

cht-conf's `main.js` treats EVERY bare positional as an action name and throws
`Unsupported action(s): <artifact>` — the phase-2 argv put the artifact form filter directly
after the verbs, so any artifact-narrowed `applyConfig` would have failed at runtime. Only
args after a literal `--` reach `environment.extraArgs` (what `args-form-filter` reads).
`buildExecArgs` now emits `... upload-app-forms -- <artifact>`. Verified against the
installed cht-conf 6.5.0 source. (Also noted: main.js auto-inserts `validate-app-forms`
before `upload-app-forms` unless `--skip-validate`; we let validation run.)

## Verification (ultracode)

- **Round 1 (Fable subagents):** 4-lens adversarial review (cht-conf contract, CouchDB/CHT
  API contract, repo gates, logic bugs) → 11 raw findings (6 distinct), each scheduled for
  2×-refutation votes; the vote fleet was cut short by the session limit after
  double-confirming 2 findings.
- **Round 2 (operator-directed: Opus 4.8 subagents, single Fable supervisor):** one Opus
  verifier per remaining finding group. All 4 confirmed real with prescribed minimal fixes.
  Notable ground-truthing performed in-container: undici fetch **does** honor
  `NODE_TLS_REJECT_UNAUTHORIZED=0`, and undici `fetch()` **throws** on credentialed URLs.
- All 6 distinct findings fixed (commit `5864e43`): reseed fail-open, stale json_docs
  inflation, tracking clobber, contact_types-absent honesty warning, TLS documentation,
  URL-credential stripping + auth env seam.
- **Round 3 (Opus 4.8):** final review of the fix diff — core logic of all fixes sound, all
  new tests verified to fail if their fix is reverted, no gate violations; its two
  low-severity items (raw-`%` userinfo `URIError`, one vacuous test assertion) were fixed in
  the same commit.
- Rejected as wrong-fix (with rationale): hardcoding cht-core's default hierarchy into
  discovery (couples the agent to a version-specific constant; discovery reflects what the
  instance returns); multi-record seeded-data tracking (over-engineering vs the documented
  last-seed contract); code-level TLS bypass (new dependency or silent global TLS disable —
  doc-only matches cht-conf's own `--accept-self-signed-certs` mechanism).

## Gates

- Node 22, in-worktree `npm ci`; `npm run build` clean; `npm run lint` (eslint) clean.
- `env -u ANTHROPIC_MODEL npm test`: **666 passing, 0 failing** (baseline 591; mission
  ballpark ~640 exceeded). `ANTHROPIC_MODEL` unset per the known workbench env leak;
  `agent-memory/_skipped.ndjson` pollution verified session-local and restored after every
  run (not committed).
- Every new test ≥1 assertion; no nested template literals; no `any` in src/.
- Provision-related specs save/clear/restore `CHT_URL`/`COUCHDB_*` so a live-env compose
  export cannot flake the suite.

## Commits appended (in order)

1. `41097f1` feat(#66): phase-3 types + mock fixtures — cht-conf exec options, seeded-doc evidence, form versions
2. `ac1018c` refactor(#66): generalize the cht-conf runner — runChtConf core; form filter rides after `--`
3. `979f161` feat(#66): phase-3 utils — instance HTTP (cht-api) and test-data helpers
4. `15248da` feat(#66): phase-3 real paths — discoverConfig, prepareTestData, couchdb-tier reset, CHT_URL fallback
5. `5864e43` fix(#66): harden phase-3 against adversarial-review findings
6. (this report)

No merges, no conflicts (single-branch mission; types/index.ts changes are append-only for
mission 03's union merge).

## Live-CHT verification steps (need an operator-provisioned instance)

Deferred until the operator brings up an env (`scripts/test-env-up.sh <cht-core>`); the agent
runs no Docker:

1. Export `NODE_TLS_REJECT_UNAUTHORIZED=0` (or `NODE_EXTRA_CA_CERTS`) for the **agent
   process** — the readiness poll and every cht-api fetch hit the self-signed
   `https://nginx` cert; cht-conf handles its own via `--accept-self-signed-certs`.
2. `provision()` (real) with `CHT_URL` unset/set — confirm fallback order, cred-stripping,
   and the readiness poll.
3. `discoverConfig` — confirm settings parse against a real 4.x instance and that
   `formVersions` revs match `GET /medic/form:<id>`.
4. `applyConfig(handle, { actions: ['app-forms'], artifact: 'pregnancy' })` — confirm the
   `-- pregnancy` filter uploads exactly one form (exercises the phase-2 argv fix), and that
   `convert-app-forms` runs in-image (xlsx→XForm toolchain, §7.4 caveat from the phase-2
   handoff).
5. `prepareTestData` with a csv/ project — confirm counts, users, stale-doc cleaning, and
   that the upload-docs report lands in the data project (not the repo).
6. `reset('couchdb')` — confirm wipe+reseed leaves the deployed config untouched (re-run
   `discoverConfig`: `formVersions` unchanged) while seeded docs get fresh revs.

## Deviations / follow-ups

- Scope addition (justified): the phase-2 form-filter argv fix — phase 3 generalized that
  code path, and the bug would have broken PR5's validate loop at first live use.
- `usersCreated` on a failed create-users run is a documented heuristic (logged attempts
  minus the one that blew up).
- Docs placed in nested `json_docs` subdirectories are uploaded by cht-conf (it recurses)
  but not counted/tracked/cleaned by the flat reader — csv-to-docs itself only writes flat,
  so this matters only for hand-crafted `json_docs`; revisit if a future phase hand-authors
  docs.
- A re-seed that fails on the same dataPath leaves tracking pointing at now-cleaned source
  files; the reset pre-flight catches this and fails closed (re-run `prepareTestData`).
- Operator flagged `medic/cht-ai-tools` mid-session: reviewed (read-only via web; `gh repo
  view` is denied in this sandbox) — Claude/OpenCode skills (CHT Specialist, task/target
  generators), CHT-docs MCP server, config validation hooks. Interactive-assistant focused;
  no overlap with this layer's cht-conf orchestration. Complementary candidate for
  form/config-authoring work in the #134 stack; no code impact here.
