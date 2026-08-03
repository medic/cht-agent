# Maisha demo runbook — four tickets, reset-per-ticket (M8 → M7 → M4 → M3)

Operator sequence for demoing the four grounded Maisha Meds tickets
(`tickets/maisha-m*.md`) back-to-back on ONE throwaway CHT 4.21.1 instance,
with a **full, provable data reset between tickets**. It generalises the M5
demo (`docs/handoffs/demo-runbook.md`, `demo-conf/DEMO-STEPS.md`) — same
version policy (repo-pinned **cht-conf 3.21.4**, custom **cht-core 4.21.1**
build, `cht-agent-net`, never touch production), same `[OPERATOR]`/`[AGENT]`
legend — but the four tickets are NOT `configArtifact: form`, which changes
what the pipeline can automate. Read §1 before promising anything to an
audience.

Ticket claims were re-verified against the config source on 2026-07-18
(`tasks.js:1368` typo, `contact-summary.templated.js:175` + `tasks.js:1329`
length-test, `e_household-create.xml:21441` age-only gate,
`f_client-create.xml:19310` corrupted `calculate`) — all four still present
on the `maisha-baseline` state defined in §3.

---

## 1. What the pipeline automates per ticket — the honest matrix

> **Updated 2026-07-18 — the P1–P4 phases LANDED** (branches
> `feat/all-artifacts-p1p2-bind-oracle` `8d52006`, `…-p3-contact-form-qa`
> `607ce63`, `…-p4-compiled-settings-oracle` `95d871d`; plan:
> `all-config-artifacts-pipeline-plan.md`; ledger:
> `cht-conf-extension-pr-ledger.md`). **All four tickets now run the full
> closed loop with `--qa`.** The per-ticket `[OPERATOR] Apply` steps in §5
> are retained as the no-QA FALLBACK path only.

| | M8 education `calculate` | M7 orphan `relevant` | M4 defaulter flag | M3 task duplication |
|---|---|---|---|---|
| `configArtifact` | contact-form | contact-form | contact-summary | task |
| Files fixed | `forms/contact/f_client-create.*` | `forms/contact/e_household-create.*` (+2 siblings, see §5.2) | `contact-summary.templated.js` + `tasks.js` | `tasks.js` |
| Research → HC1 | ✅ frontmatter routing, no LLM | ✅ | ✅ | ✅ |
| Dev phase | **XLSForm orchestrator** (P1): descriptor → exceljs edit (`set.clear` drops the spurious `calculate`; calculate-type guardrail) → offline `convert-contact-forms` → attrs assert incl. ABSENCE (P2) | **XLSForm orchestrator** (P1): `relevant` edit in the `.xlsx`, offline convert + attrs assert | generic LLM code-gen (compile-gated) — correct tool for JS | same as M4 |
| HC2 shows | bind-level per-attr diff (`calculate: <expr> → (absent)`) | bind-level diff (before → after `relevant`) | plain git diff | plain git diff |
| Test-gen | skipped with a loud note (contact fill-based template = P5) | same | generic LLM test-gen; partner suite is the oracle | same |
| `--qa` | ✅ full red→green: deployed contact-form fetched via `deployedFormId` (`contact:f_client:create`), attrs oracle incl. lingering-`calculate` RED, `contact-forms` apply bucket, F6 whole-doc, rev corroboration (P3) | ✅ same (P3) — live-smoked: M7 RED reads honestly against the running instance | ✅ compiled-settings byte-oracle (P4): offline compile vs deployed settings, `app-settings` bucket, settings-doc rev — live-smoked GREEN (byte-parity) and RED (perturbed at the M3 typo) | ✅ same (P4) |
| Red→green proof | automated tier-1 (QA) + browser walkthrough (§5.1) | automated tier-1 (QA) + browser (§5.2) | automated settings oracle + browser + partner suite (§5.3) | automated settings oracle + settings-grep + browser + partner suite (§5.4) |

**Consequences for the demo (updated):**

- **Run WITH `--qa --qa-tier2`:** `npm run full -- tickets/maisha-mX-….md
  --qa --qa-tier2` for all four tickets (the `--` is still load-bearing).
  Since P5 (`a164378`) tier-2 selects per artifact: M3/M4 run the partner
  specs pinned in their ticket `qaSpecs` frontmatter under the repo's own
  mocha+harness (Chromium-backed; all pass on the buggy baseline — verified
  — so they gate regressions without false-blocking); M7/M8 run the
  generated `.agent.spec.js` (attrs-aware XML oracle incl. absence —
  live-smoked red/green). Coverage honesty: the pinned M3/M4 specs are
  no-regression gates; the fix-PROVING cases (over-immunized child,
  duplicate-resolution) come from the agent's generated/banked specs (§6).
  Enketo-level fill specs for the two contact forms remain hand-authored
  rehearsal work (no `loadContactForm` in harness 3.0.15 — see the ledger
  backlog).
- **M7/M8 fixes land in the `.xlsx` source** (P1 orchestrator) and QA's
  `contact-forms` bucket convert+upload keeps source and instance in
  lockstep — no upload-without-convert workaround, no post-demo workbook
  porting (§7 updated).
- **M3/M4 QA prerequisites:** the mounted config repo must have its
  `node_modules` installed (`npm ci` — the offline compile's webpack needs
  the config's runtime deps) and `CHT_CONF_BIN` pointed at the repo-pinned
  cht-conf, both already standard in §3d. The QA reproduce step compiles
  the corrected source and byte-compares against deployed settings — RED
  before apply, GREEN after.

## 2. The reset model — three state layers, none reset automatically

Verified in code: **nothing in the agent resets state between runs.** The QA
workflow never calls `reset()`/`teardown()` (zero non-test callers in
`src/`), and the agent's own `couchdb` reset tier only tombstones+re-uploads
the seeded docs *tracked in memory from the last `prepareTestData` in the
same process* — it never touches task docs, `_users`, form docs, settings,
or client-replicated state (`test-environment-agent.ts:597-667`). So the
per-ticket reset is 100% operator procedure, across three layers:

| Layer | State that accumulates during a ticket | Reset mechanism |
|---|---|---|
| **A. Config repo** (`/workspace/site-config-test` mount) | agent's fix edits, LLM-generated test specs, `.cht-agent/` scratch | `git checkout -B` from the `maisha-baseline` tag + `git clean -fd` (§4, after capturing the fix branch) |
| **B. Instance** (CouchDB) | uploaded fixed config (settings doc / form docs + revs), demo-submitted reports & contacts, **client-emitted task docs** (M3!), sentinel processing | **data snapshot restore** (bind-dir copy or volume loop per stack flavour — §3c/§4; primary, ~1 min) or full `down -v` → re-provision (fallback, ~10 min) |
| **C. Browser client** | replicated local DB, rules-engine state, logged-in session | **fresh incognito/guest window per ticket** — never reuse a profile across a restore (its checkpoints would be ahead of the restored server) |

The volume snapshot is taken ONCE, after the baseline is fully built
(buggy config uploaded + dummy cohorts seeded + rehearsal setup submitted,
§3). Every ticket then starts from a byte-identical instance, which is what
makes four consecutive REDs provable.

## 3. One-time baseline build (rehearsal day, not demo day)

### 3a. [OPERATOR] Provision + upload the buggy config + seed

Identical to the M5 procedure — follow `docs/handoffs/demo-runbook.md`
steps 1–2 / `demo-conf/DEMO-STEPS.md` steps 1–3 verbatim:

1. Build cht-core 4.21.1 local images (`export VERSION=4.21.1`, `npm run
   local-images`), compose up with `docker/cht-agent-net.override.yml`,
   readiness on `https://localhost:10443/api/v2/monitoring`.
2. `npm ci` in the config repo, then upload the **buggy** baseline with the
   repo-pinned cht-conf 3.21.4 (`compile-app-settings upload-app-settings`,
   `convert-app-forms upload-app-forms`, `convert-contact-forms
   upload-contact-forms`, `upload-resources upload-custom-translations`;
   never `upload-branding`).
3. Seed the dummy hierarchy + a password CHV user (`demo_chv`) via
   `csv-to-docs upload-docs create-users` or `test-data-generator`
   (`demo-conf/demo-seed-design.js`).

### 3b. [OPERATOR] Seed the per-ticket cohorts — one script

The cohorts are seeded by `demo/maisha-seed/seed-maisha-cohorts.js`
(self-contained node, no deps; idempotent upserts; every doc `_id` is
prefixed `maisha-seed-` so a botched run is identifiable/deletable; it
self-discovers the hierarchy from the `demo_chv` user so nothing is
hardcoded). It creates four **household lanes** under the CHV area so
reproductions never share contacts:

```bash
cd <cht-agent-workbench>
CHT_URL=https://localhost:10443 COUCHDB_USER=medic COUCHDB_PASSWORD=password \
  node demo/maisha-seed/seed-maisha-cohorts.js
```

| Lane | Docs | Demo use |
|---|---|---|
| `maisha-seed-hh-m8` | 1 adult f_client | M8 registers a new member live |
| `maisha-seed-hh-m7` | 1 adult f_client | M7 registers a child live |
| `maisha-seed-hh-m4` | mother + **14-day-old newborn** + `immunization_service` report (`bcg opv_0 opv_1`) | the M4 RED cohort (see below) |
| `maisha-seed-hh-m3` | mother + **10-day-old newborn** (+ linked delivery report; `created_by_doc`/`place_of_birth` set) | newborn PNC form launchable — M3's live duplicates |

**Why the M4 child is a NEWBORN (config finding):**
`is_immunization_defaulter` is computed only inside `if (isNewborn)`
(`contact-summary.templated.js:171-176` + the task's `modifyContent`) — an
older under-5 would prove the predicate math but the flag would never
render in-app. The seeded newborn is complete-for-age (BCG+OPV0, the two
doses `countTotalVaccinesByAge` expects at <6 weeks) plus one early extra
dose (OPV1) → the buggy `!==` reads `'yes'` while the correct coverage
predicate reads not-a-defaulter. The seeder run was verified by evaluating
BOTH predicates with demo-conf's own functions against the docs fetched
back from the instance (divergence holds).

**⚠️ Newborn freshness:** the two newborn DOBs are computed at seed time
(now−14d / now−10d). `is_newborn` requires <28 days — a stale snapshot ages
them out. **Re-run the seeder after every §4 restore** (idempotent, ~2s —
refreshes the DOBs) and any time the snapshot is older than ~a week.

**M3 — the visible pile is seeded; the live submission shows the mechanism.**

⚠️ **Task-visibility mechanic (read this or the demo looks broken).** The
task event is `{start: 0, end: 14}` with `dueDate` = the form-calculated
`immunization_follow_up_date` = **today + 3** (`tasks.js:1355-1366`;
form bind `immunization_follow_up_date`). `start: 0` means `startDate ==
dueDate`, so a freshly-submitted visit's task sits in state **`Draft` —
invisible in the Tasks tab — for three days.** Confirmed on a real
submission: `state: Draft, startDate: 2026-08-06`. That is why the seeder
plants three reports whose follow-up is due **today** (`M3_DUPLICATES=3`):
their tasks are `Ready` immediately, so the pile is visible in the demo.
Only the DATE is shifted — form id, fields and emission path are exactly
what Enketo produces (verified in the partner rules engine: 3 reports → 3
unresolved `PNC newborn immunization referral` tasks, each keyed to its own
source report).

**Live RED click-path** (grounded in the form XML + a real run; use it to
show a 4th task being emitted, and for the M3 story generally). As
`demo_chv`, open **Baby Njoki (M3 Seed)** → New action → **"Newborn PNC
Home Visit Service"**:

| Page | Question | Answer |
|---|---|---|
| Newborn PNC Home Visit | Who is the caregiver today? | **Mother** |
| | Place of delivery | **Home** (pre-filled from the contact) |
| | Have you referred Baby Njoki to the health facility? | **No** |
| PNC Danger Signs (Child) | Ask for the following danger signs of newborn | **None** ← check ONLY this |
| | Is Baby Njoki's immunization upto date? | **No** ← this calculates the follow-up need + date |
| Summary | — | **Submit** |

- **Check "None", not a real danger sign.** Any danger sign (e.g. "Severe
  chest in-drawing") also emits a *danger-signs referral* task due
  tomorrow and opens a red "refer immediately" branch — noise that muddies
  a demo about immunization duplicates.
- The immunization question only appears because
  `is_immunization_defaulter='yes'` (its `relevant` gate) — i.e. M3's
  reproduction rides on the M4 bug flag. Baby Njoki has no immunization
  reports at all, so she reads as a defaulter under BOTH the buggy and the
  corrected predicate; the path is safe regardless of M4's state.
- The submitted task lands as `Draft` (due in 3 days) — expected; the
  visible pile is the seeded set.

Note: seeded contacts have no sentinel shortcodes (`patient_id`) — they
render fine by name and reports link by UUID; harmless for the demo.

After seeding: log in as `demo_chv` once, **Sync now**, confirm the four
lanes render, log out, close the browser.

### 3c. [OPERATOR] Freeze the baseline — git tag + volume snapshot

```bash
# Layer A — config repo baseline. The working copy currently carries the
# shipped M5 PNC fix uncommitted (postnatal_care_service.* + its specs +
# DEMO-STEPS.md). Keep it IN the baseline — M5 is done, don't re-demo it:
cd /workspace/site-config-test
git add -A && git commit -m "demo baseline v2: M5 PNC fix applied; Maisha M3/M4/M7/M8 bugs present"
git tag maisha-baseline
git remote -v    # MUST still print nothing

# Layer B — instance snapshot. FIRST find where the CouchDB data actually
# lives — it differs by stack flavour:
docker inspect <project>-couchdb-1 \
  --format '{{range .Mounts}}{{.Type}} src={{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
#   bind  src=<hostdir> -> /opt/couchdb/data   ← BIND-MOUNT stack (e.g. the
#     published-compose cht-421-official stack: src=.../cht-421-official/srv)
#   volume src=... cht-couchdb-data ...        ← NAMED-VOLUME stack

# Stop the stack (keep data), snapshot, restart:
cd <stack-dir>            # e.g. cht-421-official (the compose project dir)
docker compose --env-file ./.env -f cht-core.yml -f cht-couchdb.yml \
  -f <cht-agent>/docker/cht-agent-net.override.yml stop
mkdir -p ~/maisha-volsnap
# BIND-MOUNT stack (this engagement): the data is a plain host dir — copy it
# with ownership preserved (couchdb runs under its own uid, hence sudo):
sudo cp -a <hostdir-from-inspect> ~/maisha-volsnap/couch-data
# NAMED-VOLUME stack instead: loop the stack's volumes (verify the prefix —
# it is the compose PROJECT name, i.e. the directory name):
#   for v in $(docker volume ls -q | grep '^<project>_'); do
#     docker run --rm -v "$v":/from -v ~/maisha-volsnap/"$v":/to alpine \
#       sh -c 'cd /from && cp -a . /to'
#   done
docker compose --env-file ./.env -f cht-core.yml -f cht-couchdb.yml \
  -f <cht-agent>/docker/cht-agent-net.override.yml start
```

(⚠️ the credentials/ssl named volumes don't change between tickets — the
data dir/volume is the reset surface. Always confirm via the `docker
inspect` above rather than assuming; a wrong-prefix loop "succeeds" while
snapshotting nothing.)

### 3d. [OPERATOR] REBUILD + start the agent runtime (mandatory, not routine)

The `--qa`/`--qa-tier2` support for these four tickets exists ONLY on the
local branch stack (P1–P5, `feat/all-artifacts-p5-tier2-testgen` tip) — an
image built before 2026-07-18 has the old guards and aborts QA for every
non-`form` artifact. The agent is also its own compose project:
`start`ing the CHT stack does NOT start (or rebuild) `cht-agent`.

```bash
cd <cht-agent-workbench>
git branch --show-current   # must be feat/all-artifacts-p5-tier2-testgen
                            # (or a branch containing it)
# rebuild cht-agent:local from THIS checkout (compose build context is ..):
CHT_CORE_PATH=<cht-core-checkout> CHT_CONF_PATH=<config-repo, e.g. .../demo-conf> \
  docker compose -f docker/docker-compose.cht-agent.yml build
# (re)create — never plain `start`: the --force-recreate re-binds the OAuth
# credentials mount (the M5 staleness gotcha) and picks up the new image:
CHT_CORE_PATH=<cht-core-checkout> CHT_CONF_PATH=<config-repo> \
  docker compose -f docker/docker-compose.cht-agent.yml up -d --force-recreate
# pre-flight:
docker exec cht-agent claude -p "say ok"
docker exec cht-agent ls /app/tickets | grep maisha   # all four visible
```

Env (compose defaults since the demo env block; override only to change):
`LLM_PROVIDER=claude-cli`, `ANTHROPIC_MODEL=claude-opus-4-8`,
`CHT_URL=https://nginx`, TLS env, `CHT_CONF_PATH=/workspace/cht-conf-project`
(container path), `CHT_CONF_BIN=/workspace/cht-conf-project/node_modules/.bin/cht`,
`DEV_MAX_ITERATIONS` as desired. The config repo's `npm ci` must have run
BEFORE `up` (pinned cht-conf + mocha + harness ride the mount — P4's offline
compile and P5's tier-2 both need them).

## 4. THE PER-TICKET RESET (run before ticket 1 and between every pair)

Total ~3 minutes. Do all four layers, in this order, every time:

```bash
# ── A. capture the previous ticket's deliverable, then re-baseline the repo ──
cd /workspace/site-config-test
git add -A && git commit -m "maisha-mX: agent-generated fix (demo run $(date +%F))"
#   (skip if this is the pre-ticket-1 reset — nothing to capture)
git checkout -B fix/maisha-mNEXT maisha-baseline   # next ticket works on its own branch
git clean -fd                                      # drop .cht-agent/ scratch etc.
git status --short                                 # MUST be empty

# ── B. restore the instance snapshot (match the flavour found in §3c) ──
cd <stack-dir>            # e.g. cht-421-official
docker compose --env-file ./.env -f cht-core.yml -f cht-couchdb.yml \
  -f <cht-agent>/docker/cht-agent-net.override.yml stop
# BIND-MOUNT stack (this engagement — data dir e.g. ./srv):
sudo rsync -a --delete ~/maisha-volsnap/couch-data/ <hostdir-from-inspect>/
# NAMED-VOLUME stack instead:
#   for v in $(docker volume ls -q | grep '^<project>_'); do
#     docker run --rm -v "$v":/vol -v ~/maisha-volsnap/"$v":/snap alpine \
#       sh -c 'find /vol -mindepth 1 -delete && cd /snap && cp -a . /vol'
#   done
docker compose --env-file ./.env -f cht-core.yml -f cht-couchdb.yml \
  -f <cht-agent>/docker/cht-agent-net.override.yml start
curl -sk https://localhost:10443/api/v2/monitoring | head -c 200   # wait for readiness
# Refresh the newborn DOBs (idempotent, ~2s — is_newborn needs <28 days and
# the snapshot froze them at seed time):
(cd <cht-agent-workbench> && node demo/maisha-seed/seed-maisha-cohorts.js)
# NOTE: the cht-agent container is a separate compose project — it keeps
# running across CHT-stack restarts; only recreate it (§3d) at day start
# or after switching workbench branches.

# ── C. fresh browser ──
# Close ALL demo browser windows; open a NEW incognito/guest window;
# log in as demo_chv; wait for initial sync. Never reuse a profile from
# before a restore (client checkpoints would be ahead of the server).

# ── D. prove the reset (10 seconds, audience-visible if you like) ──
curl -sk -u medic:password https://localhost:10443/api/v1/settings \
  | grep -o 'posnatal_care_service_newborn' | head -1
#   → prints the typo ⇒ the buggy baseline config is live again
```

Fallback if a restore ever misbehaves: full rebuild — `docker compose down
-v` → §3a again (≈10 min; the reason rehearsal must time both paths).

Between tickets, also verify the agent container still has fresh OAuth
(recreate it at the START of demo day per the M5 runbook's staleness gotcha
— the token file mount goes stale on rotation).

## 5. The four tickets — each: RED → agent fix (HC1/HC2) → apply → GREEN

Order rationale: ascending risk, descending amount of manual apply, ending
on the highest-impact story (ten duplicate tasks collapsing). Resets make
the order freely swappable.

Common agent step for every ticket (P1–P4 landed — full closed loop, §1):

```bash
docker exec -it cht-agent npm run full -- tickets/maisha-mX-<name>.md --qa
#                                      ^^ the -- is LOAD-BEARING (npm swallows flags)
# HC1: approve research (frontmatter-routed, cht-conf corpus).
# HC2: M7/M8 → bind-level per-attr diff from the verified offline convert
#      (M8 shows `calculate: <expr> → (absent)`); M3/M4 → plain git diff.
#      Approve ⇒ files land in the working copy. Nothing is uploaded yet.
# QA:  reproduce RED on the deployed instance → HC3 gate → apply (contact-forms
#      bucket for M7/M8, app-settings for M3/M4) → rev change → verify GREEN.
# Add --qa-tier2 (P5): after GREEN, runs the ticket's qaSpecs-pinned partner
#      specs (M3/M4) or the generated contact-form spec (M7/M8) with the
#      repo-pinned mocha; `succeeded` then requires them to pass.
```

The per-ticket `[OPERATOR] Apply` blocks below are the **no-QA fallback**
(e.g. demoing against an instance the agent can't reach); with `--qa` the
apply happens inside the loop at HC3 and these steps are skipped.

### 5.1 M8 — education select corrupted by a `calculate` (contact-form, opener)

**RED (content, before the agent runs):** contact forms aren't served by
`/api/v1/forms` — read the CouchDB doc attachment (id `form:contact:
f_client:create`; ⚠️ rehearsal-verify id + attachment name via
`GET /medic/_all_docs?startkey="form:contact"&endkey="form:contact￰"`):

```bash
curl -sk -u medic:password 'https://localhost:10443/medic/form%3Acontact%3Af_client%3Acreate/xml' \
  | grep -o '<bind nodeset="/data/f_client/hh_member_education_lvl[^>]*>'
# BUGGY: carries calculate="member_filter = ... or over_5= ... or member_filter = 2"
```

**RED (browser):** in `HH-M8`, register a new household member: education
status → "at school" → the required **Level of Education** select misbehaves
(the calculate overwrites the selection with a non-choice value — exact
visible symptom per rehearsal: value resets / refuses to submit). Same on
Occupation.

**Agent:** run the ticket. Expected diff: the `calculate` attribute removed
from the `hh_member_education_lvl` and `hh_member_occupation` binds in
`forms/contact/f_client-create.xml` (XML-level — see §1).

**[OPERATOR] Apply — upload WITHOUT convert** (convert would regenerate from
the unfixed workbook and clobber the fix):

```bash
cd /workspace/site-config-test
./node_modules/.bin/cht --url='https://medic:password@localhost:10443' \
  --force --skip-git-check --skip-version-check --skip-dependency-check \
  --skip-translation-check --accept-self-signed-certs \
  upload-contact-forms -- f_client-create
```

**GREEN:** re-run the curl — `calculate` gone, `required`/`relevant` intact.
Browser (Sync now first — 30-min auto-sync fork): the selection now sticks
for every choice value; field still required and still gated on
at_school/left_school.

### 5.2 M7 — orphan question ignores captured parent status (contact-form)

**RED (content):**

```bash
curl -sk -u medic:password 'https://localhost:10443/medic/form%3Acontact%3Ae_household%3Acreate/xml' \
  | grep -o '<bind nodeset="/data/repeat/child/is_orphan[^>]*>'
# BUGGY: relevant="../age_in_years_member < 18"   (age only)
```

**RED (browser):** in `HH-M7`, register a household child; answer father
alive → Yes, mother alive → Yes → the **orphan question still appears**.

**Agent:** expected diff extends the `relevant` to
`age gate AND not(both parents alive)` in `e_household-create.xml`, plus the
same fix in `f_client-create.xml` (caregiver multi-select variant) and the
reminder app form `household_member_registration_reminder.xml`.
Demo-scope call: if the agent fixes only the reported surface
(`e_household-create`), accept it and note the siblings as follow-up — don't
iterate live.

**[OPERATOR] Apply (upload only, no convert):**

```bash
./node_modules/.bin/cht --url=... <same flags> upload-contact-forms -- e_household-create f_client-create
./node_modules/.bin/cht --url=... <same flags> upload-app-forms -- household_member_registration_reminder
#   (second line only if the agent also fixed the reminder form)
```

**GREEN:** curl shows the extended `relevant`; browser: both-parents-alive
child → question skipped; **no-regression half:** register another child
with father → deceased (or unknown) → question still appears.

### 5.3 M4 — fully-immunized child flagged as defaulter (contact-summary + tasks.js)

**RED (browser, primary — content-grep on the compiled settings is
unreliable here, the bundle is minified and this predicate has no unique
string literal):** open the seeded **14-day-old newborn** in
`maisha-seed-hh-m4` (the flag only renders for newborns — §3b finding) →
the defaulter flag/branch is visible (contact profile card and/or the
newborn PNC form's defaulter-tracing branch opening) despite the child
being complete-for-age (BCG+OPV0) + one extra dose.

**RED (partner suite, the CHT-docs-compliant proof):** the repo's own
`test/contact-summary.spec.js` + an over-immunized-child case. If the
agent's test-gen emits one at HC2, use it; otherwise use the rehearsed spec
(§6). Run it BEFORE applying — it must FAIL against the baseline code:

```bash
cd /workspace/site-config-test
npx mocha test/contact-summary.spec.js --timeout 120000   # rehearse the exact invocation
```

**Agent:** expected diff — the length-inequality at
`contact-summary.templated.js:175` and `tasks.js:1329` replaced with the
coverage predicate (`vaccinesNotReceivedByAge(contact, reports).length > 0`
semantics, mirroring `:458-460`), optionally retiring the dead
`imm_schedule_upto_date` predicate at `tasks.js:1007`. The dev-phase
compile gate has already proven `compile-app-settings` passes.

**[OPERATOR] Apply (app-settings bucket):**

```bash
./node_modules/.bin/cht --url=... <same flags> compile-app-settings upload-app-settings
```

**GREEN:** re-run the spec (passes); browser in a fresh incognito window
(config change triggers client rules/contact-summary recalc after Sync now;
fresh login is the deterministic fallback): the fully-immunized child no
longer shows the flag; a genuinely-missing-dose child (register one live, or
rehearse a second `HH-M4` child) still flags — the no-regression half.

### 5.4 M3 — newborn PNC follow-up tasks duplicate ×10 (task, closer)

**RED (content — this one HAS a crisp settings-grep, the misspelled form id
is a string literal and survives minification):**

```bash
curl -sk -u medic:password https://localhost:10443/api/v1/settings \
  | grep -o 'posnatal_care_service_newborn'
# match ⇒ the broken resolver is live
```

**RED (task docs — proof without waiting three days):**

```bash
curl -sk -u medic:password 'https://localhost:10443/medic/_all_docs?include_docs=true&limit=3000' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      JSON.parse(s).rows.map(r=>r.doc).filter(d=>d&&d.type==="task"&&JSON.stringify(d).includes("maisha-seed-m3-newborn"))
        .forEach(t=>console.log(t.state,"| due",t.emission.dueDate,"|",t.emission.title,"|",t.emission._id));})'
# THREE Ready `task.pnc_newborn_immunization.title` rows, each keyed by a
# DIFFERENT source report (`<reportId>~newborn-immunization-follow-up~…`) —
# one per home visit, none resolved. That IS the pile-up.
```

**RED (browser, the showpiece):** as `demo_chv`, **Tasks** tab (or Baby
Njoki's profile → Tasks) → **three identical "PNC newborn immunization
referral" cards** for the same baby. Then the mechanism, live: run the §3b
click-path on Baby Njoki once more → a FOURTH task is emitted (verify with
the curl above — it will be `state: Draft`, due in 3 days; see the
visibility note in §3b).

**The over-resolution half — the strongest visible RED.** Open ONE of the
three cards → complete its immunization referral → **all three cards
disappear**. One referral silently closed three separate visits'
follow-ups. (Verified in the partner rules engine: 3 open → complete #2 →
0 remain.) Restore the snapshot + re-seed (§4) before the fix so the pile
is back.

**Agent:** expected diff in `tasks.js` newborn report-based templates:
`posnatal_` → `postnatal_` at `:1368`, plus `report._id` passed as the
`sourceID` (6th) argument to `isFormArraySubmittedInWindow`, mirroring the
mother-side pattern at `:207-215`.

**[OPERATOR] Apply:**

```bash
./node_modules/.bin/cht --url=... <same flags> compile-app-settings upload-app-settings
```

**GREEN:**
1. Settings-grep again → **no match** (typo gone). This is also exactly
   what QA's compiled-settings oracle asserts automatically (P4).
2. Browser: **Sync now** (fresh incognito login is the deterministic
   fallback — the rules engine must recompute against the new settings).
   ⚠️ **The three cards do NOT vanish** — they are still three unresolved
   follow-ups, which is correct: each visit needs its own referral. The
   visible change is the resolution behaviour:
   **open ONE card → complete its immunization referral → only THAT card
   clears; the other two remain.** Pre-fix the same action cleared all
   three. (Both halves verified in the partner rules engine: pre-fix
   3→0, post-fix 3→2 with `#1`/`#3` remaining.)
3. Partner suite: the ticket's `qaSpecs` specs run automatically under
   `--qa-tier2`; manually it's
   `npx mocha test/tasks/postnatal_care_service_newborn.spec.js test/tasks/immunization_service.spec.js`.
   **Ordering note:** the harness reads the COMPILED `app_settings.json`,
   not `tasks.js` — so the specs only exercise the fix after a
   `compile-app-settings` (QA's `app-settings` apply bucket does this, which
   is why tier-2 runs after GREEN).

Capture the branch (§4-A) — done; the demo closes with four `fix/maisha-m*`
branches in the config repo as the partner handback.

## 6. Rehearsal checklist (do the whole thing once, end-to-end, before demo day)

- [ ] Workbench gates on the demo branch/image: `npm run build && npm test
      && npm run lint` (expected 1587 passing / 0 failing).
- [ ] Baseline build §3 + snapshot; **time the restore** (§4-B) and the
      full-rebuild fallback.
- [ ] One full reset→ticket cycle per ticket, capturing: the exact browser
      click-path and visible symptom (esp. M8's corruption behaviour and
      M4's flag surface), the contact-form doc ids/attachment names (§5.1
      curl), the partner-suite mocha invocations, the M4/M3 rules-recalc
      behaviour after Sync now vs fresh login.
- [ ] Confirm the newborn PNC form is launchable on the `HH-M3` newborn and
      that repeat submissions do accumulate tasks on the baseline.
- [ ] **Bank a rehearsed fix per ticket** (branches
      `fix/maisha-mX-rehearsed`, kept in the repo): if a live agent run
      exhausts `DEV_MAX_ITERATIONS` or produces a wrong diff, decline HC2,
      say so plainly, apply the rehearsed branch manually
      (`git cherry-pick` / checkout), and continue the red→green — the
      reset machinery and the proof structure still demo perfectly.
- [ ] Prepare M4's regression spec (over-immunized case) if the agent's
      test-gen doesn't emit a usable one during rehearsal.
- [ ] Demo-day morning: verify host `claude -p 'say ok'`, recreate the agent
      container (OAuth mount staleness), re-check tickets in
      `/app/tickets`, pre-flight `docker exec cht-agent claude -p "say ok"`.

Time budget per ticket ≈ 15–20 min (reset 3 + RED 3 + agent run 5 + apply 1
+ GREEN 3–5), ~80 min for all four plus intro; the resets are natural
narration beats ("everything you just saw is now provably gone").

## 7. After the demo — deliverables + gaps to narrate

- **Handback:** four `fix/maisha-m*` branches. Since P1, M7/M8 fixes land
  in the `.xlsx` source (corrected workbook + regenerated `.xml`, in
  lockstep) — no post-demo porting. M3/M4 are JS-source fixes as before.
- **Remaining gap to narrate** (tracked in the PR ledger): P5 — per-artifact
  tier-2 spec selection (partner `test/tasks/` / `test/contact-summary`
  suites wired into `--qa-tier2`) and the contact-form fill-based generated
  spec; plus the deferred settings drift guard (git-baseline compile at
  RED time). Everything else this runbook originally listed as a gap
  (contact-form orchestrator/QA, app-settings oracle) LANDED 2026-07-18.
- Teardown when done: `docker compose down -v` (+ delete `~/maisha-volsnap`
  when the engagement closes).
