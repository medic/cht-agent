# Demo runbook — the closed loop (research → fix → QA)

The exact operator sequence for demo day, with the expected output captured per
step. The demo drives `tickets/demo-pnc-relevant.md` against `demo/config-pnc-demo`
(cht-core 5.2.0 `config/default` with **one** planted `relevant` bug in
`pregnancy_home_visit`: the `danger_signs` group is shown for a *miscarriage*
outcome; see `demo/config-pnc-demo/PLANTED-BUG.md`).

**Legend:** `[OPERATOR]` = a human step (bring-up, credentials, image build).
`[AGENT]` = the agent runs it. Steps whose real execution needs a live instance
or Claude OAuth are marked **operator-verified** and were NOT executed in the
mission-04 rehearsal (they have no runnable output to capture in-container).

The one-line closed loop is: **reproduce (red) → apply fix → verify (green)**.
CHT docs require a bug fix start from a failing test — *"at least one test should
fail before the fix; it should pass after"* — so the QA phase runs the SAME
content check before and after the fix and reports the transition.

---

## 0. Prerequisites (once)

```bash
npm ci            # Node 22; installs deps (see the harness/Chromium note in step 6b)
npm run build && npm test && npm run lint
```

Expected (rehearsed this mission): **1351 passing / 0 failing**, build clean,
`eslint .` clean. (The tier-2 harness spec `test/harness/**` is excluded from
this suite — it needs Chromium; see step 6b.)

---

## 1. [OPERATOR] Bring up a version-matched CHT instance

Stand up CHT on the shared `cht-agent-net` Docker network so the agent reaches
it at `https://nginx` (self-signed cert). Layer the override onto cht-core's
compose (`docker/cht-agent-net.override.yml`). Match the site's cht-core minor
where feasible (the demo config is 5.2.0).

```bash
# HUMAN, in the cht-core checkout:
docker compose -f cht-couchdb.yml -f cht-core.yml \
  -f <this-repo>/docker/cht-agent-net.override.yml up -d
curl -k https://localhost/api/v2/monitoring          # readiness (no auth required)
```

Verify nginx is on `cht-agent-net`. `/api/v2/monitoring` needs **no auth** and is
the readiness probe the agent polls (`version`, `date.uptime`).

## 2. [OPERATOR] Seed "broken prod"

Mount the demo (or reconstructed) config at `CHT_CONF_PATH` and upload it to the
instance so the miscarriage symptom is LIVE, then seed dummy data. The
`app-settings` bucket compiles first, which needs the full source tree +
`.eslintrc`; the demo config has a pre-compiled `app_settings.json`, so for it
drive `upload-app-settings` alone (see `demo/site-reconstruction/README.md` §2a).

```bash
URL='https://medic:password@nginx'
FLAGS='--force --skip-git-check --skip-version-check --skip-dependency-check --skip-translation-check --accept-self-signed-certs'
cht --url=$URL --source=$CHT_CONF_PATH $FLAGS upload-app-settings convert-app-forms upload-app-forms
# dummy data — build CSVs from a scrubbed export, then upload:
npm run demo:build-seed -- --export <export.json> --app-settings $CHT_CONF_PATH/app_settings.json --users <users.json> --out $CHT_TEST_DATA_PATH
cht --url=$URL --source=$CHT_TEST_DATA_PATH $FLAGS csv-to-docs upload-docs create-users
```

`demo:build-seed` was rehearsed on `demo/site-reconstruction/sample/` →
7 contacts across 4 types (district_hospital → health_center → clinic → person),
3 reports (assessment, pregnancy), a 2-row `users.csv`; the emitted CSVs match
the `app_settings` `contact_types` hierarchy. (Alternative data tool:
`medic/test-data-generator` — a JS+Faker design file that pushes docs directly to
`COUCH_URL`, no CSV; noted in `demo/site-reconstruction/README.md`.)

## 3. [OPERATOR] Rebuild + start the agent runtime

Rebuild the runtime image from this integration branch and start it with the
CLI provider + OAuth mount + instance env:

```bash
# docker-compose.cht-agent.yml with:
LLM_PROVIDER=claude-cli
ANTHROPIC_MODEL=claude-opus-4-8      # override so the run does not burn the Fable session budget
CHT_URL=https://nginx
CHT_CONF_PATH=/path/to/demo/config-pnc-demo   # the corrected config lands here (A1)
CHT_CORE_PATH=/path/to/cht-core               # required by full.ts; provisioning source
CANONICAL_CONF=/path/to/unplanted/config-default   # baseline for canonical-diff (see step 4)
# for the QA phase (step 6): CHT_TEST_DATA_PATH=/path/to/seed-project (optional)
```

## 4. [AGENT] Research → **HC1**

```bash
docker exec … npm run research tickets/demo-pnc-relevant.md
```

- **Ticket routing (no LLM).** All routing comes from frontmatter — rehearsed:
  ```
  domain: forms-and-reports | layer: cht-conf | configArtifact: form
  artifactName: pregnancy_home_visit | chtConfVersion: 6.5.0 | deploymentRef: demo/config-pnc-demo
  ```
  `layer: cht-conf` routes to the config layer and targets the `cht-conf-wiki`
  corpus; frontmatter wins over inference (no LLM call needed to route).
- **Canonical diff** pinpoints the drift. Against the unplanted baseline
  (`CANONICAL_CONF`, the un-planted `config/default`), the diff isolates exactly
  the `danger_signs` `relevant` (rehearsed via `diffAgainstCanonical`):
  ```
  status: differs  —  forms/app/pregnancy_home_visit.xml
  - <bind nodeset="/data/danger_signs" relevant="selected(../pregnancy_summary/visit_option, 'yes')"/>
  + <bind nodeset="/data/danger_signs" relevant="selected(../pregnancy_summary/visit_option, 'yes') or selected(../pregnancy_summary/visit_option, 'miscarriage')"/>
  ```
  Standalone inspection (baseline = the unplanted `config/default`):
  ```bash
  CHT_CONF_PATH=demo/config-pnc-demo CANONICAL_CONF=<unplanted> \
  node -e "console.log(require('./dist/utils/canonical-diff').diffAgainstCanonical({artifact:'form',artifactName:'pregnancy_home_visit'}))"
  ```
- **HC1** — approve research (or feed back). **operator-verified** end-to-end
  (a full `npm run research` needs Claude OAuth; nested `claude -p` works in the
  container but burns session budget — run it live with the model override above).

## 5. [AGENT] Development → **HC2**

```bash
docker exec … npm run full tickets/demo-pnc-relevant.md --qa
```

(Preview mode is prompted interactively at the start — answer yes to review the
diff at HC2; `--qa` is the only workflow flag, plus `--qa-auto` to auto-approve HC3.)

- Code-gen consumes `codeContextFindings` and produces the corrected `relevant`.
- **A1 routing:** because `layer: cht-conf`, the fix is generated in and written
  to the `CHT_CONF_PATH` project (not the cht-core working copy). The CLI prints
  `🎯 layer: cht-conf → development target: <CHT_CONF_PATH> (cht-conf)`.
- Compile/convert validation runs; **HC2** approve the preview diff (the
  `danger_signs` bind restored to `selected(../pregnancy_summary/visit_option, 'yes')`).

## 6. [AGENT] QA closed loop → **HC3** (opt-in via `--qa`)

Shown as red → green. `--qa` only fires for `layer: cht-conf`; cht-core runs are
unchanged. Order (forced by the API — `prepareTestData` needs a discovered
config — and by red-before-approve):

1. **provision** — poll `https://nginx/api/v2/monitoring` until healthy.
2. **discoverConfig (pre)** — capture each form's CouchDB rev.
3. **reproduce (RED)** — `verifyArtifact` against the AS-DEPLOYED form. It MUST
   fail in the buggy direction, else QA aborts ("symptom did not reproduce …").
   Rehearsed (tier-1) against the planted form:
   ```
   RED (planted): passed = false
     FAIL /data/danger_signs
        expected: selected(../pregnancy_summary/visit_option, 'yes')
        actual  : selected(../pregnancy_summary/visit_option, 'yes') or selected(../pregnancy_summary/visit_option, 'miscarriage')
     siblings (safe_pregnancy_practices, summary) unchanged & passing: true
   ```
4. **HC3** — gate the destructive seed + apply (only reached once red is
   confirmed). Decline aborts with nothing applied. `--qa-auto` auto-approves for
   unattended runs.
5. **prepareTestData** — seed dummy data (skipped if no `CHT_TEST_DATA_PATH`;
   tier-1 verify is content-only).
6. **applyConfig** — upload the corrected form: `app-forms` bucket, artifact
   `pregnancy_home_visit` (expected cht-conf `convert-app-forms`/`upload-app-forms`
   lines, exit 0).
7. **discoverConfig (post)** — the form's rev changes (corroboration).
8. **verify (GREEN)** — `verifyArtifact` against the deployed form MUST pass.
   Rehearsed (tier-1) against the corrected form:
   ```
   GREEN (corrected): passed = true (10 binds all match)
   ```

**QaResult** carries BOTH the red and green evidence + the pre/post rev diff, so
the report shows the transition, not just a final pass.

### 6b. Tier-2 (headless Enketo) — the real skip-logic proof — **operator/CI-verified**

`test/harness/pregnancy-home-visit.spec.ts` (excluded from the default suite;
run with `npm run test:harness`) drives real Enketo via `cht-conf-test-harness`:
`fillForm(..., visit_option=miscarriage)` must SKIP `danger_signs` on the
corrected config (green) and SHOW it on the planted config (red); `visit_option=yes`
shows it on both (no regression). **Not run in the mission-04 container** — the
harness pulls `puppeteer-chromium-resolver`, which downloads **Chromium 93** on
`npm ci`; the workbench has no Chromium. To enable: add Chromium + the puppeteer
Debian libs to the runtime/CI image (no `Dockerfile.workbench` exists to edit —
this stays an operator/CI step), then `npm run test:harness`. Also note: harness
5.0.4 bundles **only cht-core 4.11** (`coreVersion` must be `'4.11.0'`; 5.x
throws) — the `relevant` skip-logic reproduces under 4.11 emulation, but that
version gap is a known caveat.

### 6c. Tier-3 (live end-to-end submission) — headline, **operator-verified, optional**

Proves a report can be filed against the seeded contact/user (does NOT exercise
Enketo skip-logic — tier 2 owns that). As an online user with `can_create_records`:

```bash
curl -sS -u "$CHT_USER:$CHT_PASS" -H 'Content-Type: application/json' \
  -X POST "https://nginx/api/v1/report" \
  -d '{"form":"pregnancy_home_visit","type":"data_record","contact":"<seeded-contact-uuid>","fields":{"visit_option":"miscarriage"}}'
```

Route verified against cht-core: `POST /api/v1/report` (no trailing slash),
`hasAny:[can_create_records, can_edit]` + `isOnline:true`; `contact` is a
contact UUID; `type` if present must be `data_record`; the server bypasses the
XForm (no `relevant` evaluation).

## 7. [AGENT] Report + teardown

Pass checklist: routing ✓, canonical-diff ✓, **reproduced/red ✓**, generated
fix ✓, upload exit 0 ✓, XML assertion (siblings unchanged) ✓, **harness
red→green ✓** (operator/CI), tier-3 filing (optional). Then `[OPERATOR]` teardown
(`docker compose down -v`).

---

## Interactive alternative — `medic/cht-ai-tools`

Additive, not required by the closed loop (see the mission-04 report §A4). For a
live audience you MAY install the companion layer and use its `/deploy` localhost
UI as a human-friendly deploy surface (credentials entered in-browser, SSE log
stream) instead of the headless `applyConfig`, and `/create-form --compare
design.xlsx form.xlsx` to narrate design-vs-current drift. Install:
`npx @medic/cht-ai-tools install` (or `/plugin marketplace add medic/cht-ai-tools`;
the form-builder pieces are on the `feat/add-cht-form-builder` branch, unmerged).
The surgical `relevant` fix stays with our code-gen layer; the automated QA loop
stays with our agent.
