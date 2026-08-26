# Maisha demo — full procedure: five tickets, five PR bundles

**Canonical runbook.** One continuous procedure that takes a machine with
nothing set up to five reviewed PR bundles — one per Maisha Meds ticket —
each produced by the agent pipeline against a reconstructed partner
deployment, with a provable data reset between tickets.

Supersedes, and folds together:
- `maisha-demo-runbook.md` — M8/M7/M4/M3 + the reset model (kept for its
  per-ticket browser detail and the reset rationale).
- `demo-conf/DEMO-STEPS.md` — the M5 (PNC) walkthrough (kept for its
  two-visit browser narrative).

**What you end with:** `pr-archive/<ticket>/{PR.md,changes.patch}` ×5, each
patch applying cleanly to a pristine clone of the partner config repo, plus
per-ticket red→green evidence. That is the artefact to analyse.

**Legend:** `[OPERATOR]` = you (git/docker/browser/curl). `[AGENT]` = the
pipeline. Every git/docker command is yours; the agent never pushes.

| # | Ticket file | `configArtifact` | Fix lands in | Why it is in this order |
|---|---|---|---|---|
| 1 | `tickets/demo-echis-pnc-ticket.md` (M5) | `form` | `forms/app/postnatal_care_service.xlsx` + `.xml` | The proven path — app form, three-tier verified. Warm-up. |
| 2 | `tickets/maisha-m8-education-field-calculate.md` | `contact-form` | `forms/contact/f_client-create.*` | First contact form; attribute REMOVAL (`calculate`). |
| 3 | `tickets/maisha-m7-orphan-question-relevant.md` | `contact-form` | `forms/contact/e_household-create.*` | Contact form, `relevant` widening. |
| 4 | `tickets/maisha-m4-immunization-defaulter-false-positive.md` | `contact-summary` | `contact-summary.templated.js` + `tasks.js` | First settings-artifact ticket. |
| 5 | `tickets/maisha-m3-newborn-pnc-task-duplication.md` | `task` | `tasks.js` | The showpiece (duplicate task pile). |

Time budget: setup ≈ 2–3 h on a cold machine (most of it image builds and
`npm ci`); then ≈ 25–35 min per ticket, ≈ 3 h for all five.

---

## 0. Prerequisites

- **Access to the partner config repo** (private). You need a clone; ask
  the engagement owner. Nothing in this procedure pushes to it.
- **cht-core checkout** at the deployed version (4.21.1, or the partner's
  fork of it) — used to build the test images, and mounted into the agent.
- **Docker** (compose v2), **Node ≥ 22.17**, ~15 GB free disk
  (`node_modules` ≈ 318 MB per tree, Chromium ≈ 400 MB once, CHT images
  ≈ 4 GB), host ports 10080/10443 free.
- **Claude Code logged in on the HOST** (`claude -p 'say ok'`) — the agent
  container mounts the host credentials read-only.
- This workbench checked out on a branch containing the all-artifacts
  phases (P1–P5) — `git log --oneline | grep -c all-artifacts` ≥ 1, or
  simply the current `fix/pipeline-hardening` line or later.

---

## 1. One-time setup

### 1.1 [OPERATOR] Clone the partner config repo — twice

```bash
cd ~/ai_medic/medic-cht-agent           # or wherever you keep these
git clone <partner-config-repo-url> site-config        # PRISTINE reference: never edit, never run git in it
cp -a site-config demo-conf && rm -rf demo-conf/.git   # the DEMO WORKING COPY
```

Two copies on purpose: the pristine clone is the thing your finished
patches must apply to (§4), and it is the only untouched record of what
production actually contains. `demo-conf` is the copy the agent mounts and
edits.

### 1.2 [OPERATOR] Neutralize the working copy (deterministic script)

```bash
cd <workbench>
node demo/setup/neutralize-config.js --config ~/ai_medic/medic-cht-agent/demo-conf
```

Idempotent. It: deletes `*:Zone.Identifier` download artefacts (653 in the
original handover); sets `branding.json` title to `CHT Demo`; rewrites the
README H1; and neutralizes `app_settings/base_settings.json` — **deletes
`oidc_provider`** (→ password login, no partner IdP), **empties
`outbound`** (no partner integrations fire from a test env), and sets
`app_url` to `https://nginx`. That last group is also what removes the
final `env.*` placeholders, so `compile-app-settings` needs no env file.

It does **not** touch `forms/`, `tasks.js`, `targets.js`,
`contact-summary*.js` or `translations/` — the five bugs must stay intact.

### 1.3 [OPERATOR] Read the scan output — it is not all automatic

The script finishes with a SCAN of identifying material it deliberately
does not auto-edit (prose needs judgement). On the eCHIS handover it
reports, and you should decide on, at minimum:

| Where | What |
|---|---|
| `README.md` | live partner hostnames (`chis-training…`, `chis-staging…`, `echis…health.go.ke`), the partner GitHub org/repo URL, internal Google Sheets links, "Ministry of Health"/"Kenya" mentions |
| `package.json` | `"name": "config-echis"` |
| `resources.json`, `scripts/**` | org mentions (`MoH`, `eCHIS`) |
| `branding/` | partner artwork stays on disk — **never run `upload-branding`** (that is why every upload step below omits it) |

If the demo will be recorded or shared outside the engagement, scrub those
before continuing, then re-run with `--check --strict` (exit 1 while
anything remains). If it stays internal, note them and move on — nothing
here reaches the test instance except what you explicitly upload.

### 1.4 [OPERATOR] Make it a remote-less baseline repo with all five bugs

```bash
cd ~/ai_medic/medic-cht-agent/demo-conf
git init -q && git add -A
git commit -q -m "demo baseline: neutralized partner config, all five Maisha bugs present"
git remote -v            # MUST print nothing — remote-less means nothing can ever be pushed
git tag maisha-baseline
```

Three properties matter and each has bitten us:
- **A git repo with ≥1 commit** — the code-gen CLI snapshots/rolls back via
  git and the fix descriptor rides the git-diff capture.
- **No remote** — belt-and-braces with the container's push block.
- **All five bugs present.** If you are reusing an existing `demo-conf`
  that already carries a demo fix (e.g. the M5 PNC fix), revert those files
  into the baseline first, keeping genuine environment fixes:
  ```bash
  # example: drop a previously-applied M5 fix, keep the harness sandbox fix
  git checkout <pristine-baseline-sha> -- forms/app/postnatal_care_service.xlsx \
      forms/app/postnatal_care_service.xml test/forms/postnatal_care_service.spec.js
  git rm -q --cached test/forms/postnatal_care_service.agent.spec.js 2>/dev/null || true
  git commit -q -m "baseline: all five bugs present" && git tag -f maisha-baseline
  ```

### 1.5 [OPERATOR] Install the config repo's pinned toolchain

```bash
cd ~/ai_medic/medic-cht-agent/demo-conf && npm ci
```

Non-negotiable — four separate stages read it: the dev phase's offline
convert, QA's apply, P4's offline `compile-app-settings` (webpack needs the
config's own `cht-nootils`/`dayjs`), and tier-2's repo-pinned
mocha + `cht-conf-test-harness`. Note the installed cht-conf may be a patch
ahead of the tickets' `chtConfVersion` (3.21.5 vs 3.21.4) — informational
metadata only, harmless.

If the harness needs `--no-sandbox` to launch Chromium in your container,
add it to `harness.defaults.json` now and commit it into the baseline — it
is an environment fix, not a ticket fix.

### 1.6 [OPERATOR] Bring up the CHT test instance

Either build the partner's exact fork locally, or use published 4.21.1
images. Published-image route:

```bash
mkdir -p ~/ai_medic/medic-cht-agent/cht-421-official && cd $_
curl -s -o cht-core.yml    "https://staging.dev.medicmobile.org/_couch/builds_4/medic:medic:4.21.1/docker-compose/cht-core.yml"
curl -s -o cht-couchdb.yml "https://staging.dev.medicmobile.org/_couch/builds_4/medic:medic:4.21.1/docker-compose/cht-couchdb.yml"
cat > .env <<EOF
COUCHDB_USER=medic
COUCHDB_PASSWORD=password
COUCHDB_SECRET=$(openssl rand -hex 16)
COUCHDB_UUID=$(openssl rand -hex 16)
NGINX_HTTP_PORT=10080
NGINX_HTTPS_PORT=10443
EOF
docker network create cht-agent-net 2>/dev/null || true
docker compose --env-file ./.env -f cht-core.yml -f cht-couchdb.yml \
  -f <workbench>/docker/cht-agent-net.override.yml up -d
curl -sk https://localhost:10443/api/v2/monitoring | head -c 120   # expect version.app 4.21.1
```

Local-build route (partner fork): in the cht-core checkout,
`npm ci && npm run build`, then `export VERSION=4.21.1` (**not** `TAG=`,
which yields `4.21.1.undefined`) and `npm run local-images`, then compose up
from `local-build/` the same way. Full detail: `demo-runbook.md` §1.

The override joins `nginx` to `cht-agent-net` so the agent reaches the
instance at `https://nginx`.

### 1.7 [OPERATOR] Upload the buggy config with the repo-pinned cht-conf

```bash
cd ~/ai_medic/medic-cht-agent/demo-conf
CHT=./node_modules/.bin/cht
URL='https://medic:password@localhost:10443'
FLAGS='--force --skip-git-check --skip-version-check --skip-dependency-check --skip-translation-check --accept-self-signed-certs'
$CHT --url=$URL --source=. $FLAGS compile-app-settings upload-app-settings
$CHT --url=$URL --source=. $FLAGS convert-app-forms upload-app-forms
$CHT --url=$URL --source=. $FLAGS convert-contact-forms upload-contact-forms
$CHT --url=$URL --source=. $FLAGS upload-resources upload-custom-translations
#   deliberately NO upload-branding — keeps CHT default artwork on the throwaway env
```

Always the repo-pinned binary, never a global cht-conf: the config was
authored and compiled against that version, so the upload exercises exactly
what production ran.

### 1.8 [OPERATOR] Seed the hierarchy + an offline CHV user

The contact hierarchy is `a_county → b_sub_county →
c_community_health_unit → d_community_health_volunteer_area → e_household →
f_client`, plus a `person` CHV. Build dummy CSVs and load them:

```bash
cd <workbench>
npm run demo:build-seed -- --export <scrubbed-export.json> \
  --app-settings ~/ai_medic/medic-cht-agent/demo-conf/app_settings.json \
  --users <users.json> --out /tmp/maisha-seed-project
cd ~/ai_medic/medic-cht-agent/demo-conf
$CHT --url=$URL --source=/tmp/maisha-seed-project $FLAGS csv-to-docs upload-docs create-users
```

You need at least one **password** user (`demo_chv`) whose role can submit
the PNC forms and holds `can_create_records`. Not `medic` — that is an
online admin and shows no offline app. Alternative for volume:
`medic/test-data-generator` with `demo-conf/demo-seed-design.js`.

### 1.9 [OPERATOR] Seed the per-ticket cohorts

```bash
cd <workbench>
CHT_URL=https://localhost:10443 COUCHDB_USER=medic COUCHDB_PASSWORD=password \
  node demo/maisha-seed/seed-maisha-cohorts.js
```

Idempotent; every `_id` is prefixed `maisha-seed-`; the hierarchy is
discovered from the `demo_chv` user, so nothing is hardcoded. It creates one
household lane per ticket so reproductions never share contacts:

| Lane | Contents | Used by |
|---|---|---|
| `maisha-seed-hh-m8` | one adult `f_client` | M8 registers a new member live |
| `maisha-seed-hh-m7` | one adult `f_client` | M7 registers a child live |
| `maisha-seed-hh-m4` | mother + **14-day-old newborn** + `immunization_service` report (`bcg opv_0 opv_1`) | M4's RED cohort |
| `maisha-seed-hh-m3` | mother + **10-day-old newborn** + delivery report + `M3_DUPLICATES` (default 3) newborn-PNC reports due **today** | M3's visible duplicate pile |

Two facts behind those choices, both verified against the config:
- `is_immunization_defaulter` is only computed inside `if (isNewborn)`, so
  the M4 flag renders in-app **only for newborns** — an older under-5 would
  prove the predicate but show nothing.
- M3's task event is `{start: 0, end: 14}` with due date = today + 3, so a
  freshly submitted visit's task is `Draft` (invisible) for three days.
  The seeded reports carry a follow-up due **today** so the pile is `Ready`
  immediately; only the date is synthetic.

Then log in once as `demo_chv` at `https://localhost:10443`, **Sync now**,
confirm the four lanes render, log out.

### 1.10 [OPERATOR] Build and start the agent container

Mandatory, not routine: the container is a **separate compose project**
(starting the CHT stack neither starts nor rebuilds it), and QA support for
four of the five tickets exists only on the current branch line.

```bash
cd <workbench>
export CHT_CORE_PATH=~/ai_medic/medic-cht-agent/<cht-core-checkout>
export CHT_CONF_PATH=~/ai_medic/medic-cht-agent/demo-conf
docker compose -f docker/docker-compose.cht-agent.yml build
docker compose -f docker/docker-compose.cht-agent.yml up -d --force-recreate
docker exec cht-agent claude -p "say ok"           # OAuth preflight
docker exec cht-agent ls /app/tickets | grep -E 'maisha|echis'
```

`--force-recreate` re-binds the host OAuth credentials mount: Claude Code
rotates that file by atomic rename, so a long-lived container keeps a stale
inode and eventually gets the grant revoked. **Recreate at the start of
every demo day.**

Compose already defaults the rest: `LLM_PROVIDER=claude-cli`,
`CHT_URL=https://nginx`, `CHT_CONF_PATH=/workspace/cht-conf-project`,
`CHT_CONF_BIN=<mount>/node_modules/.bin/cht`. Set
`ANTHROPIC_MODEL=claude-opus-4-8` unless you intend to spend the session
budget, and TLS trust — `NODE_EXTRA_CA_CERTS=/workspace/local-ca.crt`
(preferred) or `NODE_TLS_REJECT_UNAUTHORIZED=0` for self-signed.

### 1.11 [OPERATOR] Preflight — one screen of assertions

```bash
# instance up + right version
curl -sk https://localhost:10443/api/v2/monitoring | head -c 80
# the four bugs are live on the deployed config
curl -sk -u medic:password https://localhost:10443/api/v1/settings | grep -c posnatal_care_service_newborn   # M3 typo → 1
curl -sk -u medic:password 'https://localhost:10443/api/v1/forms/contact:e_household:create.xml' \
  | grep -o '<bind nodeset="/data/repeat/child/is_orphan[^>]*>'                                             # M7 age-only gate
curl -sk -u medic:password 'https://localhost:10443/api/v1/forms/contact:f_client:create.xml' \
  | grep -c 'hh_member_education_lvl[^>]*calculate'                                                         # M8 → 1
curl -sk -u medic:password https://localhost:10443/api/v1/forms/postnatal_care_service.xml \
  | grep -o '<bind nodeset="[^"]*next_pnc_visit_date"[^>]*>'                                                # M5: no relevant=
# config repo prerequisites
cd ~/ai_medic/medic-cht-agent/demo-conf && git remote -v && git status --short && ls node_modules/.bin/cht
git check-ignore -v .cht-agent/xlsform-fix.json || echo 'descriptor visible to git ✔'
# agent alive
docker exec cht-agent claude -p "say ok"
```

The last check matters: a bare `.cht-agent` line in the config repo's
`.gitignore` hides the fix descriptor and every XLSForm ticket dies as
`execute-no-op`. Current pipeline versions ignore only `.cht-agent/pr` and
narrow a legacy entry automatically, but check it anyway on an older repo.

### 1.12 [OPERATOR] Freeze the baseline (this is what every reset restores)

```bash
# 1. where does CouchDB actually keep its data? (differs per stack flavour)
docker inspect <project>-couchdb-1 \
  --format '{{range .Mounts}}{{.Type}} src={{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
#   bind   → a host directory (published-compose stacks: <stack-dir>/srv)
#   volume → a named volume (local-images stacks)

cd <stack-dir>
docker compose --env-file ./.env -f cht-core.yml -f cht-couchdb.yml \
  -f <workbench>/docker/cht-agent-net.override.yml stop
mkdir -p ~/maisha-volsnap
# BIND-MOUNT stack:
sudo cp -a srv ~/maisha-volsnap/couch-data
# NAMED-VOLUME stack instead:
#   for v in $(docker volume ls -q | grep "^<project>_"); do
#     docker run --rm -v "$v":/from -v ~/maisha-volsnap/"$v":/to alpine sh -c 'cd /from && cp -a . /to'; done
docker compose --env-file ./.env -f cht-core.yml -f cht-couchdb.yml \
  -f <workbench>/docker/cht-agent-net.override.yml start
```

Derive the location from `docker inspect` — do not assume. A volume loop
with the wrong project prefix "succeeds" while copying nothing, and you
find out two tickets later.

---

## 2. The per-ticket loop

Run this six-phase loop once per ticket, in the §0 order. Everything is
`[OPERATOR]` except phase C.

### Phase A — reset (≈3 min; run it before ticket 1 too)

```bash
TICKET=m5      # m5 | m8 | m7 | m4 | m3 — the one you are ABOUT to run
PREV=none      # the one you just finished, or none

# A1. capture the finished ticket's work, then re-baseline the repo
cd ~/ai_medic/medic-cht-agent/demo-conf
[ "$PREV" != none ] && git add -A && git commit -q -m "$PREV: agent-generated fix (demo run)"
git checkout -q -B fix/maisha-$TICKET maisha-baseline
git clean -qfd                     # drop generated specs + the fix descriptor
rm -rf .cht-agent/pr               # ⚠️ REQUIRED: the bundle dir is gitignored, so
#   `git clean -fd` leaves it, and the writer only overwrites its two files. A run
#   that ends in HC5 `abandon` (or dies before the bundle) writes nothing — leave
#   the old one there and Phase D archives the PREVIOUS ticket's PR as this one's.
git status --short                 # MUST be empty

# A2. restore the instance to the frozen baseline
cd <stack-dir>
docker compose --env-file ./.env -f cht-core.yml -f cht-couchdb.yml \
  -f <workbench>/docker/cht-agent-net.override.yml stop
sudo rsync -a --delete ~/maisha-volsnap/couch-data/ srv/        # bind-mount stack
docker compose --env-file ./.env -f cht-core.yml -f cht-couchdb.yml \
  -f <workbench>/docker/cht-agent-net.override.yml start
curl -sk https://localhost:10443/api/v2/monitoring | head -c 60

# A3. refresh the cohorts (newborn DOBs are relative to now; is_newborn needs <28 days)
cd <workbench> && node demo/maisha-seed/seed-maisha-cohorts.js

# A4. prove the reset landed
curl -sk -u medic:password https://localhost:10443/api/v1/settings | grep -c posnatal_care_service_newborn   # 1 = buggy baseline live

# A5. fresh browser: close every demo window, open a NEW incognito/guest one,
#     log in as demo_chv, let the initial sync finish.
```

Never reuse a browser profile across a restore — its replication
checkpoints are ahead of the restored server. The `cht-agent` container
keeps running across CHT restarts; only recreate it (§1.10) at day start or
after switching workbench branches.

### Phase B — RED (prove the symptom on the deployed config)

Run the per-ticket content check from §3, and where it is part of the story,
the browser reproduction. Do this **before** the agent runs: QA aborts on a
non-reproducing symptom, and you want to have seen it yourself.

### Phase C — [AGENT] run the pipeline

```bash
docker exec -it cht-agent npm run full -- tickets/<ticket-file> --qa --qa-tier2
#                                      ^^ the `--` is LOAD-BEARING: npm swallows
#   unknown flags before it, so `npm run full <ticket> --qa` runs WITHOUT QA.
```

Five human checkpoints. Know what each is before you are staring at it:

| Gate | What it shows | Your call |
|---|---|---|
| **HC1** research | frontmatter-routed findings (no LLM routing call), code context | approve / feed back |
| **HC2** development | for XLSForm tickets a **bind-level per-attribute diff** verified against a real offline convert; for JS tickets a plain git diff | approve / reject |
| **HC3** QA destructive gate | reached only after RED reproduced on the deployed config | approve the seed+apply |
| **HC4** QA failure | QA evidence when it did not pass | spend another dev pass, or stop |
| **HC5** scope of the fix | deferred recommendations, scope-limited items, tier-2 attribution | `accept` / `widen` / `widen-relax` / `abandon` |

`--qa-auto` auto-approves HC3 for unattended runs (it also suppresses HC4's
prompt). `abandon` at HC5 writes **no** PR bundle and names the files to
revert.

QA order is fixed: provision → discover(pre) → **reproduce RED** (abort if
the symptom is absent) → HC3 → seed → apply → discover(post, rev change) →
**verify GREEN** → tier-2.

### Phase D — collect the PR output

The config repo is bind-mounted, so the bundle is already on the host — no
`docker cp` needed:

```bash
BUNDLE=~/ai_medic/medic-cht-agent/demo-conf/.cht-agent/pr
# freshness first — a missing/stale bundle means the run did NOT produce one
# (HC5 abandon, or an abort). Never archive a bundle you cannot date to this run.
ls -l --time-style=+%H:%M $BUNDLE/PR.md $BUNDLE/changes.patch
head -5 $BUNDLE/PR.md                      # must name THIS ticket's artifact
mkdir -p ~/maisha-pr-archive/$TICKET && cp $BUNDLE/PR.md $BUNDLE/changes.patch ~/maisha-pr-archive/$TICKET/
# does it apply to the PRISTINE partner clone? (the real acceptance test)
git -C ~/ai_medic/medic-cht-agent/site-config apply --check --binary \
  ~/maisha-pr-archive/$TICKET/changes.patch && echo "✔ $TICKET patch applies clean"
```

`--binary` matters: XLSForm fixes carry binary `.xlsx` hunks. Copy the
bundle out **before** Phase A's `git clean`.

### Phase E — GREEN + archive the evidence

Run the per-ticket GREEN check from §3 (content, browser, tier-2). Then
append the run to your log: ticket, HC5 choice, QA verdict (reproduced /
verified / rev change / tier-2), patch size + file count, anything you had
to work around.

### Phase F — next ticket

Back to Phase A with `TICKET`/`PREV` advanced. Five passes total.

---

## 3. The five tickets

Each section gives only what is specific to that ticket; the loop in §2 is
the same every time.

### 3.1 M5 — PNC keeps prompting for the next visit date (`form`)

`tickets/demo-echis-pnc-ticket.md` · artifact `postnatal_care_service` ·
apply bucket `app-forms`.

The `next_pnc_visit_date` bind carries **no `relevant` at all**, so every
follow-up visit demands scheduling the next postnatal appointment —
including when the visit's reason is that the pregnancy ended.

**RED (content)**
```bash
curl -sk -u medic:password https://localhost:10443/api/v1/forms/postnatal_care_service.xml \
  | grep -o '<bind nodeset="[^"]*next_pnc_visit_date"[^>]*>'
# buggy: type="date" … required="true()" with NO relevant=
```

**RED (browser)** — needs **two visits**, because the "Mother PNC Danger
Signs" page only renders for a woman with a recorded delivery. Visit 1: on
an `f_client` woman → "Mother and Newborn PNC Home Visit Service" → "Has
she delivered?" **Yes** → mother Alive, delivery a couple of days ago →
outcome 1 delivered / 1 alive → newborn details → danger signs No → submit
→ **Sync now**. Visit 2: tap the PNC follow-up task on her profile → "Is
she available?" **Yes** → the form lands on Mother PNC Danger Signs and
**"Enter next PNC visit date" is required unconditionally** — try to
advance with it empty and the form refuses. Full narrative:
`demo-conf/DEMO-STEPS.md` §3b.

**Expected HC2** — bind-level diff on `next_pnc_visit_date`:
`(absent) → " /postnatal_care_service/group_pregnancy_status/has_delivered ='yes'"`,
N sibling binds unchanged. The corrected **`.xlsx` and regenerated `.xml`**
both land in the mount.

**GREEN** — the curl shows the gate; in the browser (Sync now first) Visit 2
no longer asks for the date, while the genuine delivery path (Visit 1 on a
different woman) still does. Tier-2 runs the generated
`test/forms/postnatal_care_service.agent.spec.js`.

**Note for the handback:** post-fix, follow-up visits can no longer record
the MCH booklet's next appointment even optionally. Nothing in-config
consumes those fields (verified), but partner analytics might — surface it
in the PR.

### 3.2 M8 — education select corrupted by a `calculate` (`contact-form`)

`tickets/maisha-m8-education-field-calculate.md` · artifact
`f_client-create` · apply bucket `contact-forms` · deployed id
`contact:f_client:create`.

A choice-filter expression was mis-mapped into the **`calculate`** column of
a required user-answerable select, so the calculate overwrites whatever the
CHP picks with a value that is not a valid choice. Same defect on
`hh_member_occupation`.

**RED (content)**
```bash
curl -sk -u medic:password 'https://localhost:10443/api/v1/forms/contact:f_client:create.xml' \
  | grep -o '<bind nodeset="/data/f_client/hh_member_education_lvl"[^>]*>'
# buggy: carries calculate="member_filter = … or over_5= … or member_filter = 2"
```

**RED (browser)** — in `maisha-seed-hh-m8`, register a new household member;
set education status to "at school"; the required **Level of Education**
select will not hold the selection.

**Expected HC2** — an **absence** assertion: `calculate: <expr> → (absent)`
with `relevant` and `required` unchanged. The descriptor uses
`set: {column: 'calculation', clear: true}`.

⚠️ Guardrail worth knowing: clearing the `calculation` column on a row whose
*type* is `calculate` makes pyxform hard-fail the whole convert
(`Missing calculation`). The editor refuses that case up front with a
descriptive error. M8's rows are `select_one`, so they are the legal case.

**GREEN** — the curl shows no `calculate` on either bind; in the browser
(Sync now) the selection sticks for every choice, still required, still
gated on `at_school`/`left_school`. Tier-2 runs the generated
`test/forms/f_client-create.agent.spec.js`, whose oracle asserts the
attribute is **absent**.

### 3.3 M7 — orphan question ignores captured parent status (`contact-form`)

`tickets/maisha-m7-orphan-question-relevant.md` · artifact
`e_household-create` · apply bucket `contact-forms` · deployed id
`contact:e_household:create`.

`is_orphan` is gated only on age, ignoring the `father_alive`/`mother_alive`
answers captured moments earlier in the same form.

**RED (content)**
```bash
curl -sk -u medic:password 'https://localhost:10443/api/v1/forms/contact:e_household:create.xml' \
  | grep -o '<bind nodeset="/data/repeat/child/is_orphan"[^>]*>'
# buggy: relevant="../age_in_years_member &lt; 18"   (age only)
```

**RED (browser)** — in `maisha-seed-hh-m7`, register a household child;
father alive **Yes**, mother alive **Yes** → the orphan question still
appears.

**Expected HC2** — `relevant` widened to the age gate AND NOT (both parents
alive).

**Scope call, decide before you run:** the ticket names three affected
forms (`e_household-create`, `f_client-create`, and the reminder app form).
The descriptor is single-form by design. Demo the reported surface
(`e_household-create`) and treat the siblings as two further runs or a
follow-up — HC5 will surface the narrowing, and `accept` is the right
answer. Do not iterate live.

**GREEN** — curl shows the widened gate; both-parents-alive child skips the
question; a child with a parent deceased or unknown still gets it
(no-regression half).

### 3.4 M4 — fully-immunized child flagged as defaulter (`contact-summary`)

`tickets/maisha-m4-immunization-defaulter-false-positive.md` · artifacts
`contact-summary.templated.js` + `tasks.js` · apply bucket `app-settings`.

The defaulter flag compares a **count** of distinct recorded vaccine tokens
against an age-banded expected integer (`!==`), so any divergence — an
extra optional dose, a dose ahead of schedule — reads as "defaulter",
including for fully-immunized children. The correct coverage predicate
already exists in the same file.

**RED (browser, primary)** — open the seeded 14-day-old newborn in
`maisha-seed-hh-m4`: the defaulter flag/branch shows despite the child being
complete-for-age (BCG + OPV0) plus one early extra dose (OPV1). There is no
crisp settings-grep here — the bundle is minified and this predicate has no
unique string literal, which is exactly why P4's oracle compares the
compiled settings byte-for-byte instead.

**RED (partner suite)** — the ticket pins its regression surface in
frontmatter (`qaSpecs`: `test/contact-summary.spec.js`,
`test/tasks/defaulter_follow_up.spec.js`,
`test/tasks/immunization_service.spec.js`). All three pass on the buggy
baseline, so tier-2 gates regressions without false-blocking. The
fix-*proving* case (the over-immunized child) comes from the agent's
generated spec — check at HC2 that one exists, and if not, add it before
you rely on tier-2 as proof.

**Expected HC2** — a plain git diff replacing the length-inequality at
`contact-summary.templated.js:175` and its mirror at `tasks.js:1329` with
the coverage predicate; optionally retiring the dead
`imm_schedule_upto_date` predicate at `tasks.js:1007`. The dev phase's
compile gate has already proven `compile-app-settings` passes.

**GREEN** — QA's compiled-settings oracle: it compiles the corrected source
offline in a sandbox and byte-compares the artifact-owned sections against
the deployed settings (RED before apply, GREEN after), with the settings-doc
rev as corroboration. In the browser, in a fresh incognito window, the
fully-immunized newborn no longer shows the flag while a genuinely
missing-dose child still does.

### 3.5 M3 — newborn PNC follow-up tasks duplicate (`task`)

`tickets/maisha-m3-newborn-pnc-task-duplication.md` · artifact `tasks.js` ·
apply bucket `app-settings`.

The newborn immunization follow-up task is report-based, so one task is
emitted per qualifying report — and its `resolvedIf` is broken twice over:
it resolves against a **misspelled form id** (`posnatal_…`, which can never
match a real submission) and it omits the `sourceID` argument, so there is
no per-source dedup.

**RED (content)**
```bash
curl -sk -u medic:password https://localhost:10443/api/v1/settings | grep -o posnatal_care_service_newborn
# a match ⇒ the broken resolver is live (this typo survives minification)
curl -sk -u medic:password 'https://localhost:10443/medic/_all_docs?include_docs=true&limit=3000' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      JSON.parse(s).rows.map(r=>r.doc).filter(d=>d&&d.type==="task"&&JSON.stringify(d).includes("maisha-seed-m3-newborn"))
        .forEach(t=>console.log(t.state,"| due",t.emission.dueDate,"|",t.emission.title,"|",t.emission._id));})'
# THREE Ready `task.pnc_newborn_immunization.title` rows, each keyed by a
# different source report — one per visit, none resolved.
```

**RED (browser)** — Tasks tab (or the newborn's profile): **three identical
"PNC newborn immunization referral" cards** for one baby. The live
mechanism, if you want to show it: run the click-path below once more and a
fourth task is emitted (`Draft`, due in 3 days — see §1.9).

| Page | Question | Answer |
|---|---|---|
| Newborn PNC Home Visit | Who is the caregiver today? | **Mother** |
| | Place of delivery | **Home** (pre-filled) |
| | Have you referred … to the health facility? | **No** |
| PNC Danger Signs (Child) | Ask for the following danger signs | **None** ← only this |
| | Is …'s immunization upto date? | **No** ← calculates the follow-up |
| Summary | — | **Submit** |

Check **None**, not a real danger sign: any danger sign also emits a
danger-signs referral task and opens a red "refer immediately" branch —
noise in a demo about immunization duplicates. (The immunization question
appears because `is_immunization_defaulter='yes'`; the seeded newborn has no
immunization reports, so she reads as a defaulter under both the buggy and
the corrected predicate — the path is safe regardless of M4's state.)

**The strongest visible RED** — open ONE of the three cards, complete its
immunization referral: **all three cards disappear.** One referral silently
closed three separate visits' follow-ups. Then reset (§2 Phase A) so the
pile is back before the fix.

**Expected HC2** — `posnatal_` → `postnatal_` at `tasks.js:1368` plus
`report._id` passed as the `sourceID` argument, mirroring the mother-side
template at `tasks.js:207-215`.

**GREEN** — the settings-grep returns nothing, and QA's compiled-settings
oracle flips RED→GREEN. In the browser, ⚠️ **the three cards do NOT
vanish** — that is correct, each visit still needs its own referral. The
change is the resolution behaviour: **complete one card's referral and only
that card clears; the other two remain.** (Verified in the partner rules
engine: pre-fix 3→0, post-fix 3→2.)

**Ordering note:** the harness reads the **compiled** `app_settings.json`,
not `tasks.js` — so tier-2 only exercises this fix after a
`compile-app-settings`, which is why QA's `app-settings` apply runs before
tier-2.

---

## 4. After the run — analysing the five PR bundles

Each `~/maisha-pr-archive/<ticket>/` holds:

- **`PR.md`** — the description to paste: what changed and why, the QA
  evidence (reproduced / applied / verified, rev change, tier-2 verdict with
  baseline attribution), the files the patch contains, any **dirty files it
  deliberately excluded** with reasons, and a checklist of **deferred
  recommendations** — things validation flagged that the pipeline chose not
  to fix. Read that checklist first; it is the honest edge of the change.
- **`changes.patch`** — scoped to the files *this ticket's* development
  phase wrote (earlier versions took every dirty file in the mount and once
  shipped a 779 KB patch carrying six unrelated specs). Binary hunks are
  included, so `.xlsx` fixes apply.

Review pass per bundle:

1. `git -C site-config apply --check --binary changes.patch` — must be clean.
2. Does the patch touch **only** what the ticket declared? For M5/M8/M7 that
   is one `.xlsx` + its regenerated `.xml` (+ possibly a generated spec);
   for M4/M3 the named JS files.
3. Does the diff match the HC2 bind diff / git diff you approved?
4. Is `app_settings.json` absent from the patch? It is generated and
   gitignored in the config repo — it should never be in a PR.
5. Does the QA section show a real transition (RED evidence, apply, rev
   change, GREEN evidence) rather than a skip?
6. For M5/M8/M7: is the generated harness spec included and does it assert
   the fix (including *absence* for M8)?
7. Anything in the deferred-recommendations checklist you want fixed before
   the PR goes up?

Then, per ticket, open the PR against the partner repo yourself: apply the
patch on a branch off the pristine clone, paste `PR.md`, add the partner
decisions the ticket raised (M5's optional next-appointment capture; M7's
two sibling forms).

---

## 5. Traps that actually bit us

| Trap | Symptom | Guard |
|---|---|---|
| `npm run full <ticket> --qa` without `--` | runs with **no QA**, silently | always `npm run full -- <ticket> --qa` |
| Agent container not rebuilt | old guards abort `--qa` for non-`form` artifacts | §1.10 build + `--force-recreate` per demo day |
| `docker compose start` on the CHT stack | `cht-agent` still not running | it is a separate compose project |
| Bare `.cht-agent` in the config `.gitignore` | XLSForm tickets die as `execute-no-op`, descriptor on disk | preflight `git check-ignore`; current pipeline ignores only `.cht-agent/pr` |
| Volume-loop snapshot with the wrong project prefix | "successful" snapshot of nothing; resets silently do nothing | derive the data path from `docker inspect` (§1.12) |
| Stale snapshot | newborn cohorts age past `is_newborn` (28 days); M4/M3 stop reproducing | re-run the seeder after every restore (§2 A3) |
| Reused browser profile after a restore | client checkpoints ahead of the server; nothing looks right | fresh incognito window per ticket |
| Stale OAuth mount | `401 OAuth access token has been revoked` mid-run | host `claude -p` + `--force-recreate` |
| Config repo missing `npm ci` | dev convert / QA apply / P4 compile / tier-2 all fail differently | §1.5 |
| Stale PR bundle survives the reset | you archive the previous ticket's PR as this ticket's | `rm -rf .cht-agent/pr` in Phase A + the freshness check in Phase D |
| Expecting M3's cards to vanish post-fix | looks like the fix did nothing | the change is *which* card clears (§3.5) |
| Expecting M4's flag on an older child | flag never renders | it is newborn-only (§1.9) |

---

## 6. Reference

| Thing | Path / command |
|---|---|
| Neutralize a fresh config clone | `node demo/setup/neutralize-config.js --config <repo> [--check] [--strict]` |
| Seed / refresh cohorts | `node demo/maisha-seed/seed-maisha-cohorts.js` (`M3_DUPLICATES=N`) |
| Run a ticket | `docker exec -it cht-agent npm run full -- tickets/<f> --qa --qa-tier2` |
| PR bundle (host side) | `<CHT_CONF_PATH>/.cht-agent/pr/{PR.md,changes.patch}` |
| Agent compose | `docker/docker-compose.cht-agent.yml` (project separate from the CHT stack) |
| CHT-net override | `docker/cht-agent-net.override.yml` |
| Deep dives | `maisha-demo-runbook.md` (reset model, browser detail), `demo-conf/DEMO-STEPS.md` (M5), `all-config-artifacts-pipeline-plan.md` (why each artifact works), `cht-conf-extension-pr-ledger.md` (PR train) |

Teardown when the engagement closes: `docker compose down -v` on both
projects, and delete `~/maisha-volsnap` and `~/maisha-pr-archive` once the
PRs are up.
