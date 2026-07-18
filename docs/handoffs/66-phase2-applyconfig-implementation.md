# #66 Phase 2 — real `applyConfig` implementation plan

> **Status — 2026-07-18 (DONE, phases 2 + 3 landed).** This plan is fully
> implemented, and Phase 3 (`discoverConfig` + `cht-api.ts`, `prepareTestData` +
> `test-data.ts`, the couchdb-tier reset) has been ported alongside it from the
> workbench lineage. The layer is at workbench parity **minus** the deferred
> cht-conf-extension pieces (`verifyArtifact`/`fetchDeployedFormXml`/`fetchFormXml`,
> the offline-convert block, `skipValidate`, `xform-inspect`) — see
> `PR_66_DESCRIPTION.md` for the excision + per-function parity proofs and the
> deferred-boundary map. `applyConfig`/`discoverConfig`/`prepareTestData`/
> `reset('couchdb')` real paths are all live; `provision` stays at the Phase-1
> shape. Gates green after every commit (Node 22): `build` + `test` (1104 passing,
> 126 in the layer) + `lint`. All work is on local branch
> `66-test-environment-layer-implementation` (rebased onto `origin/main` @
> `fdf4af2`); the operator owns the push + `gh pr create`.
>
> Phase 1 (provision/reset/teardown real paths) + the Phase-2 *shape* (action selector,
> `ConfigApplyResult`, `ConfigActionStatus`) already landed (`f954cb9`). This plan fills the
> `applyConfig` `!useMockDocker` branch that currently throws `NOT_IMPLEMENTED`. Same
> human-gated, no-Docker invariants as Phase 1. This is the artifact-upload half of the
> cht-conf validate loop (#134 PR5 step 4); test-data seeding (`prepareTestData`) is Phase 3.

## 0. Verified contract (cht-conf CLI — `medic/cht-conf` wiki, 2026-06-27)

- **Binary:** `cht` (cht-conf is baked into the agent image globally per #114; agent
  allow-list already sanctions `Bash(cht:*)`). Invoke via `child_process` (recommendation
  doc lists every config verb as `child_process` — this is NOT Docker, so it's allowed).
- **Instance target:** `cht --url=<url> <action> [<action>…]` where `<url>` embeds creds,
  e.g. `https://medic:password@nginx`. `--source=<path>` points at the project dir (the
  mounted `CHT_CONF_PATH`, or cht-core's in-repo `config/default`). Named actions run in the
  given order (doc example: `cht --instance=example validate-app-forms upload-app-forms`).
- **MUST pass for autonomous use (cht-conf prompts on stdin otherwise → the agent hangs):**
  - `--force` — skip ALL confirmation prompts (incl. the "both changed → view diff / overwrite
    / abort" form-conflict prompt and check-git's keyInYN). Doc labels it "DANGEROUS"; for a
    throwaway test instance it's correct.
  - `--skip-git-check` (we're on a local branch with a hardened RO .git/config), `--skip-version-check`,
    `--skip-dependency-check`, `--skip-translation-check`.
  - `--accept-self-signed-certs` — the env is `https://nginx` with a self-signed cert.
  - Consider `--verbose` so stdout carries per-form "skip (no changes)" / "uploaded" lines we
    classify on (see status mapping). Do NOT pass `--silent` (we need the lines).
- **Status semantics (confirmed, drives `ConfigActionStatus`):** upload verbs do hash-based
  change detection. "If local and remote versions are identical → **skip (no changes)**";
  "both changed → prompt" (suppressed by `--force` → overwrite = uploaded). cht-conf exits 0
  for both upload and skip, so **`skipped` vs `uploaded` is parsed from stdout, not exit code**;
  **`failed` = non-zero exit** (or a thrown spawn error). Exit code alone is insufficient.
- **Form targeting (`artifact` field):** `args-form-filter` restricts an upload to named forms
  via positional args after the action — `cht … upload-app-forms <formId>` (e.g. `pregnancy`).
  Maps `ApplyConfigOptions.artifact` → the positional form filter on the `app-forms` /
  `contact-forms` buckets. (No-op for `app-settings`/`resources`; document that.)
- **Bucket → verb mapping (already in `CONFIG_ACTION_COMMANDS`, verified against the doc):**
  - `app-settings`  → `compile-app-settings`, `upload-app-settings`
  - `app-forms`     → `convert-app-forms`, `upload-app-forms`   (+ optional `validate-app-forms`)
  - `contact-forms` → `convert-contact-forms`, `upload-contact-forms`
  - `resources`     → `upload-resources`, `upload-branding`, `upload-custom-translations`

## 1. Design decisions to lock before coding

1. **One `cht` invocation per bucket, not per verb.** Pass the bucket's verbs as ordered
   actions in a single `cht --url=… --source=… <verb1> <verb2> …` call. Rationale: cht-conf
   runs named actions in sequence in one process; per-verb spawns would re-pay startup and
   lose the convert→upload ordering guarantee. `ConfigActionResult.commands` already records
   the verb list for evidence.
2. **No `--force` blast radius beyond the bucket.** `--force` is scoped to the single bucket
   invocation; we still run buckets independently so one bucket's failure doesn't abort the
   rest (collect per-bucket status, set top-level `succeeded = no bucket failed`).
3. **`artifact` targeting only applies to form buckets.** When `artifact` is set and the
   bucket is `app-forms`/`contact-forms`, append it as the positional form filter to the
   `upload-*-forms` verb (and the matching `convert`). For `app-settings`/`resources`, ignore
   it and emit a warning into `ConfigActionResult.warnings` ("artifact targeting ignored for
   <bucket>").
4. **Credentials come from the handle, never logged.** Build the URL from
   `handle.url` + `handle.auth` → `https://<user>:<pass>@<host>`. **Redact creds in every
   log line** (log `handle.url`, never the cred-embedded URL). Mirrors the sandbox stance.
5. **Status parsing is a small pure helper** (`classifyChtConfOutput(stdout, exitCode)`),
   unit-tested in isolation against captured cht-conf output fixtures — don't bury the regex
   in the spawn callback. `failed` if exit≠0; else `skipped` if every form line says skipped
   / "no changes" and nothing uploaded; else `uploaded`.
6. **Timeout + no shell.** Use `spawn(executablePath, args, { shell: false })` like
   `src/llm/providers/claude-cli.ts` (explicit arg array, no string interpolation into a
   shell → no injection via `artifact`/`configPath`). Bound each bucket with a generous
   timeout (form conversion + upload can take a minute); kill + mark `failed` on timeout.
7. **Where the binary lives.** Resolve `cht` from PATH (image installs it globally). Add a
   `chtConfBin` override (constructor option or env `CHT_CONF_BIN`) for tests/local runs,
   defaulting to `'cht'` — lets the spec stub a fake script without a global install.

## 2. Files to touch

- `src/utils/cht-conf-runner.ts` *(new)* — the spawn wrapper + `classifyChtConfOutput`.
  Keep ALL `child_process` here (mirrors how `cht-readiness.ts` isolates `fetch`); the agent
  stays orchestration-only. Exports `runBucket(opts): Promise<ConfigActionResult>`.
- `src/agents/test-environment-agent.ts` — replace the `applyConfig` real-path throw with a
  loop over `actions` calling `runBucket`, aggregating into `ConfigApplyResult`. Build the
  cred URL here from the handle. Keep mock path untouched.
- `src/types/index.ts` — likely no change (shape already baked). Maybe add a
  `ChtConfRunOptions` interface for the runner.
- `test/utils/cht-conf-runner.spec.ts` *(new)* — unit-test `classifyChtConfOutput` against
  fixtures (uploaded / skipped / failed / mixed) and `runBucket` with a **stubbed spawn**
  (fake `cht` script or sinon stub on the runner's spawn) → assert args (incl. the
  autonomous-safe flags, cred URL, positional artifact), status mapping, timeout → failed.
- `test/agents/test-environment-agent.spec.ts` — add real-mode `applyConfig` tests that stub
  the runner (NOT spawn) → assert it builds the cred URL from the handle, calls `runBucket`
  per action, aggregates `succeeded`/`warnings`, and that a failed bucket flips top-level
  `succeeded:false` without aborting the others. **Keep the existing "throws" test only until
  the real path lands, then replace it** (it currently asserts NOT_IMPLEMENTED).

## 3. Conventions (same as Phase 1 — SonarCloud gate)

- No `any` in `src/`; `strict` + `noUnusedParameters` (prefix unused with `_`).
- Every test ≥1 assertion; no nested template literals (extract to a local first).
- `[Test Environment Agent]` / `[cht-conf]` console prefixes; redact creds.
- Node 22 to build/test (`~/.nvm/versions/node/v22.18.0/bin`).
- Agent + spec land together; user drives all git; no `git add .`.

## 4. Manual test (closed loop, needs the imported sandbox + a running env)

1. Human brings up CHT (`scripts/test-env-up.sh <cht-core>`); agent `provision()` (real) waits ready.
2. `applyConfig(handle, { configPath: '<CHT_CONF_PATH>', actions: ['app-forms'], artifact: 'pregnancy' })`
   → confirm it runs `cht --url=… --source=… convert-app-forms upload-app-forms pregnancy`
   with the autonomous-safe flags, and the report shows `status: uploaded`.
3. Re-run unchanged → `status: skipped` (hash no-change). Break the form → `status: failed`.
4. Confirm NO stdin prompt ever blocks (the `--force`/`--skip-*` set holds) and no push.

## 5. Dependency / sequencing notes

- §7.4 of `designs/cht-conf-agent-extension.md`: the env image must carry the **xlsx→XForm
  toolchain** for `convert-app-forms`. #114 Dockerfile bakes `cht-conf` + `python3` (cht-conf
  bundles medic-pyxform on install) — **verify `convert-app-forms` actually runs in-image**
  before claiming the loop works; if pyxform is missing, that's a Dockerfile follow-up on #114.
- This is the upload half; the cht-conf validate loop also needs `prepareTestData` (Phase 3:
  `csv-to-docs` + `upload-docs` / `create-users`) and `reset('couchdb')`. PR5's full loop is
  gated on Phase 3 too — applyConfig alone proves "fix uploads", not "symptom reproduced".
- `discoverConfig` real path (read `/api/v1/settings`, parse into `DiscoveredConfig`) is a
  natural companion to land in the same phase — it's pure `fetch`, no cht-conf, and the
  apply→verify step re-reads settings to confirm the change took.
