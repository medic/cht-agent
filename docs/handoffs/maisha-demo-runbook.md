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

- **Run WITH `--qa`:** `npm run full -- tickets/maisha-mX-….md --qa` for all
  four tickets (the `--` is still load-bearing). Do NOT pass `--qa-tier2`
  for these: tier-2 spec selection is per-artifact only with P5 (form
  artifacts only today).
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
| **B. Instance** (CouchDB) | uploaded fixed config (settings doc / form docs + revs), demo-submitted reports & contacts, **client-emitted task docs** (M3!), sentinel processing | **volume snapshot restore** (primary, ~1 min, §3c/§4) or full `down -v` → re-provision (fallback, ~10 min) |
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

### 3b. [OPERATOR] Seed the per-ticket cohorts (in-app, once)

Give each ticket its own **household lane** so reproductions never share
contacts, then do the fiddly clinical setup ONCE here — it rides the
snapshot, so demo day starts with rich, ready cohorts:

- **`HH-M8` / `HH-M7`** — two empty-ish households under the CHV area (M8
  registers a new client live; M7 registers a child live). Nothing to
  pre-submit.
- **`HH-M4`** — a household with an **under-5 child whose immunization
  history is complete for age** (submit `immunization_service` reports as
  `demo_chv` covering every age-due vaccine, plus one extra/optional dose —
  the over-count is what trips the `!==` length test). Verify the symptom
  while you're here: the child's profile/newborn-PNC flow must already show
  the defaulter flag (`is_immunization_defaulter = 'yes'`). If it doesn't,
  adjust doses until it does — **the snapshot must contain a reproducing
  cohort.**
- **`HH-M3`** — a mother with a **recorded delivery + registered newborn**
  (run the M5-demo "Visit 1" delivery flow: `postnatal_care_service`, "Has
  she delivered?" → Yes, outcome 1 delivered/1 alive). Do **NOT** submit any
  newborn PNC follow-up reports here — the duplicate-accumulation is the
  live demo. The delivery's own legit PNC task series will exist in the
  snapshot; that's fine and realistic.

Sync everything, log out, close the browser.

### 3c. [OPERATOR] Freeze the baseline — git tag + volume snapshot

```bash
# Layer A — config repo baseline. The working copy currently carries the
# shipped M5 PNC fix uncommitted (postnatal_care_service.* + its specs +
# DEMO-STEPS.md). Keep it IN the baseline — M5 is done, don't re-demo it:
cd /workspace/site-config-test
git add -A && git commit -m "demo baseline v2: M5 PNC fix applied; Maisha M3/M4/M7/M8 bugs present"
git tag maisha-baseline
git remote -v    # MUST still print nothing

# Layer B — instance snapshot. Stop the stack (keep volumes), copy every
# stack volume aside, restart:
cd <cht-core>/local-build
docker compose --env-file ./.env -f cht-core.yml -f cht-couchdb.yml \
  -f <cht-agent>/docker/cht-agent-net.override.yml stop
mkdir -p ~/maisha-volsnap
for v in $(docker volume ls -q | grep '^local-build_'); do   # verify prefix: docker volume ls
  docker run --rm -v "$v":/from -v ~/maisha-volsnap/"$v":/to alpine \
    sh -c 'cd /from && cp -a . /to'
done
docker compose --env-file ./.env -f cht-core.yml -f cht-couchdb.yml \
  -f <cht-agent>/docker/cht-agent-net.override.yml start
```

(⚠️ rehearsal-verify the volume-name prefix — compose names volumes
`<project>_<name>`, project defaults to the directory name `local-build`.
Snapshot **all** of the stack's volumes, not just couchdb.)

### 3d. [OPERATOR] Agent runtime

As the M5 runbook step 3 (Mission-05 image with exceljs, `LLM_PROVIDER=
claude-cli`, `ANTHROPIC_MODEL=claude-opus-4-8`, `CHT_URL=https://nginx`,
TLS env, `CHT_CONF_PATH=/workspace/cht-conf-project`,
`CHT_CONF_BIN=/workspace/cht-conf-project/node_modules/.bin/cht`,
`DEV_MAX_ITERATIONS` as desired). The four tickets ship in the workbench
`tickets/` dir — confirm they're visible in-container
(`docker exec cht-agent ls /app/tickets | grep maisha`).

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

# ── B. restore the instance snapshot ──
cd <cht-core>/local-build
docker compose --env-file ./.env -f cht-core.yml -f cht-couchdb.yml \
  -f <cht-agent>/docker/cht-agent-net.override.yml stop
for v in $(docker volume ls -q | grep '^local-build_'); do
  docker run --rm -v "$v":/vol -v ~/maisha-volsnap/"$v":/snap alpine \
    sh -c 'find /vol -mindepth 1 -delete && cd /snap && cp -a . /vol'
done
docker compose --env-file ./.env -f cht-core.yml -f cht-couchdb.yml \
  -f <cht-agent>/docker/cht-agent-net.override.yml start
curl -sk https://localhost:10443/api/v2/monitoring | head -c 200   # wait for readiness

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
#      No --qa-tier2 here (per-artifact tier-2 selection is P5).
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
string literal):** open the `HH-M4` fully-immunized child → the defaulter
flag/branch is visible (per §3b rehearsal: contact profile card and/or the
newborn PNC form's defaulter-tracing branch opening).

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

**RED (browser, the showpiece):** in `HH-M3`, on the newborn: submit the
newborn PNC home-visit form (`postnatal_care_service_newborn`, with an
immunization follow-up date) **twice, then a third time** → the Tasks tab
accumulates **duplicate immunization-follow-up tasks**; submitting the
follow-up form **does not resolve them** (the resolver looks for a form id
that can never exist). Narrate: "in production this reached ten."

**Agent:** expected diff in `tasks.js` newborn report-based templates:
`posnatal_` → `postnatal_` at `:1368`, plus `report._id` passed as the
`sourceID` (6th) argument to `isFormArraySubmittedInWindow`, mirroring the
mother-side pattern at `:207-215`.

**[OPERATOR] Apply:**

```bash
./node_modules/.bin/cht --url=... <same flags> compile-app-settings upload-app-settings
```

**GREEN:**
1. Settings-grep again → **no match** (typo gone).
2. Browser: **Sync now** → the config change makes the rules engine
   recalculate → the accumulated duplicates **resolve/clear** (rehearsal
   fallback: fresh incognito login shows the recomputed task list). Submit
   one more newborn PNC report → exactly ONE task; submit its follow-up →
   it resolves.
3. Partner suite: `npx mocha test/tasks/<newborn spec>` red→green as in §5.3.

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
