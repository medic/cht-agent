# Finish #66 — Test Environment Layer PR (medic/cht-agent), surgically scoped

Closes: https://github.com/medic/cht-agent/issues/66 (OPEN, no linked PR).
Rev 3 (2026-07-17): corrected after inspecting the existing worktree — the
local branch is **Phase 1 only**; phases 2–3 exist only in the workbench
lineage and must be ported (still 100% layer-scoped). Surgical rule stands:
**no cht-conf-extension code in this PR.**

## 1. Ground truth (verified in the working tree, not from reports)

- Branch `66-test-environment-layer-implementation` @ `73c0701` is checked
  out in an EXISTING worktree:
  `~/ai_medic/medic-cht-agent/cht-agent/.claude/worktrees/66-test-env`
  (this is why `git checkout 66-…` fails in the main repo — expected).
- **The branch is phases 1–2 committed, phase 3 unimplemented** (verified
  via `git log` in the worktree, 2026-07-17): `1cde62b` phase-1 review
  polish → `f954cb9` applyConfig shape → `8a974be` **phase-2 applyConfig
  real path (cht-conf runner, per-bucket spawn, status parsing)** →
  `73c0701` docs "phase 2 handoff + phase 3 scope". The agent file's
  header comment listing applyConfig as unimplemented is STALE — fix it in
  passing. Phase 3 (`discoverConfig`/`prepareTestData`/`reset-couchdb` +
  `cht-api.ts` + `test-data.ts`) exists only in the workbench lineage
  (mission 02b) and is the real port.
- **Worktree inventory result (pre-step DONE):** working tree clean except
  `M agent-memory/_skipped.ndjson` (test-run pollution — discard:
  `git -C <worktree> checkout -- agent-memory/_skipped.ndjson`). Stashes
  belong to OTHER streams — leave both; note `stash@{1}
  ("134 P0+PR1+PR2 wip (migrate to main)")` is recoverable
  **cht-conf-extension WIP**, recorded for that future PR.
- The phases-1–3 tip the workbench merge train consumed (`710a023`) was
  never synced back to this repo; the workbench then evolved the layer
  through mission-04/05. **Port source of truth = the workbench working
  tree** (`~/ai_medic/medic-cht-agent/cht-agent-workbench`, demo-final).
- Deps merged to main (`fdf4af2`): #112 (mock), #91 (recommendation),
  #133 (dockerize). Rebase precondition satisfied.
- The repo's main checkout is the LIVE `memory/promote-*` stream — do not
  touch it.

## 2. Surgical scope map

### IN #66 (all of it test-environment layer)
- Phase 1 (already on branch): provision + `waitForReady` readiness poll,
  human-gated bring-up scripts, teardown/reset printing, compose override.
- **Phase 2 (port):** `applyConfig` real path + `cht-conf-runner.ts` at
  workbench parity MINUS deferred items (see excisions): buckets incl.
  `app-settings-only`, `--` artifact filter, `AUTONOMOUS_FLAGS`,
  `minimalEnv`, `classifyChtConfOutput`, `runChtConf`, `runBucket`,
  `resolveChtConfBin` (`CHT_CONF_BIN` seam).
- **Phase 3 (port):** `discoverConfig` + `cht-api.ts` (MINUS
  `fetchFormXml`), `prepareTestData` + `test-data.ts` (whole file),
  `reset('couchdb')` real path, seeded-doc classification; types
  (Config/Discovery/Provision/Runner/apply sets, `app-settings-only`
  member; `instanceUrl` REQUIRED).
- Specs for all of the above (port the layer describes; ~180+ cases across
  agent/cht-api/cht-conf-runner/test-data specs, excised of deferred
  describes).
- Sonar/house-rule sweep of all layer files.

### PORT-WITH-EXCISIONS (strip these while porting — they are the cht-conf extension)
| Workbench source | Strip before committing to #66 |
|---|---|
| `src/agents/test-environment-agent.ts` | `verifyArtifact` (:388), `fetchDeployedFormXml` (:427), their imports (`fetchFormXml`, `verifyFormBinds` at :42-43) |
| `src/utils/cht-api.ts` | `fetchFormXml` (:118) |
| `src/utils/cht-conf-runner.ts` | offline-convert block (:255-314: `runOfflineConvert`, `createConvertSandbox`, `CONVERT_VERBS`, `SANDBOX_EXCLUDES`, `OfflineConvertOptions`), `skipValidate` handling; restore `instanceUrl` to REQUIRED in `buildExecArgs`/types |
| `src/types/index.ts` (surgical union into repo file) | VerifyArtifact* set, `QaInput`/`QaResult`/`QaTier2Result`, `XlsformBindDiff`, offline-convert optionals (:833, :841) |
| spec files | describes for the stripped exports (fetchFormXml, verifyArtifact, runOfflineConvert, createConvertSandbox, F2/F5 xform describes) |

### NOT PORTED AT ALL (whole files → cht-conf extension PR)
`xform-inspect.ts`, `config-type.ts`, `cht-conf-tier2.ts`,
`cht-conf-test-spec.ts`, `qa-workflow.ts`, `orchestrator.ts` wiring, CLI
flags. Docker/env bakes stay as-is in each repo (environment, not layer
code).

## 3. Pre-step — the existing worktree (DO THIS FIRST, operator)

The worktree may hold the uncommitted remainder of past #66 sessions:
```bash
git -C ~/ai_medic/medic-cht-agent/cht-agent/.claude/worktrees/66-test-env status --porcelain
git -C ~/ai_medic/medic-cht-agent/cht-agent/.claude/worktrees/66-test-env stash list
git -C ~/ai_medic/medic-cht-agent/cht-agent/.claude/worktrees/66-test-env log --oneline -5
```
- Uncommitted/stashed work found → review it; commit what belongs onto the
  branch (or deliberately discard) BEFORE cloning, else the clone misses it.
- Then EITHER keep the worktree parked (clone works fine alongside it) or
  `git worktree remove` it once its state is captured. The container uses a
  CLONE regardless — the hardening shadow mount needs a `.git` directory,
  which worktrees don't have.

## 4. Commit plan (in the clone; explicit staging; repo trailer; never `git add .`)

- `chore(#66): rebase onto main (deps #112/#91/#133 merged)`
- `feat(#66): phase-2 parity uplift — runner to workbench parity minus excisions (CHT_CONF_BIN pin, app-settings-only, minimalEnv/classify drift)` —
  phase 2 EXISTS on the branch (`8a974be`); this commit is a parity DIFF
  against the workbench runner, not a fresh port. Also fix the stale
  agent-header comment here.
- `feat(#66): phase 3 — discoverConfig + cht-api, prepareTestData + test-data, couchdb-tier reset`
- `test(#66): layer spec suite ported (agent, cht-api, runner, test-data)`
- `refactor(#66): sonar sweep — house rules + complexity, behavior-preserving`
- `docs(#66): handoff status, PR description, deferred cht-conf-extension map`

## 5. Execution model — containerized agent on an isolated clone

```bash
# 0. pre-step §3 first (worktree inventory / capture)

# 1. isolated clone at the 66 branch (works even while the worktree exists)
git clone ~/ai_medic/medic-cht-agent/cht-agent ~/ai_medic/medic-cht-agent/cht-agent-66 \
  -b 66-test-environment-layer-implementation

# 2. build cht-agent's own agent image
cd ~/ai_medic/medic-cht-agent/cht-agent
docker build -f docker/Dockerfile -t cht-agent-repo:local --build-arg AGENT_UID=$(id -u) .

# 3. run hardened container: clone rw, workbench ro (port source), OAuth ro
docker run -d --name cht-agent-66 --cap-drop ALL --security-opt no-new-privileges:true \
  -v ~/ai_medic/medic-cht-agent/cht-agent-66:/workspace/cht-agent-66:rw \
  -v ~/ai_medic/medic-cht-agent/cht-agent/docker/git-config.hardened:/workspace/cht-agent-66/.git/config:ro \
  -v ~/ai_medic/medic-cht-agent/cht-agent-workbench:/workspace/workbench-src:ro \
  -v ~/.claude/.credentials.json:/home/agent/.claude/.credentials.json:ro \
  cht-agent-repo:local sleep infinity
docker exec -it cht-agent-66 bash    # then run `claude` inside
```
**Known gap:** the cht-agent repo's Dockerfile predates the Claude Code CLI
bake (that layer arrived in the workbench era) — after `docker run`, install
it once into the running container (npm needs no setuid caps, unlike apt):
```bash
docker exec -u root cht-agent-66 npm install -g @anthropic-ai/claude-code
```
Re-run after any container recreate. (Alternative: use the workbench image
`cht-agent:local` with `--entrypoint sleep … infinity` — CLI baked, but the
baked ~/.claude settings are workbench-flavored.) Worth a follow-up commit
in the cht-agent repo to add the CLI layer to its Dockerfile — OUT of the
#66 PR's scope.
(Seeder-compose variant adds `gh` + auto-allow settings if preferred.
Recreate the container at session start — OAuth staleness gotcha.)

## 6. Gates

1. Node 22, `npm ci`, `npm run build && npm test && npm run lint` after
   EVERY commit.
2. Sonar, **local tokenless first pass** against `.sonarcloud.properties`;
   drive complexity findings + house rules to zero on layer files (no
   nested template literals; ≥1 assertion/test; no `any` in src/;
   `_`-prefix unused params).
3. **Excision proof:** `grep -rn "fetchFormXml\|verifyArtifact\|fetchDeployedFormXml\|runOfflineConvert\|createConvertSandbox\|skipValidate\|xform-inspect\|config-type\|cht-conf-tier2\|qa-workflow\|XlsformBindDiff" src/ test/` in the clone → must be empty.
4. **Function-parity proof:** for each ported export, a side-by-side diff
   of the function body vs the workbench source (identical modulo the
   excisions), recorded in `PR_66_DESCRIPTION.md`.
5. Manual code review by the operator; operator pushes + `gh pr create`.

## 6b. Standalone guarantee + independent demo recipe (goes in the PR body)

Zero imports from workflows/cht-conf-extension code; real-path specs mock
`fetch`/`child_process` → suite green with no instance, no Docker.
Independent cht-core demo: `scripts/test-env-up.sh <cht-core-checkout>`,
then provision → discoverConfig → applyConfig('config/default') →
prepareTestData(sample csv project) → reset('couchdb') → teardown; mock-mode
(`useMockDocker`) mirrors it CI-safe. State honestly: pipeline invocation
arrives with #64 — this PR ships the layer + direct-use surface.

## 6c. Inherited hardening follow-ups (surfaced by the provision-port verify, 2026-07-17)

The follow-up commit `16476d2` ported `provision()`'s env-seam resolver at
byte parity; its adversarial verify surfaced two coverage gaps that exist in
the WORKBENCH source too (`src/agents/test-environment-agent.ts:258,270-272`)
and were deliberately NOT patched in the port (byte-parity guarantee).
Fix in the workbench first, then flow to cht-agent via the
cht-conf-extension PR's parity refresh — never diverge silently:

- **Malformed non-blank `CHT_URL`** (e.g. missing scheme) → unguarded
  `new URL()` `TypeError`. Loud and immediate, but names neither the value
  nor the seam. Fix: wrap and rethrow
  `provision: invalid instance URL '<value>' (from options.url or CHT_URL)`.
- **`COUCHDB_USER` set with `COUCHDB_PASSWORD` unset** → silently ignored
  (env-auth gate is password-presence; the `?? DEFAULT_AUTH.user` branch is
  untested). A lone username can't authenticate anyway, so falling through
  to defaults is right — the fix is a `console.warn` on that condition plus
  a spec pinning it. Real-world window is small (compose and
  `test-env-up.sh` always export both).

Neither blocks the #66 PR; both are one-liners with one spec each.

**PR #144 sonar round (2026-07-17):** SonarCloud's quality gate PASSED but the
analysis check flagged 8 layer functions over the repo's S3776 threshold of 5
(prepareTestData 26, classifySeededDocs 12, resetCouchdbTier 11, waitForReady
10, provision 8, parseRoles 8, runBucket 7, reset 6) plus mechanical warnings
(FORM_BUCKETS→Set, 5-param `request`, `/\/+$/` backtracking, chai dedicated
matchers ×8, one loose throw assert). The refactor commit lands in the CLONE;
the workbench layer files must be MIRRORED afterwards (post-merge is fine)
before the cht-conf-extension PR is cut, or its diffs will be noisy. The two
hardening one-liners above should ride that mirror, not the sonar commit.

## 7. PR description skeleton

Title: `feat(#66): Test Environment Layer — provisioning, config discovery, test data, config apply`
Body: issue scope §§1–5 → implementation map; evidence: this layer (at
workbench parity) drove the closed-loop demo's QA phase live; test surface
counts; env seams (`CHT_URL`/`COUCHDB_*`, `CHT_CONF_BIN`,
`TEST_ENV_MOCK_DOCKER`, `CHT_TEST_DATA_PATH`, human-gated
`test-env-up.sh`); the deferred cht-conf-extension map (§2) verbatim so the
boundary is visible; excision + parity proofs; Closes #66; enables #64.

## 8. Agent kickoff prompt (paste into claude INSIDE the cht-agent-66 container)

> You are finishing the Test Environment Layer PR for
> https://github.com/medic/cht-agent/issues/66. You are in a hardened
> container: the repo clone is at `/workspace/cht-agent-66` (branch
> `66-test-environment-layer-implementation` checked out — it is PHASE 1
> ONLY) and the READ-ONLY workbench source is at `/workspace/workbench-src`.
> The binding plan is
> `/workspace/workbench-src/docs/handoffs/66-pr-completion-plan.md` — read
> it fully first, then `HANDOFF_66_test_environment.md` in the clone
> (locked decisions + conventions are binding).
>
> STEP 0: `git status --porcelain`, `git stash list`, `git log --oneline -5`
> in the clone; confirm the tip and report anything unexpected before
> proceeding. (The operator already reconciled the old worktree's state —
> if the log disagrees with the plan's assumptions, STOP and say so.)
>
> WORK ORDER = plan §4 commits, scope = plan §2 EXACTLY:
> C0 rebase onto main (favor branch content; suite green).
> C1 phase 2: port applyConfig + cht-conf-runner from
> `/workspace/workbench-src/src/utils/cht-conf-runner.ts` WITH THE
> EXCISIONS (no offline-convert block, no skipValidate, `instanceUrl`
> REQUIRED; keep buckets incl. app-settings-only, artifact filter,
> AUTONOMOUS_FLAGS, minimalEnv, classify, runChtConf, runBucket,
> resolveChtConfBin) + agent.applyConfig + types + spec describes (minus
> excised ones).
> C2 phase 3: port cht-api.ts (WITHOUT fetchFormXml), test-data.ts (whole),
> agent discoverConfig/prepareTestData/reset-couchdb real paths (WITHOUT
> verifyArtifact/fetchDeployedFormXml and their imports) + types + specs.
> C3 spec suite green; C4 sonar sweep (local tokenless scan vs
> .sonarcloud.properties; complexity + the four house rules,
> behavior-preserving only); C5 docs: HANDOFF_66 status update +
> PR_66_DESCRIPTION.md per plan §7 with the excision-grep proof (plan §6.3)
> and per-function parity diffs.
>
> After EVERY commit: Node 22, `npm run build && npm test && npm run lint`.
> Explicit staging only (never `git add .`); repo co-author trailer; NEVER
> push. Hand back with commits, gate results, and flags.

