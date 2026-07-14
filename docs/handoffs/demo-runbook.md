# Demo runbook — the closed loop (research → fix → QA)

The exact operator sequence for demo day, with the expected output captured per
step. **Version policy: the demo runs at live-site parity** — cht-conf **3.21.4**
(the config repo's own `package.json` pin; never the workbench-global cht-conf)
and cht-core **4.21.1** (the site's custom build, image built locally in step 1).
The primary drive is the live project's config repo (working copy at
`/workspace/site-config-test`, ticket `demo-echis-pnc-ticket.md` therein; its
`DEMO-STEPS.md` is the engagement-specific walkthrough this runbook generalises).
`tickets/demo-pnc-relevant.md` + `demo/config-pnc-demo` (a cht-core 5.2.0
`config/default` with **one** planted `relevant` bug in `pregnancy_home_visit`:
the `danger_signs` group is shown for a *miscarriage* outcome; see
`demo/config-pnc-demo/PLANTED-BUG.md`) remain the self-contained stand-in when no
live config directory is available — note the stand-in predates the version
policy and was rehearsed with the workbench cht-conf.

### The goal — reconstruct a live project, don't break production

We never touch the live project's instance or data. The operator provides
**read-only downloads of the live project's current config** (`backup-app-settings`
+ `backup-all-forms`) in a local directory. That config **already contains the
real bug** — we reconstruct it faithfully on a **throwaway test instance** and fill
it with **dummy data that conforms to the live `app_settings` hierarchy**, so the
symptom reproduces exactly as it does in production while real contacts, hierarchy,
roles and users are never involved. The loop then reproduces the symptom, generates
the change, uploads the *new* config, verifies it behaves better than the live
config did, and **reports the required change back to the operator** to apply on the
real project themselves. `demo/config-pnc-demo` is the stand-in for such a
downloaded live config; its planted `danger_signs` bug stands in for the real bug.

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
npm ci            # Node 22; installs deps incl. cht-conf-test-harness (its
                  # resolver downloads Chromium 93 on install — see step 6b)
npm run build && npm test && npm run lint

# once, in the live config repo (installs its OWN pinned toolchain —
# cht-conf 3.21.4 + cht-conf-test-harness 3.0.15):
cd /workspace/site-config-test && npm ci
```

**Mission-05 prerequisites (blocking — the dev phase dies without them):**

- **Branch + image**: the workbench checkout (and the image built from it,
  step 3) must carry Mission 05 (`feat/mission-05-xlsform-orchestrator`, or
  a branch it's merged into). Mission 05 adds **exceljs** as a production
  dependency — a stale image/`node_modules` crashes at `require('exceljs')`.
  Re-run `npm ci` after switching branches; rebuild the image.
- **The config mount must be a git repo with ≥1 commit** (`git init && git
  add -A && git commit` in the `CHT_CONF_PATH` dir, host-side, remote-less):
  the code-gen CLI snapshots/rolls back via git, and the fix descriptor rides
  the git-diff capture.
- **`.cht-agent/` must NOT be gitignored** in the config repo — the
  descriptor is the CLI's only output; if git can't see it the run aborts as
  `execute-no-op`. (The demo stand-in and the engagement repo have no
  `.gitignore` covering it; check real partner repos.)
- **Converter pin**: `CHT_CONF_BIN` should point at the deployment-pinned
  cht-conf (compose defaults to the mount's `node_modules/.bin/cht`; the
  stand-in fixture is proven with the workbench-global 6.5.0 — for it,
  override `CHT_CONF_BIN=cht`). Independent of the tier-2 harness's
  cht-core-4.11 emulation pin.
- **Ticket frontmatter** must carry `layer: cht-conf`, `configArtifact:
  form`, `artifactName: <form>`, `chtConfVersion`, `deploymentRef` (see
  `tickets/demo-pnc-relevant.md`).

Expected (rehearsed this mission): **1351 passing / 0 failing**, build clean,
`eslint .` clean. (The tier-2 harness spec `test/harness/**` is excluded from
this suite — it needs Chromium and runs separately via `npm run test:harness`;
the agent container has Chromium baked in, see step 6b.)

---

## 1. [OPERATOR] Bring up a version-matched CHT instance (build cht-core 4.21.1 locally)

Stand up CHT **at the live site's cht-core version (4.21.1)** on the shared
`cht-agent-net` Docker network so the agent reaches it at `https://nginx`. The
live site runs a **custom 4.21.1 build** (`4.21.1-…-sync-interval-30…`), so the
test image is built locally from that cht-core checkout — pulling stock images
alone won't reproduce a fork's behaviour. (All commands verified against the
cht-core `4.21.1` tag, commit `f022853`.)

**1a — build the local images.** In the site's cht-core checkout (the 4.21.x
fork, or the `4.21.1` tag if the site's changes don't affect the demo path).
Needs Node ≥ 22.15.0, npm ≥ 10.9.0, and docker compose **v2**:

```bash
# HUMAN, in the cht-core 4.21.x checkout:
npm ci
npm run build                # compiles webapp/admin/ddocs — REQUIRED first:
                             # local-images only copies prebuilt static artifacts
export VERSION=4.21.1        # ⚠️ see version gotcha below
npm run local-images         # builds 6 images (api, sentinel, couchdb, haproxy,
                             # haproxy-healthcheck, nginx) tagged
                             # medicmobile/cht-*:4.21.1 AND renders compose files
                             # into local-build/ (cht-core.yml, cht-couchdb.yml)
```

**Version gotcha (`scripts/build/versions.js`):** the tag is resolved from
`TAG` → `BRANCH` → `VERSION` → current git branch. A tag checkout is detached
HEAD, so with nothing set the images get an **empty tag**; with `TAG=4.21.1`
the images get `4.21.1.undefined` while the compose files say `4.21.1`
(mismatch — compose won't find the images). **`export VERSION=4.21.1` is the
correct pin** — images and compose then agree. A named branch checkout works
too (branch name becomes the tag). Local builds are single-platform (host
arch); on ARM hosts the images are arm64-only.

**1b — compose up with the cht-agent-net override.** Layer
`docker/cht-agent-net.override.yml` (it joins the `nginx` service to the
external `cht-agent-net` network; the stack's internal network default
`cht-net` matches the override):

```bash
# HUMAN, in the cht-core checkout:
cd local-build
cat > .env <<EOF
COUCHDB_USER=medic
COUCHDB_PASSWORD=password
COUCHDB_SECRET=$(openssl rand -hex 16)
COUCHDB_UUID=$(openssl rand -hex 16)
NGINX_HTTP_PORT=10080
NGINX_HTTPS_PORT=10443
EOF
# COUCHDB_PASSWORD is mandatory (compose fails fast without it); the non-default
# NGINX ports avoid host 80/443 collisions.
docker compose --env-file ./.env -f cht-core.yml -f cht-couchdb.yml \
  -f <cht-agent>/docker/cht-agent-net.override.yml up -d
curl -k https://localhost:10443/api/v2/monitoring   # readiness (no auth required)
#   expect: version.app ≈ 4.21.1 (the custom build's version string)
```

Verify nginx is on `cht-agent-net` (`docker network inspect cht-agent-net`).
`/api/v2/monitoring` needs **no auth** and is the readiness probe the agent
polls (`version`, `date.uptime`) — from the agent's side the instance is
`https://nginx` (internal port 443; the host-port remap doesn't apply on the
docker network).

**Fallback — stock 4.21.1, no custom changes:** official images exist on
`public.ecr.aws/medic/cht-*:4.21.1`; fetch the published compose files and
bring up the same way (same `.env`, same override layering):

```bash
curl -s -o cht-core.yml    "https://staging.dev.medicmobile.org/_couch/builds_4/medic:medic:4.21.1/docker-compose/cht-core.yml"
curl -s -o cht-couchdb.yml "https://staging.dev.medicmobile.org/_couch/builds_4/medic:medic:4.21.1/docker-compose/cht-couchdb.yml"
```

**TLS.** nginx presents either a **self-signed** cert or a **local-IP
service-signed** cert (a local CA). cht-conf trusts it with
`--accept-self-signed-certs`. The agent's own `fetch` (readiness poll,
`discoverConfig`, `verifyArtifact`/`fetchFormXml`) does **no** self-signed handling
by design, so set one of these on the agent process (step 3):
- self-signed → `NODE_TLS_REJECT_UNAUTHORIZED=0`, or
- local-IP service-signed → `NODE_EXTRA_CA_CERTS=/path/to/local-ca.crt` (preferred —
  keeps verification on).

## 2. [OPERATOR] Reconstruct the live project on the test env (config + dummy data)

Reconstruct the live project's *current* (buggy) state on the throwaway test
instance, with dummy data — never the live instance or its data. Two sub-steps.

**2a — obtain the live config into a local dir (`CHT_CONF_PATH`).** Two handover
forms, preferred first:

- **Full cht-conf source project** (this engagement): the partner's config repo
  working copy — `/workspace/site-config-test` — with its own `package.json`
  pinning `cht-conf 3.21.4`. Nothing to download; that directory is the
  host-side `CHT_CONF_PATH` (step 3 mounts it at `/workspace/cht-conf-project`
  inside the agent container).
- **Read-only backups** (only instance access, no source repo). Run against the
  LIVE project — no writes — and hand over the resulting directory:

```bash
# [OPERATOR] on the LIVE project — read-only backups, no writes:
cht --url=<live-admin-url> --accept-self-signed-certs backup-app-settings   # → app_settings.json (compiled, running state)
cht --url=<live-admin-url> --accept-self-signed-certs backup-all-forms      # → forms/app/*.xml (deployed XForms)
```

(For the stand-in demo, `CHT_CONF_PATH=demo/config-pnc-demo`.)

**2b — upload from the cht-conf project directory to the TEST env + seed dummy
data.** Always drive the upload with the **project's own pinned cht-conf**
(`./node_modules/.bin/cht` after step 0's `npm ci` — 3.21.4 here), never the
workbench-global cht-conf: the config was authored and compiled against that
version, and the upload then exercises exactly what production ran.

*Source-project path (preferred — full compile + convert from source):*

```bash
cd $CHT_CONF_PATH                      # e.g. /workspace/site-config-test
CHT=./node_modules/.bin/cht            # the repo-pinned cht-conf 3.21.4
URL='https://medic:password@nginx'
FLAGS='--force --skip-git-check --skip-version-check --skip-dependency-check --skip-translation-check --accept-self-signed-certs'
$CHT --url=$URL --source=. $FLAGS compile-app-settings upload-app-settings
$CHT --url=$URL --source=. $FLAGS convert-app-forms upload-app-forms
$CHT --url=$URL --source=. $FLAGS convert-contact-forms upload-contact-forms
$CHT --url=$URL --source=. $FLAGS upload-resources upload-custom-translations
# NOTE: deliberately NOT running upload-branding (keeps CHT-default branding on
# the throwaway env; the working copy is neutralized — no OIDC/outbound/env.*).
```

*Backup-only path (no source tree): the downloaded `app_settings.json` is
**already compiled** — upload it verbatim, do **not** recompile (recompiling
would clobber the minified contact-summary/tasks/targets; see
`demo/site-reconstruction/README.md` §2a and the `app-settings-only` bucket).
Backed-up forms are `.xml` already, so no convert:*

```bash
$CHT --url=$URL --source=$CHT_CONF_PATH $FLAGS upload-app-settings upload-app-forms
#   (demo stand-in has the .xlsx too → use: upload-app-settings convert-app-forms upload-app-forms)
```

*Then seed dummy data conforming to the live `app_settings` contact hierarchy
(behaviour matches production; no real contacts/hierarchy/roles/users). Create
at least one **password** user with a role that can submit the affected form:*

```bash
npm run demo:build-seed -- --export <scrubbed-export.json> --app-settings $CHT_CONF_PATH/app_settings.json --users <users.json> --out $CHT_TEST_DATA_PATH
$CHT --url=$URL --source=$CHT_TEST_DATA_PATH $FLAGS csv-to-docs upload-docs create-users
```

The test env now mirrors the live project's behaviour — the symptom reproduces
as-is — but on dummy data. `demo:build-seed` was rehearsed on
`demo/site-reconstruction/sample/` → 7 contacts across 4 types (district_hospital
→ health_center → clinic → person), 3 reports (assessment, pregnancy), a 2-row
`users.csv`; the emitted CSVs match the `app_settings` `contact_types` hierarchy.
(Alternative data tool for plausible *volume*: `medic/test-data-generator` — a
JS+Faker design file that pushes docs directly to `COUCH_URL`, no CSV; noted in
`demo/site-reconstruction/README.md`.)

## 3. [OPERATOR] Rebuild + start the agent runtime

Rebuild the runtime image from the branch carrying **Mission 05**
(`feat/mission-05-xlsform-orchestrator`, or this integration branch once it's
merged — see the step-0 prerequisites; exceljs must be in the image) and
start it with the CLI provider + OAuth mount + instance env:

```bash
# HOST side — mount sources consumed by docker-compose.cht-agent.yml. The
# config repo mounts rw at /workspace/cht-conf-project inside the container;
# run its `npm ci` (step 0) BEFORE `up` so the pinned cht-conf rides the mount:
CHT_CORE_PATH=/path/to/cht-core-4.21-checkout  # → /workspace/cht-core (the checkout step 1 built images from)
CHT_CONF_PATH=/workspace/site-config-test      # → /workspace/cht-conf-project (the live buggy config repo from step 2a)
# CANONICAL_CONF=<container-visible path>      # optional; compose defaults it to
#   /workspace/cht-core/config/standard. For a real (un-planted) bug there is no
#   known-good baseline — reproduce→verify (step 6) is the authoritative proof.

# CONTAINER side — the agent process env. Compose hard-sets the paths (the agent
# always sees the config at /workspace/cht-conf-project regardless of the host
# dir). The values below are compose DEFAULTS since the demo env block landed
# (docker-compose.cht-agent.yml `environment:`) — export a host-side env var of
# the same name only to override one:
LLM_PROVIDER=claude-cli
ANTHROPIC_MODEL=claude-opus-4-8      # override so the run does not burn the Fable session budget
CHT_URL=https://nginx                # compose default
NODE_EXTRA_CA_CERTS=/path/to/local-ca.crt   # local-IP service-signed cert; OR NODE_TLS_REJECT_UNAUTHORIZED=0 for self-signed
CHT_CONF_PATH=/workspace/cht-conf-project    # set by compose — Development writes the fix here (A1)
CHT_CONF_BIN=/workspace/cht-conf-project/node_modules/.bin/cht  # ← version parity: every agent
#   cht-conf invocation (QA applyConfig, step 6) runs the deployment-pinned 3.21.4 that
#   `npm ci` installed into the MOUNTED config repo — not the image's global cht-conf.
#   (Compose default since the demo env block landed — override only to repoint it.)
# for the QA phase (step 6): CHT_TEST_DATA_PATH=<container-visible path> (optional; needs its own mount)
```

## 4. [AGENT] Research → **HC1**

```bash
docker exec -it cht-agent npm run research -- tickets/demo-pnc-relevant.md
```

(Positional args survive npm without the `--`; flags do NOT — see the warning
at step 5. The `--` habit is safest everywhere.)

- **Ticket routing (no LLM).** All routing comes from frontmatter — rehearsed:
  ```
  domain: forms-and-reports | layer: cht-conf | configArtifact: form
  artifactName: pregnancy_home_visit | chtConfVersion: 6.5.0 | deploymentRef: demo/config-pnc-demo
  ```
  `layer: cht-conf` routes to the config layer and targets the `cht-conf-wiki`
  corpus; frontmatter wins over inference (no LLM call needed to route). On the
  live path the engagement ticket reads
  `artifactName: postnatal_care_service | chtConfVersion: 3.21.4 |
  deploymentRef: /workspace/cht-conf-project` — same routing, real bug
  (`deploymentRef` is informational metadata; it names the config's path as
  the agent sees it, i.e. the container mount).
- **Canonical diff** pinpoints the drift when a matched reference baseline is
  available (`CANONICAL_CONF`; demo: the un-planted `config/default`; a real site:
  a known-good reference or a prior config version). With that baseline the diff
  isolates exactly the `danger_signs` `relevant` (rehearsed via
  `diffAgainstCanonical`) — it is a research aid; the reproduce→verify content
  assertion (step 6) is the authoritative red→green proof:
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

## 5. [AGENT] Development → **HC2** (Mission 05: the fix lands in the `.xlsx` source)

```bash
docker exec -it cht-agent npm run full -- tickets/demo-pnc-relevant.md --qa
```

**⚠️ The `--` is load-bearing.** npm (v7+) silently swallows unknown flags
before `--`: `npm run full tickets/… --qa` runs WITHOUT QA (verified against
npm 10.9 — the flag never reaches the CLI, no warning). Always
`npm run full -- <ticket> --qa`. Same for `--qa-auto` (auto-approve HC3 for
unattended runs) and `--qa-tier2` (F7: after tier-1 GREEN, QA also runs the
affected form's generated `cht-conf-test-harness` spec with the repo-pinned
mocha — baked Chromium serves it — and `succeeded` requires it to pass).
Dev-only preview with no QA: `npm run dev:run -- <ticket>` (always preview
mode). Preview mode in `full` is prompted interactively at the
start — answer **yes** to review the diff at HC2.

Since **Mission 05** (`feat/mission-05-xlsform-orchestrator`;
`docs/handoffs/missions/05-xlsform-orchestrator-editor-report.md`), a
`layer: cht-conf` + `configArtifact: form` ticket fixes the **`.xlsx` source
of truth**, not just the XML:

- **A1 routing** unchanged: the CLI prints
  `🎯 layer: cht-conf → development target: <CHT_CONF_PATH> (cht-conf)`.
- The code-gen CLI (file tools only, no Bash) writes exactly ONE file:
  `.cht-agent/xlsform-fix.json` — a structured fix descriptor (form, survey
  edits, and an `expect` oracle for the target bind). It never edits the
  `.xlsx`/`.xml` itself.
- A deterministic supervisor node applies the descriptor to a **temp copy**
  of the config project (exceljs, shared-string-safe), runs an **offline**
  `convert-app-forms -- <form>` (the `CHT_CONF_BIN`-pinned cht-conf, no
  `--url`), and asserts the regenerated bind matches the descriptor's
  `expect` — failure feeds back into the code-gen refinement loop (≤3
  iterations) instead of reaching HC2.
- **HC2** shows a **bind-level diff** (`/data/… before → after, N sibling
  binds unchanged`), not a whole-file XML diff. Approve → the corrected
  **`.xlsx` AND regenerated `.xml`** are written to the mount (`.cht-agent/`
  is never copied to the partner repo). The corrected `.xlsx` is a partner
  handback artifact.

## 6. [AGENT] QA closed loop → **HC3** (opt-in via `--qa`)

Shown as red → green. `--qa` only fires for `layer: cht-conf`; cht-core runs are
unchanged. Since Mission 05 the `app-forms` bucket (`convert-app-forms` +
`upload-app-forms`) is **unchanged and legitimate**: convert regenerates the
XML from a workbook that already carries the fix, so nothing is clobbered —
instance and source stay in lockstep. Order (forced by the API —
`prepareTestData` needs a discovered config — and by red-before-approve):

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
   lines, exit 0). With `CHT_CONF_BIN` set (step 3) this runs the
   deployment-pinned cht-conf 3.21.4 — the same version that authored the
   config — not the workbench-global cht-conf.
7. **discoverConfig (post)** — the form's rev changes (corroboration).
8. **verify (GREEN)** — `verifyArtifact` against the deployed form MUST pass.
   Rehearsed (tier-1) against the corrected form:
   ```
   GREEN (corrected): passed = true (10 binds all match)
   ```

**QaResult** carries BOTH the red and green evidence + the pre/post rev diff, so
the report shows the transition, not just a final pass.

### 6b. Tier-2 (headless Enketo) — the real skip-logic proof — **runs in the agent container**

`test/harness/pregnancy-home-visit.spec.ts` (excluded from the default suite;
run with `npm run test:harness`) drives real Enketo via `cht-conf-test-harness`:
`fillForm(..., visit_option=miscarriage)` must SKIP `danger_signs` on the
corrected config (green) and SHOW it on the planted config (red); `visit_option=yes`
shows it on both (no regression).

**In-container support is baked into the runtime image** (`docker/Dockerfile`):
the puppeteer Debian shared libs are in the root apt layer, and the
**Chromium 93 (rev 901912)** snapshot that `puppeteer-chromium-resolver`
downloads during the image's `npm ci` is relocated to
`/home/agent/.chromium-browser-snapshots` (the build runs as root; the runtime
`agent` user's resolver only looks in its own home — the resolver reads **no
env vars**, so `PUPPETEER_EXECUTABLE_PATH`/distro chromium are not options).
A fail-closed launch check at image build proves the lib set + snapshot as the
agent user, so a successful build guarantees the capability:

```bash
docker exec cht-agent bash -lc 'cd /app && npm run test:harness'
```

The same baked snapshot serves the live config repo's own pinned harness
**3.0.15** (both harnesses pin resolver `^10` → same revision) — so the agent
can also run Enketo-level checks from inside `/workspace/cht-conf-project`
(its toolchain lands there via step 0's `npm ci`, riding the mount).

Caveats: the workbench harness 5.0.4 bundles **only cht-core 4.11**
(`coreVersion` must be `'4.11.0'`; higher versions throw) — the `relevant`
skip-logic reproduces under 4.11 emulation, but it is not the target 4.21.1.
**Known gap (follow-up):** the spec's per-page `PAGES_*` answer arrays are
incomplete — the suite launches Chromium and exercises real Enketo but
currently fails on `enketo.constraint.required` (required questions the arrays
never answer: `miscarriage_date`, `g_age_correct`, the 11 danger-signs
checks) before reaching the `danger_signs` assertion. Completing them also
needs planted vs corrected page sets to differ: the planted bug adds a
required 11-question page on the miscarriage path, so one shared array can
never submit on both configs.

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

### 6d. Manual browser proof — see the bug, then see the fix — **operator**

The human-visible companion to tier-1: reproduce the symptom in the webapp
BEFORE the loop, and watch it disappear AFTER. Stand-in fixture specifics
below; the live-engagement walkthrough (different form, different outcome
question) is in the config repo's `DEMO-STEPS.md`.

**Before the loop (bug proof).** Log in at `https://localhost:10443` as the
seeded **password user** (created in step 2b's `create-users` — an offline
user whose role can submit the form; NOT `medic`, which is an online admin
and shows no offline app). Wait for the initial sync to finish, then:

1. **People** tab → navigate down the hierarchy to the seeded **pregnant
   woman** (a `person` under a `health_center` — the form's context requires
   `summary.is_active_pregnancy`, so if "Pregnancy home visit" is not offered
   on the contact, submit a pregnancy registration for her first).
2. Open the **"Pregnancy home visit"** action.
3. Advance to the **Pregnancy summary** page: "Do you want to start this
   pregnancy visit?" → select **"No, Miscarriage"**.
4. Continue. **THE BUG:** the **"Danger Sign Check"** page appears — "Does
   <name> currently have any of these danger signs?", starting with
   **"Vaginal bleeding"** — for a pregnancy that just ended. Diagnostic tell:
   it misfires ONLY for "No, Miscarriage"; "No, Abortion" / "No, Refusing
   care" / "No, Migrated out of area" all skip it correctly.

Content-level proof of the same (no UI, from the host):

```bash
curl -sk -u medic:password "https://localhost:10443/api/v1/forms/pregnancy_home_visit.xml" \
  | grep -o '<bind nodeset="/data/danger_signs"[^>]*>'
# BUGGY:   relevant="selected(../pregnancy_summary/visit_option, 'yes') or selected(../pregnancy_summary/visit_option, 'miscarriage')"
```

**After the loop (fix proof).** Once QA reports GREEN (step 6.8):

1. Re-run the curl above — the bind now reads
   `relevant="selected(../pregnancy_summary/visit_option, 'yes')"` only.
2. In the webapp, as the same offline user, **force a sync** (hamburger menu
   → **Sync now**) so the client pulls the corrected form — auto-sync is
   every 5 min on stock 4.21.1 (every 30 min on the
   `4.21.x-sync-interval-30` fork), so don't wait for it during a demo.
3. Repeat the walkthrough: "No, Miscarriage" now skips straight past Danger
   Sign Check into the pregnancy-ended flow ("Date of miscarriage"). The
   "Yes" path still shows Danger Sign Check — the no-regression half.

## 7. [AGENT] Report the required change back to the operator + teardown

The deliverable is the **change to apply on the real project** — the agent reports
the corrected config (the `danger_signs` `relevant` restored to the yes-only gate)
with the red→green evidence, for the **operator to apply on the live project
themselves** (the agent never writes to the live instance). Pass checklist:
routing ✓, canonical-diff ✓, **reproduced/red ✓**, generated fix ✓ (descriptor
→ **corrected `.xlsx` source**, the partner handback artifact), offline
convert+assert ✓ (dev phase), upload exit 0 ✓, XML assertion (siblings
unchanged, so other users' hierarchy/behaviour is untouched) ✓, **manual
browser proof ✓** (step 6d), **harness runs in-container ✓** (red→green
pending the spec's fill-array completion, step 6b known gap), tier-3 filing
(optional).
Then `[OPERATOR]` teardown (`docker compose down -v`) — the throwaway test env and
its dummy data go away with the volumes.

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
