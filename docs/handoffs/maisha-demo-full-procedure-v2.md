# Maisha demo — full procedure v2: five tickets, five PR bundles

**Canonical runbook, v2 (2026-08-25).** Supersedes the v1 runbook (removed from the tree; every finding from its
review is folded in below). One continuous procedure that takes a
machine with nothing set up to five reviewed PR bundles — one per Maisha Meds
ticket — each produced by the agent pipeline against a reconstructed partner
deployment, with a provable data reset between tickets.

**What you end with:** `$PR_ARCHIVE/<ticket>/{PR.md,changes.patch}` ×5, each
patch applying cleanly to the pristine clone at `$SITE_CONFIG`, plus
per-ticket red→green evidence.

**Legend:** `[OPERATOR]` = you (git/docker/browser/curl). `[AGENT]` = the
pipeline. Every git/docker command is yours; the agent never pushes.

| # | Ticket file | `configArtifact` | Fix lands in | Why this order |
|---|---|---|---|---|
| 1 | `tickets/demo-echis-pnc-ticket.md` (M5) | `form` | `forms/app/postnatal_care_service.xlsx` + `.xml` | The proven path — app form, three-tier verified. Warm-up. |
| 2 | `tickets/maisha-m8-education-field-calculate.md` | `contact-form` | `forms/contact/f_client-create.*` | First contact form; attribute REMOVAL (`calculate`). |
| 3 | `tickets/maisha-m7-orphan-question-relevant.md` | `contact-form` | `forms/contact/e_household-create.*` | Contact form, `relevant` widening. |
| 4 | `tickets/maisha-m4-immunization-defaulter-false-positive.md` | `contact-summary` | `contact-summary.templated.js` + `tasks.js` | First settings-artifact ticket. |
| 5 | `tickets/maisha-m3-newborn-pnc-task-duplication.md` | `task` | `tasks.js` | The showpiece (duplicate task pile). |

Time budget: setup ≈ 2–3 h cold (image builds + `npm ci`); ≈ 25–35 min per
ticket after that.

---

## 0. Environment

### 0.1 The variable block — source it in EVERY terminal

Save this once and `source` it in every shell you open for this procedure.
**Every command below assumes these are set** — that includes the compose
invocations (`CHT_CONF_PATH`/`CHT_CORE_PATH` are read by
`docker-compose.cht-agent.yml` at `up` time; an unset `CHT_CONF_PATH` silently
mounts a placeholder config and every cht-conf ticket fails).

```bash
cat > ~/maisha-demo.env <<'EOF'
# ---- roots -------------------------------------------------------------
export AI_ROOT=~/ai_medic/medic-cht-agent
export WORKBENCH=$AI_ROOT/cht-agent-workbench          # this repo, branch fix/pipeline-hardening+
export CHT_CORE_PATH=$AI_ROOT/cht-core                 # cht-core checkout (4.21.1 line); full clone, not a worktree
export SITE_CONFIG=$AI_ROOT/site-config                # PRISTINE partner clone: never edit, never run git in it
export CHT_CONF_PATH=$AI_ROOT/demo-conf-neutralized    # the DEMO WORKING COPY the agent mounts and edits
export STACK_DIR=$AI_ROOT/cht-421-official             # CHT test-instance compose dir
# ---- save points ---------------------------------------------------------
export SNAP_DIR=~/maisha-volsnap                       # frozen CouchDB baseline (Phase A restores this)
export PR_ARCHIVE=~/maisha-pr-archive                  # per-ticket PR bundles
# ---- host-side cht-conf --------------------------------------------------
# 127.0.0.1, NEVER localhost: the AuthSession cookie for domain "localhost"
# is rejected by tough-cookie and every upload verb dies with
# "status code = undefined". (curl checks may still use localhost.)
export URL='https://medic:password@127.0.0.1:10443'
export FLAGS='--force --skip-git-check --skip-version-check --skip-dependency-check --skip-translation-check --accept-self-signed-certs'
# webpack-4 (pinned cht-conf) uses MD4 hashing that OpenSSL 3 removed;
# without this, host compile-app-settings dies with ERR_OSSL_EVP_UNSUPPORTED.
export NODE_OPTIONS=--openssl-legacy-provider
# agent's own fetch must tolerate the self-signed test cert
export NODE_TLS_REJECT_UNAUTHORIZED=0
EOF
source ~/maisha-demo.env
# $CHT (the repo-pinned cht binary) is usable only after §1.5's npm ci:
export CHT=$CHT_CONF_PATH/node_modules/.bin/cht
```

Add `source ~/maisha-demo.env && export CHT=$CHT_CONF_PATH/node_modules/.bin/cht`
to the top of every new terminal session for the duration of the engagement.

### 0.2 Prerequisites

- **Access to the partner config repo** (private) — you need the clone URL
  from the engagement owner. Nothing in this procedure pushes to it.
- **A `medic/test-data-generator` checkout** (with `npm ci` run) at
  `$AI_ROOT/test-data-generator` — the hierarchy and CHV user are generated
  synthetically (§1.8 Route A). No partner data export is needed for
  seeding. (The eCHIS handover never included a contacts/reports export —
  the only partner JSON on disk is device telemetry, unusable for seeding.
  If a future engagement *does* hand one over, §1.8 Route B uses it.)
- **cht-core checkout** at the deployed version (4.21.1 or the partner fork)
  at `$CHT_CORE_PATH` — used to build test images and mounted into the agent.
- **Docker** (compose v2), **Node ≥ 22.17**, ~15 GB free disk, host ports
  10080/10443 free.
- **A Claude subscription login** for the agent. You will authenticate INSIDE
  the container (§1.10) — a host `claude` login does not propagate. For
  unattended runs, mint a token on any logged-in machine with
  `claude setup-token` and `export CLAUDE_CODE_OAUTH_TOKEN=<token>` before
  bringing the container up.
- **This workbench** checked out at `$WORKBENCH` on the
  `fix/pipeline-hardening` line or later. Make sure the compose file's
  `NODE_TLS_REJECT_UNAUTHORIZED` default (`:-0`) is committed on your branch —
  on older lines it defaulted to empty and QA's readiness poll burned 300 s
  and aborted. The env block above exports it anyway (belt and braces).

---

## 1. One-time setup

### 1.1 [OPERATOR] Install the workbench dependencies

```bash
cd $WORKBENCH && npm ci
```

Needed by `demo:build-seed` (ts-node) in §1.7. (`neutralize-config.js` and
`seed-maisha-cohorts.js` are dependency-free, but install once now and forget.)

### 1.2 [OPERATOR] Clone the partner config repo — twice

```bash
cd $AI_ROOT
git clone <partner-config-repo-url> site-config     # PRISTINE: never edit, never run git in it
cp -a site-config demo-conf-neutralized && rm -rf demo-conf-neutralized/.git
```

Two copies on purpose: `$SITE_CONFIG` is the thing your finished patches must
apply to (§4) and the only untouched record of production;
`$CHT_CONF_PATH` (demo-conf-neutralized) is the copy the agent mounts and
edits.

### 1.3 [OPERATOR] Neutralize the working copy (deterministic script)

```bash
cd $WORKBENCH
node demo/setup/neutralize-config.js --config $CHT_CONF_PATH
```

Idempotent. It: deletes `*:Zone.Identifier` download artefacts; sets
`branding.json` title to `CHT Demo`; neutralizes
`app_settings/base_settings.json` — **deletes `oidc_provider`** (→ password
login), **empties `outbound`**, and sets `app_url` to `https://nginx` (which
also removes the final `env.*` placeholders, so `compile-app-settings` needs
no env file); and **scrubs identifying prose deterministically**: `README.md`
is replaced with a neutral stub (the partner ops docs, GitHub org links and
Google Sheets URLs all lived there), `package.json` loses the org name,
org-named icon files under `resources/` are renamed on disk with their
`resources.json` references rewritten (keys unchanged), and `scripts/**` has
org tokens replaced and non-allowlisted URLs rewritten to
`https://example.invalid/removed` (CHT/medic/xlsform/ODK/CouchDB reference
links survive).

It does **not** touch `forms/`, `tasks.js`, `targets.js`,
`contact-summary*.js`, `translations/`, or `app_settings/` beyond the above —
the five bugs must stay intact and deployed bytes must match the baseline.
Partner artwork stays on disk in `branding/` — which is why **no step below
ever runs `upload-branding`**.

**Gate on a clean scan.** The SCAN section at the end must print
`✔ nothing matched`; confirm with:

```bash
node demo/setup/neutralize-config.js --config $CHT_CONF_PATH --check --strict && echo CLEAN
```

If `--strict` still exits 1, the scan names exactly what the scrub rules
missed (e-mails, phone numbers, an org alias not in the list — extend with
`--org "Name1,Name2"`); fix by hand or extend the rules, then re-run.

### 1.4 [OPERATOR] Install the config repo's pinned toolchain

```bash
cd $CHT_CONF_PATH && npm ci
export CHT=$CHT_CONF_PATH/node_modules/.bin/cht     # now resolvable
```

Non-negotiable — four separate stages read it: the dev phase's offline
convert, QA's apply, P4's offline `compile-app-settings` (webpack needs the
config's own `cht-nootils`/`dayjs`), and tier-2's repo-pinned
mocha + `cht-conf-test-harness`. The installed cht-conf may be a patch ahead
of the tickets' `chtConfVersion` (3.21.5 vs 3.21.4) — informational only.

### 1.5 [OPERATOR] Build the baseline repo — commit everything, THEN tag

Order matters: **the tag is created once, at the end of this step, after
every baseline commit.** (v1 tagged early and kept committing; the reset then
restored a tag missing the harness fix.)

Heads-up on the partner's own git hooks: §1.4's `npm ci` ran a `postinstall`
that copied `scripts/git-hooks/*` into `.git/hooks`. Two consequences —
(a) the very first commit prints a harmless
`fatal: ambiguous argument 'HEAD': unknown revision` (the hook's
`git rev-parse` on a repo with no commits yet; the commit still lands —
verify with `git log --oneline`), and (b) the pre-commit hook **refuses any
commit on a branch named `master`/`main`**, so rename the branch immediately
after the first commit. Nothing depends on the branch name — Phase A works
off the `maisha-baseline` tag.

```bash
cd $CHT_CONF_PATH
git init -q && git add -A
git commit -q -m "demo baseline: neutralized partner config, all five Maisha bugs present"
git log --oneline    # the commit MUST be here despite the hook's HEAD fatal
git branch -m demo-baseline   # the partner pre-commit hook blocks master/main
git remote -v      # MUST print nothing — remote-less means nothing can ever be pushed

# 1. tier-2 runs headless Chromium under cap_drop ALL — it needs --no-sandbox.
#    Environment fix, not a ticket fix: commit it into the baseline.
#    Add to harness.defaults.json (top level, next to "coreVersion"):
#      "args": ["--no-sandbox", "--disable-dev-shm-usage"],
$EDITOR harness.defaults.json
git add harness.defaults.json && git commit -q -m "test: pass Chromium --no-sandbox to the harness for container runs"

# 2. ignore ONLY the PR bundle dir. A bare `.cht-agent` line would hide the
#    XLSForm fix descriptor from git; the pipeline narrows such a line on
#    sight, but committing the correct entry now prevents per-run churn.
echo '.cht-agent/pr' >> .gitignore
git add .gitignore && git commit -q -m "chore: ignore the agent's PR bundle dir (.cht-agent/pr only)"
```

**Assert all five bugs are present in the tree — do not tag until this
passes.** (A reused or partner-patched clone may already carry a fix; the M5
fix bit v1 exactly this way.)

```bash
cd $CHT_CONF_PATH
echo "M5 (first line must have NO relevant=):"
grep -o '<bind nodeset="[^"]*next_pnc_visit_date"[^>]*>' forms/app/postnatal_care_service.xml | head -1
#   ⚠ CONTAMINATION TRAP (bit us live, 2026-08-26): if a ticket's HC2 has
#   ever written a fix into the mount, a reset that relies on `checkout -B`
#   alone CARRIES the fixed .xlsx over (the dirty-tree gotcha above), and a
#   later canonicalize commit then SWALLOWS the agent's fix into the baseline
#   tag. The tell: this grep shows the fix present in the tree while the
#   DEPLOYED form is still buggy, and the ticket's HC2 diff reads
#   `expr → expr` (whitespace only). Verify the WORKBOOK, not just the xml:
#     python3 -c "import zipfile; s=zipfile.ZipFile('forms/app/postnatal_care_service.xlsx').read('xl/sharedStrings.xml').decode(); print('babies_delivered} != 0' in s)"   # must print False
#   Decontaminate by restoring the file from the ORIGINAL import commit,
#   reconverting, committing, and re-tagging.
echo "M8 (expect 1 — attribute order varies, so match the bind first, then calculate):"
grep -o '<bind[^>]*hh_member_education_lvl"[^>]*>' forms/contact/f_client-create.xml | grep -c 'calculate='
echo "M7 (expect the age-only gate):"
grep -o '<bind nodeset="/data/repeat/child/is_orphan[^>]*>' forms/contact/e_household-create.xml
echo "M3 (expect 1):"
grep -c posnatal_care_service_newborn tasks.js
echo "M4 (expect the !== count predicate):"
grep -n 'requiredVaccines.length !== countTotalVaccinesByAge' contact-summary.templated.js tasks.js
```

If a bug is missing (e.g. the working copy carries an old demo fix), restore
the buggy files from the pristine clone before proceeding:
`cp $SITE_CONFIG/<path> <path> && git add <path> && git commit -m "baseline: restore <ticket> bug"`.
Also make sure no `test/forms/*.agent.spec.js` is tracked — agent-generated
specs belong to a fix's patch, not the baseline
(`git rm -q test/forms/<form>.agent.spec.js` if present).

Now, and only now:

```bash
git tag maisha-baseline
git status --short   # MUST be empty
```

Three properties, each has bitten us: a git repo with ≥1 commit (the code-gen
CLI snapshots/rolls back via git and the descriptor rides the diff capture);
no remote; all five bugs present **inside the tag**.

### 1.6 [OPERATOR] Bring up the CHT test instance

Published-image route (local-build alternative: `demo-runbook.md` §1 — and
note `export VERSION=4.21.1`, **not** `TAG=`):

```bash
mkdir -p $STACK_DIR && cd $STACK_DIR
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
  -f $WORKBENCH/docker/cht-agent-net.override.yml up -d
curl -sk https://localhost:10443/api/v2/monitoring | head -c 120   # expect version.app 4.21.1
```

The override joins `nginx` to `cht-agent-net` so the agent reaches the
instance at `https://nginx`.

Define the compose alias used by every stack stop/start below:

```bash
alias cht-stack='docker compose --env-file '$STACK_DIR'/.env -f '$STACK_DIR'/cht-core.yml -f '$STACK_DIR'/cht-couchdb.yml -f '$WORKBENCH'/docker/cht-agent-net.override.yml'
```

⚠ The alias (or a `CS="docker compose …"` variable) works only in an
INTERACTIVE shell. In a script — and in zsh especially, which does not
word-split unquoted variables — `$CS stop` becomes ONE command word and fails
with "no such file or directory", **while the surrounding steps keep going**:
the automated run's restore once ran against a LIVE CouchDB because its
stop/start silently failed this way. In anything scripted, write the full
`docker compose … stop` command inline (or `bash -c "…"`), and treat a
suspiciously instant post-restart "API warm" as the tell that no restart
actually happened.

### 1.7 [OPERATOR] Upload the buggy config with the repo-pinned cht-conf

Standard route (host has pyxform — most cht-conf machines do; cht-conf
3.21.x wants medic's fork, `pip install
git+https://github.com/medic/pyxform.git@medic-conf-1.17#egg=pyxform-medic`):

```bash
cd $CHT_CONF_PATH
$CHT --url=$URL --source=. $FLAGS compile-app-settings upload-app-settings
$CHT --url=$URL --source=. $FLAGS convert-app-forms upload-app-forms
$CHT --url=$URL --source=. $FLAGS convert-contact-forms upload-contact-forms
$CHT --url=$URL --source=. $FLAGS upload-resources upload-custom-translations
#   deliberately NO upload-branding — CHT default artwork stays on the throwaway env
```

**MANDATORY, whichever route you take: the deployed XML must be
converter-canonical.** The QA whole-document oracle compares the deployed
form against XML regenerated by the *pipeline's* converter (the agent
container's pyxform). The partner's originally-committed `.xml` serializes
differently (`&#10;` entities, attribute layout), so uploading it verbatim
guarantees an `ENVIRONMENT DRIFT` abort on every XLSForm ticket (observed
live: 18 drift lines on M5). Canonicalize once, commit, then upload:

```bash
# regenerate ALL form XML through the same converter the QA oracle uses
# (host pyxform if installed; otherwise the agent container — §1.10 — bakes it):
docker exec -it cht-agent bash -c 'cd /workspace/cht-conf-project && \
  node_modules/.bin/cht --source=. --skip-dependency-check --skip-version-check --skip-git-check \
  convert-app-forms convert-contact-forms'
cd $CHT_CONF_PATH && git status --short | head    # regenerated forms/**.xml
git add -A && git commit -m "baseline: canonicalize form XML through the pipeline converter"
git tag -f maisha-baseline
# re-run the §1.5 five-bug assertion — the bugs are semantic and survive
# conversion, but verify before trusting the new tag.
```

**No pyxform on the host?** After the canonicalize-and-commit above, the
`upload-*` verbs push the committed canonical XML byte-for-byte — no host
convert needed:

```bash
$CHT --url=$URL --source=. $FLAGS upload-app-forms
$CHT --url=$URL --source=. $FLAGS upload-contact-forms
```

Always the repo-pinned binary (`$CHT`), never a global cht-conf. Always
`$URL` (127.0.0.1) — see §0.1.

**VERIFY EVERY UPLOAD VERB — never pipe its output through `tail`/`grep` and
walk away** (bit the automated run: `set -e` cannot see the left side of a
pipe, so a dead `upload-app-forms` read as success and QA later 404'd on the
missing form). After the uploads, count what actually landed:

```bash
curl -sk -u medic:password 'https://localhost:10443/medic/_all_docs?startkey=%22form:%22&endkey=%22form:%EF%BF%B0%22' \
  | grep -o '"form:[^"]*"' | sort -u | wc -l    # ≈ app forms + contact forms + a few CHT built-ins
```

**cht-conf's overwrite prompt is tty-only and `--force` does NOT cover it.**
`upload-forms` compares each form against the deployed doc and, on a hash
mismatch (e.g. a half-written doc from an earlier crashed upload), asks
`[1,2,3] Overwrite?` via readline-sync reading `/dev/tty` directly — piped
stdin never reaches it, and a scripted run dies with "The current
environment doesn't support interactive reading from TTY". Unattended
remedy: run the verb under a pseudo-tty with the standard answer scripted:

```bash
printf '1\n1\n1\n1\n' | script -qec "$CHT --url=$URL --source=. $FLAGS upload-app-forms" /dev/null
```

### 1.8 [OPERATOR] Seed the hierarchy + an offline CHV user

The contact hierarchy is `a_county → b_sub_county → c_community_health_unit →
d_community_health_volunteer_area → e_household → f_client`, plus a `person`
CHV. You need one **password** user whose role can submit the PNC forms and
holds `can_create_records` (`community_health_volunteer` — offline, and in
this config's `can_create_records` list). Not `medic` — that is an online
admin and shows no offline app.

**Route A — synthetic (the route this demo has always actually used; no
partner data needed).** `test-data-generator` pushes a generated branch
(Demo County → … → Demo CHV Area, a "Demo CHV" person, faker households)
straight to CouchDB, then `create-users` makes the login user by hand:

```bash
# 1. generate the hierarchy (design file ships in the workbench)
cp $WORKBENCH/demo/maisha-seed/demo-seed-design.js $AI_ROOT/test-data-generator/
cd $AI_ROOT/test-data-generator
COUCH_URL='https://medic:password@127.0.0.1:10443/medic' NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npm run generate ./demo-seed-design.js

# 2. discover the generated CHV person + area ids
curl -sk -u medic:password 'https://localhost:10443/medic/_all_docs?include_docs=true&limit=2000' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const d=JSON.parse(s).rows.map(r=>r.doc).find(x=>x&&x.type==="contact"&&x.contact_type==="person"&&x.name==="Demo CHV");
      console.log("contact:",d._id); console.log("place:  ",d.parent._id);})'

# 3. create the demo_chv login (paste the two ids from step 2)
mkdir -p /tmp/maisha-users-project
cat > /tmp/maisha-users-project/users.csv <<EOF
username,password,roles,contact,place,fullname
demo_chv,ChangeMe_123,community_health_volunteer,<CHV_PERSON_ID>,<CHV_AREA_ID>,Demo CHV
EOF
$CHT --url=$URL --source=/tmp/maisha-users-project $FLAGS create-users
```

**Route B — from a real handover export** (only if the engagement handed
over a scrubbed contacts/reports JSON export)

```bash
export SEED_EXPORT=<path-to-scrubbed-contacts-reports.json>   # array or {docs:[…]}
export SEED_USERS=<path-to-users.json>                        # optional; rows need username/name
cd $WORKBENCH
npm run demo:build-seed -- --export $SEED_EXPORT \
  --app-settings $CHT_CONF_PATH/app_settings.json \
  --users $SEED_USERS --out /tmp/maisha-seed-project
cd $CHT_CONF_PATH
$CHT --url=$URL --source=/tmp/maisha-seed-project $FLAGS csv-to-docs upload-docs create-users
```

Either route: the password is **`ChangeMe_123`** (hand-set in Route A; the
builder's default in Route B). The cohort seeder (§1.9) discovers the
hierarchy from the user named `demo_chv` by default — a different username
needs `DEMO_CHV_USER=<username>` exported before every seeder run.

### 1.9 [OPERATOR] Seed the per-ticket cohorts

```bash
cd $WORKBENCH
CHT_URL=https://localhost:10443 COUCHDB_USER=medic COUCHDB_PASSWORD=password \
  node demo/maisha-seed/seed-maisha-cohorts.js
```

Idempotent; every `_id` is prefixed `maisha-seed-`; the hierarchy is
discovered from the `demo_chv` user (override: `DEMO_CHV_USER`). One
household lane per ticket so reproductions never share contacts:

| Lane | Contents | Used by |
|---|---|---|
| `maisha-seed-hh-m8` | one adult `f_client` | M8 registers a new member live |
| `maisha-seed-hh-m7` | one adult `f_client` | M7 registers a child live |
| `maisha-seed-hh-m4` | mother + **14-day-old newborn** + `immunization_service` report (`bcg opv_0 opv_1`) | M4's RED cohort |
| `maisha-seed-hh-m3` | mother + **10-day-old newborn** + delivery report + `M3_DUPLICATES` (default 3) newborn-PNC reports due **today** | M3's visible duplicate pile |

Two facts behind those choices, both verified against the config:
- `is_immunization_defaulter` is only computed inside `if (isNewborn)`
  (`contact-summary.templated.js:171-176`), so the M4 flag renders in-app
  **only for newborns**.
- M3's task event is `{start: 0, end: 14}` with dueDate = the form-calculated
  `immunization_follow_up_date` = today + 3, so a fresh submission's task is
  `Draft` (invisible) for three days. The seeded reports carry a follow-up
  due **today** so the pile is `Ready` immediately; only the date is
  synthetic.

Then log in once as `demo_chv` / `ChangeMe_123` at `https://localhost:10443` —
CHT **forces a password change on this first login**; pick one and record it
(no script uses it: the seeder, QA and cht-conf all authenticate as `medic`;
this password is browser-login-only). **Sync now**, confirm the four lanes
render, log out. Do this BEFORE §1.12's freeze — the password lives in
CouchDB, so a freeze taken before the change re-prompts you after every
Phase A restore.

### 1.10 [OPERATOR] Build and start the agent container

The container is a **separate compose project** — starting the CHT stack
neither starts nor rebuilds it. `$CHT_CORE_PATH` and `$CHT_CONF_PATH` **must
be exported in this shell** (source `~/maisha-demo.env`): compose reads them
at `up`, and an unset `CHT_CONF_PATH` silently mounts a placeholder config —
the run then fails with an empty project, or edits the wrong tree.

```bash
cd $WORKBENCH
docker compose -f docker/docker-compose.cht-agent.yml build
docker compose -f docker/docker-compose.cht-agent.yml up -d --force-recreate

# VERIFY THE MOUNT — this catches the missing-export mistake immediately:
docker inspect cht-agent --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}' | grep conf-project
#   must print $CHT_CONF_PATH -> /workspace/cht-conf-project (NOT .../docker/conf-placeholder)
```

**Authenticate the agent (one-time).** Credentials live in the named volume
`agent-claude-config` and are minted inside the container:

```bash
docker exec cht-agent claude -p "say ok" || docker exec -it cht-agent claude   # then /login once
docker exec cht-agent claude -p "say ok"                                       # must print ok
docker exec cht-agent ls /app/tickets | grep -E 'maisha|echis'                 # five tickets baked in
```

The login survives recreates and rebuilds (it is a volume). For unattended
runs set `CLAUDE_CODE_OAUTH_TOKEN` instead (§0.2). Rebuild the image at the
start of a demo day (picks up pipeline changes) and whenever you edit a
ticket file — **tickets are baked into the image at build time**.

Compose already defaults everything else: `LLM_PROVIDER=claude-cli`,
`CHT_URL=https://nginx`, `CHT_CONF_PATH=/workspace/cht-conf-project` (the
container-side path), `CHT_CONF_BIN=<mount>/node_modules/.bin/cht`,
`ANTHROPIC_MODEL=claude-opus-4-8` (override only to change it), and
`NODE_TLS_REJECT_UNAUTHORIZED=0` for the self-signed test cert.

### 1.11 [OPERATOR] Preflight — one screen of assertions

```bash
# instance up + right version
curl -sk https://localhost:10443/api/v2/monitoring | head -c 80
# the five bugs are live on the DEPLOYED config
curl -sk -u medic:password https://localhost:10443/api/v1/settings | grep -c posnatal_care_service_newborn   # M3 typo → 1
curl -sk -u medic:password 'https://localhost:10443/api/v1/forms/contact:e_household:create.xml' \
  | grep -o '<bind nodeset="/data/repeat/child/is_orphan[^>]*>'                                             # M7: age-only gate
curl -sk -u medic:password 'https://localhost:10443/api/v1/forms/contact:f_client:create.xml' \
  | grep -o '<bind[^>]*hh_member_education_lvl"[^>]*>' | grep -c 'calculate='                               # M8 → 1
curl -sk -u medic:password https://localhost:10443/api/v1/forms/postnatal_care_service.xml \
  | grep -o '<bind nodeset="[^"]*next_pnc_visit_date"[^>]*>'
#   M5: TWO lines print. The FIRST (…/group_mother_pnc_danger_signs/…) must
#   have NO relevant=. The second (…/_supporting_info/…) is a calculate
#   mirror and never has one — do not be confused by it.
# config repo prerequisites
cd $CHT_CONF_PATH && git remote -v && git status --short && ls node_modules/.bin/cht
git check-ignore -v .cht-agent/xlsform-fix.json || echo 'descriptor visible to git ✔'
#   If check-ignore MATCHES (a bare `.cht-agent` rule), fix it now: edit the
#   line to `.cht-agent/pr`, commit, and re-run `git tag -f maisha-baseline`.
#   (The pipeline also narrows it automatically and captures the descriptor
#   even when ignored, but a clean baseline avoids per-run gitignore churn.)
# baseline tag really contains what Phase A will restore
git show maisha-baseline:harness.defaults.json | grep no-sandbox
git show maisha-baseline:forms/app/postnatal_care_service.xml \
  | grep -o '<bind nodeset="[^"]*next_pnc_visit_date"[^>]*>' | head -1        # NO relevant=
# agent alive + right mount
docker exec cht-agent claude -p "say ok"
docker inspect cht-agent --format '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}' | grep -c demo-conf-neutralized   # → 1
# no stale artefacts waiting to be mistaken for fresh ones
ls $CHT_CONF_PATH/.cht-agent 2>/dev/null && echo '⚠ stale agent state — rm -rf it' || echo 'no stale agent state ✔'
ls -d $SNAP_DIR 2>/dev/null && echo '⚠ old snapshot exists — retire it before §1.12' || echo 'no old snapshot ✔'
```

### 1.12 [OPERATOR] Freeze the baseline (this is what every reset restores)

Retire any previous snapshot first — restoring a stale one silently undoes
config uploads made since (this bit v1: an old snapshot carried a fixed M5
form).

```bash
[ -d $SNAP_DIR ] && mv $SNAP_DIR $SNAP_DIR.old-$(date +%Y%m%d)

# 1. where does CouchDB actually keep its data? Derive, do not assume:
docker inspect $(docker ps --format '{{.Names}}' | grep couchdb) \
  --format '{{range .Mounts}}{{.Type}} src={{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
#   bind   → a host directory (published-compose stacks: $STACK_DIR/srv)
#   volume → named volumes (local-images stacks)

cd $STACK_DIR
cht-stack stop
mkdir -p $SNAP_DIR
# BIND-MOUNT stack (the published-image route above):
sudo cp -a $STACK_DIR/srv $SNAP_DIR/couch-data
# NAMED-VOLUME stack instead:
#   for v in $(docker volume ls -q | grep "^<project>_"); do
#     docker run --rm -v "$v":/from -v $SNAP_DIR/"$v":/to alpine sh -c 'cd /from && cp -a . /to'; done
cht-stack start
curl -sk https://localhost:10443/api/v2/monitoring | head -c 60
```

Freshness note: `cp -a` preserves source timestamps, so the snapshot's
`mtime` will look old. To confirm a copy is from today, check the change
time: `stat -c '%z' $SNAP_DIR/couch-data`.

A volume loop with the wrong project prefix "succeeds" while copying
nothing — derive the location from `docker inspect`, always.

---

## 2. The per-ticket loop

Run this six-phase loop once per ticket, in the §0 order. Everything is
`[OPERATOR]` except Phase C. Source `~/maisha-demo.env` first.

### Phase A — reset (≈3 min; run it before ticket 1 too)

```bash
TICKET=m3      # m5 | m8 | m7 | m4 | m3 — the one you are ABOUT to run
PREV=m4      # the one you just finished, or none

# A1. capture the finished ticket's work, then re-baseline the repo
cd $CHT_CONF_PATH
[ "$PREV" != none ] && git add -A && git commit -q -m "$PREV: agent-generated fix (demo run)"
git checkout -q -B fix/maisha-$TICKET maisha-baseline
git checkout -- .                  # ⚠ REQUIRED on a rerun: checkout -B onto the same
#   branch/commit re-points the branch but CARRIES dirty tracked files over —
#   this line is what actually restores the baseline file contents.
git clean -qfd                     # drop untracked files (generated specs)
rm -rf .cht-agent                  # ⚠ ALL agent state: the pr/ bundle is gitignored
#   (clean skips it) and a stale xlsform-fix.json from a previous ticket must
#   never be mistaken for this run's descriptor. A run that ends in HC5
#   `abandon` (or dies early) writes NO bundle — without this rm, Phase D
#   would archive the PREVIOUS ticket's PR as this one's.
git status --short                 # MUST be empty
#   If it is NOT empty: something dirtied tracked files outside the loop.
#   Inspect it; if it is all unwanted, `git checkout -- . && git clean -fd`
#   and re-check. Do not proceed on a dirty tree.

# A2. restore the instance to the frozen baseline
cd $STACK_DIR
cht-stack stop
sudo rsync -a --delete $SNAP_DIR/couch-data/ $STACK_DIR/srv/        # bind-mount stack
cht-stack start
# WAIT for the API to be fully up before touching it: monitoring answers
# early in boot while /api/v1/settings still serves DEFAULTS and doc reads
# 404 (the seeder then dies with "CHV person has no parent lineage" and A4
# reads 0 — both are the boot race, not a bad restore).
until curl -sk -u medic:password https://localhost:10443/api/v1/settings \
    | grep -q posnatal_care_service_newborn; do echo 'waiting for API…'; sleep 5; done

# A3. refresh the cohorts (newborn DOBs are relative to now; is_newborn needs <28 days)
cd $WORKBENCH && CHT_URL=https://localhost:10443 COUCHDB_USER=medic COUCHDB_PASSWORD=password \
  node demo/maisha-seed/seed-maisha-cohorts.js

# A4. prove the reset landed
curl -sk -u medic:password https://localhost:10443/api/v1/settings | grep -c posnatal_care_service_newborn   # 1 = buggy baseline live

# A5. fresh browser: close every demo window, open a NEW incognito/guest one,
#     log in as demo_chv, let the initial sync finish.
```

Never reuse a browser profile across a restore — its replication checkpoints
are ahead of the restored server. The `cht-agent` container keeps running
across CHT restarts; rebuild/recreate it (§1.10) at day start, after
switching workbench branches, or after editing a ticket file.

### Phase B — RED (prove the symptom on the deployed config)

Run the per-ticket content check from §3, and where it is part of the story,
the browser reproduction. Do this **before** the agent runs: QA aborts on a
non-reproducing symptom, and you want to have seen it yourself.

If a symptom does NOT reproduce: check, in order — (1) the deployed artifact
(the §3 curl) against the local file: did an upload go missing, or restore a
stale snapshot? (2) the baseline tag (`git show maisha-baseline:<file>`): is
the bug actually in the tag? (3) the cohort DOBs (A3 rerun). Do not start
Phase C until RED is visible.

### Phase C — [AGENT] run the pipeline

```bash
docker exec -it cht-agent npm run full -- tickets/<ticket-file> --qa --qa-tier2
#             ^^ -it is required: without a TTY, HC5 auto-records ACCEPT.
#   The `--` is LOAD-BEARING: npm swallows unknown flags before it, so
#   `npm run full <ticket> --qa` runs WITHOUT QA, silently.
```

**Test-gen verification** (`TEST_GEN_VERIFY=1`, opt-in): proves this run's
generated specs red→green in a sandbox before they ship — they must FAIL on
the pre-fix sources and PASS with the fix — with up to `TEST_GEN_MAX_REPAIRS`
(default 2) fixture-repair passes on the mocha evidence; specs that stay
unproven are DROPPED loudly and PR.md says so. Enable it per demo day with
`export TEST_GEN_VERIFY=1` before the agent `up` (compose passes it through;
changing it requires an `up -d --force-recreate`). Expect a few extra minutes
per settings ticket (two harness boots + two offline compiles per attempt).
Independent of the flag, tier-2 now always UNIONS the generated specs into a
pinned `qaSpecs` selection, so they can no longer ship unexecuted.

**Prompts you will meet, in order.** The first is easy to miss in v1 terms —
it is not one of the numbered checkpoints:

| Prompt | What it is | Your answer |
|---|---|---|
| "👁️ preview changes before writing?" | arms HC2 — answering **no** writes generated files with NO approval gate | **yes**, always |
| **HC1** research | frontmatter-routed findings (no LLM routing call), code context | approve / feed back |
| **HC2** development | XLSForm tickets: a **bind-level per-attribute diff** verified against a real offline convert; JS tickets: a plain git diff | approve / reject (reject loops with your feedback, max 3 iterations) |
| **HC3** QA destructive gate | reached only after RED reproduced on the deployed config | approve the seed+apply |
| **HC4** QA failure | QA evidence when it did not pass; not offered when the evidence rules a retry out (non-reproduction, failed apply, environmental tier-2) | spend another dev pass, or stop |
| **HC5** scope of the fix | deferred recommendations, scope-limited items, tier-2 attribution. **This build offers `accept` / `abandon` only** — the widen/widen-relax paths exist in code but are deliberately cut (scope-gate.ts "DEMO SAFETY CUT"); restoring them is a one-line change post-demo | `accept` ships with the gaps recorded in PR.md; `abandon` writes **no** bundle, names the files to revert, exits non-zero |

`--qa-auto` auto-approves HC3 for unattended runs, suppresses HC4's prompt,
**and records ACCEPT at HC5 without asking**. HC5 also only opens when there
is something to decide (deferred blocking recommendations or new tier-2
failures) — a clean run writes the bundle with no fifth prompt.

QA order is fixed: provision → discover(pre) → **reproduce RED** (abort if
the symptom is absent) → whole-document drift check (XLSForm tickets; abort
on drift beyond the target bind — `QA_ALLOW_DRIFT=1` downgrades to a
warning) → HC3 → seed → apply → discover(post, rev change) → **verify
GREEN** → tier-2.

**When a phase fails:** FIRST, before any rerun of the same ticket, re-run
Phase A's A1 (repo reset) — HC2 already wrote the failed attempt's fix into
the mount, and a rerun on that tree applies a no-op (`(absent) → (absent)`
in the HC2 bind diff is the tell) and then aborts on drift the leftovers
cause. The instance usually needs no restore when QA aborted before the
apply. Then: a QA abort for non-reproduction means the deployed config does
not carry the bug — fix the environment (Phase B checklist), never the code. A failed apply means the fix was never deployed — read the
cht-conf output; green repeating red is arithmetic, not evidence. A tier-2
"browser failed to launch" is the missing `--no-sandbox` (§1.5) — an
environment problem the pipeline names as such. Dev-loop exhaustion
(`NO FIX PRODUCED`, exit 1) writes nothing — re-run after improving the
ticket, or hand-fix.

### Phase D — collect the PR output

The config repo is bind-mounted, so the bundle is already on the host:

```bash
BUNDLE=$CHT_CONF_PATH/.cht-agent/pr
# freshness first — a missing/stale bundle means the run did NOT produce one
# (HC5 abandon, or an abort). Never archive a bundle you cannot date to this run.
ls -l --time-style=+%H:%M $BUNDLE/PR.md $BUNDLE/changes.patch
head -5 $BUNDLE/PR.md                      # must name THIS ticket's problem
mkdir -p $PR_ARCHIVE/$TICKET && cp $BUNDLE/PR.md $BUNDLE/changes.patch $PR_ARCHIVE/$TICKET/
# does it apply to the PRISTINE partner clone? (the real acceptance test)
git -C $SITE_CONFIG apply --check --binary $PR_ARCHIVE/$TICKET/changes.patch \
  && echo "✔ $TICKET patch applies clean"
```

`--binary` matters: XLSForm fixes carry binary `.xlsx` hunks. Copy the bundle
out **before** Phase A's `rm -rf .cht-agent`. (PR.md's own "Applying this
change" section still says `docker cp` — ignore it; the bind mount already
did that.) If `apply --check` fails: diff the patch's context against
`$SITE_CONFIG` — the usual cause is a baseline file that differed from
pristine (e.g. a tracked agent spec that should not have been in the
baseline, §1.5).

### Phase E — GREEN + archive the evidence

Run the per-ticket GREEN check from §3 (content, browser, tier-2). Then
append the run to your log: ticket, HC5 choice, QA verdict (reproduced /
verified / rev change / tier-2), patch size + file count, anything you had to
work around.

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
follow-up visit demands scheduling the next postnatal appointment — including
when the visit's reason is that the pregnancy ended.

**RED (content)**
```bash
curl -sk -u medic:password https://localhost:10443/api/v1/forms/postnatal_care_service.xml \
  | grep -o '<bind nodeset="[^"]*next_pnc_visit_date"[^>]*>' | head -1
# buggy: type="date" … required="true()" with NO relevant=
# (a second _supporting_info bind also prints without | head -1 — it is a
#  calculate mirror and never has a relevant; ignore it)
```

**RED (browser)** — needs **two visits**, because the "Mother PNC Danger
Signs" page only renders for a woman with a recorded delivery. Visit 1: on an
`f_client` woman → "Mother and Newborn PNC Home Visit Service" → "Has she
delivered?" **Yes** → mother Alive, delivery a couple of days ago → outcome 1
delivered / 1 alive → newborn details → danger signs No → submit → **Sync
now**. Visit 2: tap the PNC follow-up task on her profile → "Is she
available?" **Yes** → the form lands on Mother PNC Danger Signs and **"Enter
next PNC visit date" is required unconditionally** — try to advance with it
empty and the form refuses.

**Expected HC2** — bind-level diff on `next_pnc_visit_date`:
`relevant: (absent) → " /postnatal_care_service/group_pregnancy_status/has_delivered ='yes'"`,
N sibling binds unchanged. The corrected **`.xlsx` and regenerated `.xml`**
both land in the mount.

**GREEN** — the curl shows the gate; in the browser (Sync now first) Visit 2
no longer asks for the date, while the genuine delivery path (Visit 1 on a
different woman) still does. Tier-2 runs the generated
`test/forms/postnatal_care_service.agent.spec.js`.

**Note for the handback:** post-fix, follow-up visits can no longer record
the MCH booklet's next appointment even optionally. Nothing in-config
consumes those fields, but partner analytics might — surface it in the PR.

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
  | grep -o '<bind[^>]*hh_member_education_lvl"[^>]*>'
# buggy: carries calculate="member_filter = … or over_5= … or member_filter = 2"
# (attribute order varies by converter vintage — calculate may print BEFORE
#  nodeset; the pattern above matches either order)
```

**RED (browser)** — in `maisha-seed-hh-m8`, register a new household member;
set education status to "at school"; the required **Level of Education**
select will not hold the selection.

**Expected HC2** — an **absence** assertion: `calculate: <expr> → (absent)`
with `relevant` and `required` unchanged. The descriptor uses
`set: {column: 'calculation', clear: true}`.

⚠️ **Scope trap (observed live):** the agent may try to fix
`hh_member_occupation` too — the ticket names it as the same defect. The QA
verify contract is **single-bind**: the whole-document RED oracle exempts
only the declared target, so a second fixed bind reads as
`ENVIRONMENT DRIFT — 2 line(s)` and aborts QA. This is the one drift abort a
dev retry DOES fix: answer **yes** at HC4 (the feedback names the occupation
bind), and at the retry's HC2 confirm the diff touches ONLY
`hh_member_education_lvl` — reject with "leave hh_member_occupation
untouched; record it as a sibling defect for follow-up" if not. Occupation
then rides PR.md as a recorded gap, exactly like M7's sibling forms.

⚠️ Guardrail worth knowing: clearing the `calculation` column on a row whose
*type* is `calculate` makes pyxform hard-fail the whole convert
(`Missing calculation`) — the editor refuses that case up front with a
descriptive error. M8's rows are `select_one`, so they are the legal case.

**GREEN** — the curl shows no `calculate` on the **education** bind
(`hh_member_occupation` keeps its buggy calculate — deliberately out of this
change's scope, recorded in PR.md); in the browser (Sync now) the education
selection sticks for every choice, still required, still gated on
`at_school`/`left_school` — while occupation still misbehaves, which itself
demos the surgical scope. Tier-2 runs the generated
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

**Scope call, decide before you run:** the ticket names three affected forms
(`e_household-create`, `f_client-create`, and the reminder app form). The
descriptor is single-form by design. Demo the reported surface
(`e_household-create`) and treat the siblings as two further runs or a
follow-up. The narrowing is surfaced as the **REPRESENTATIVE scope** caveat
in the QA transition and in PR.md; HC5 opens only if validation also
deferred blocking items — if it does, `accept` is the right answer. Do not
iterate live.

**GREEN** — curl shows the widened gate; both-parents-alive child skips the
question; a child with a parent deceased or unknown still gets it
(no-regression half).

### 3.4 M4 — fully-immunized child flagged as defaulter (`contact-summary`)

`tickets/maisha-m4-immunization-defaulter-false-positive.md` · artifacts
`contact-summary.templated.js` + `tasks.js` · apply bucket `app-settings`.

The defaulter flag compares a **count** of distinct recorded vaccine tokens
against an age-banded expected integer (`!==`), so any divergence — an extra
optional dose, a dose ahead of schedule — reads as "defaulter", including for
fully-immunized children. The correct coverage predicate already exists in
the same file.

**RED (browser, primary)** — open the seeded 14-day-old newborn in
`maisha-seed-hh-m4`: the defaulter flag/branch shows despite the child being
complete-for-age (BCG + OPV0) plus one early extra dose (OPV1). There is no
crisp settings-grep here — the bundle is minified and this predicate has no
unique string literal, which is exactly why P4's oracle compares the compiled
settings byte-for-byte instead.

**RED (partner suite)** — the ticket pins its regression surface in
frontmatter (`qaSpecs`: `test/contact-summary.spec.js`,
`test/tasks/defaulter_follow_up.spec.js`,
`test/tasks/immunization_service.spec.js`). All three pass on the buggy
baseline, so tier-2 gates regressions without false-blocking. The
fix-*proving* case (the over-immunized child) comes from the agent's
generated spec — check at HC2 that one exists, and if not, add it before you
rely on tier-2 as proof.

**Expected HC2** — a plain git diff replacing the length-inequality at
`contact-summary.templated.js:175` and its mirror at `tasks.js:1329` with the
coverage predicate; optionally retiring the dead `imm_schedule_upto_date`
predicate at `tasks.js:1007`. The dev phase's compile gate has already proven
`compile-app-settings` passes.

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
emitted per qualifying report — and its `resolvedIf` is broken twice over: it
resolves against a **misspelled form id** (`posnatal_…`, which can never
match a real submission) and it omits the `sourceID` argument, so there is no
per-source dedup.

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
"PNC newborn immunization referral" cards** for one baby. The live mechanism,
if you want to show it: run the click-path below once more and a fourth task
is emitted (`Draft`, due in 3 days — see §1.9).

| Page | Question | Answer |
|---|---|---|
| Newborn PNC Home Visit | Who is the caregiver today? | **Mother** |
| | Place of delivery | **Home** (pre-filled) |
| | Have you referred … to the health facility? | **No** |
| PNC Danger Signs (Child) | Ask for the following danger signs | **None** ← only this |
| | Is …'s immunization upto date? | **No** ← calculates the follow-up |
| Summary | — | **Submit** |

Check **None**, not a real danger sign: any danger sign also emits a
danger-signs referral task and opens a red "refer immediately" branch — noise
in a demo about immunization duplicates. (The immunization question appears
because `is_immunization_defaulter='yes'`; the seeded newborn has no
immunization reports, so she reads as a defaulter under both the buggy and
the corrected predicate — the path is safe regardless of M4's state.)

**The strongest visible RED** — open ONE of the three cards, complete its
immunization referral: **all three cards disappear.** One referral silently
closed three separate visits' follow-ups. Then reset (§2 Phase A) so the pile
is back before the fix.

**Expected HC2** — `posnatal_` → `postnatal_` at `tasks.js:1368` plus
`report._id` passed as the `sourceID` argument, mirroring the mother-side
template at `tasks.js:207-215`.

**GREEN** — the settings-grep returns nothing, and QA's compiled-settings
oracle flips RED→GREEN. In the browser, ⚠️ **the three cards do NOT vanish** —
that is correct, each visit still needs its own referral. The change is the
resolution behaviour: **complete one card's referral and only that card
clears; the other two remain.** (Verified in the partner rules engine:
pre-fix 3→0, post-fix 3→2.)

**Ordering note:** the harness reads the **compiled** `app_settings.json`,
not `tasks.js` — and QA's `app-settings` apply runs `compile-app-settings`
with the mount as its working directory, so the mount's compiled settings are
regenerated before tier-2 reads them. That is why the apply must precede
tier-2, and it does.

---

## 4. After the run — analysing the five PR bundles

Each `$PR_ARCHIVE/<ticket>/` holds:

- **`PR.md`** — the description to paste: what changed and why, the QA
  evidence (reproduced / applied / verified, rev change, tier-2 verdict with
  baseline attribution), the files the patch contains, any **dirty files it
  deliberately excluded** with reasons, and a checklist of **deferred
  recommendations** — things validation flagged that the pipeline chose not
  to fix. Read that checklist first; it is the honest edge of the change.
- **`changes.patch`** — scoped to the files *this ticket's* development phase
  wrote. Binary hunks are included, so `.xlsx` fixes apply.

**Because §1.7 canonicalized the baseline XML, the patches' `.xml` hunks
target converter-canonical serialization — they will NOT apply to the
partner's original tree as-is.** (The `.xlsx` binary hunks and new spec files
apply cleanly; only regenerated `.xml` context differs.) Prepare the pristine
clone once with the same mechanical step, and apply-check against that:

```bash
cd $SITE_CONFIG && git checkout -b chore/canonicalize-form-xml
# same converter the pipeline used (host pyxform, or run it in the container
# against a temporary mount) — regenerate, commit as a no-logic-change commit:
#   cht --source=. --skip-... convert-app-forms convert-contact-forms
git add -A && git commit -m "chore: regenerate form XML with pinned cht-conf (no logic change)"
```

Each fix PR then goes up as: that canonicalization commit (reviewable as
mechanical) + the ticket's patch applied on top. Alternatively, hand the
partner only the `.xlsx` + spec changes and let their own convert regenerate
the XML — their normal authoring workflow does this anyway.

**Full-suite regression check (once, end of sweep — ~1–2 h per run,
unattended).** Tier-2 is deliberately per-artifact; nothing in the loop runs
the partner's whole harness suite. Close that once, with attribution (the
suite has pre-existing failures — a raw failure count proves nothing):

```bash
cd $CHT_CONF_PATH
# 1. the pre-fix failure set (detached, tree = the tag)
git checkout -q --detach maisha-baseline
docker exec cht-agent bash -c 'cd /workspace/cht-conf-project && npm test' 2>&1 | tee /tmp/suite-baseline.log
# 2. all five fixes together (m4 and m3 both touch tasks.js — if the octopus
#    merge conflicts, apply the archived patches onto the branch instead)
git checkout -q -B regression-all maisha-baseline
git merge --no-edit fix/maisha-m5 fix/maisha-m8 fix/maisha-m7 fix/maisha-m4 fix/maisha-m3
docker exec cht-agent bash -c 'cd /workspace/cht-conf-project && npm test' 2>&1 | tee /tmp/suite-all.log
# 3. compare FAILING TEST TITLES, not counts:
grep -E '^\s+[0-9]+\) ' /tmp/suite-baseline.log | sort > /tmp/fail-base.txt
grep -E '^\s+[0-9]+\) ' /tmp/suite-all.log      | sort > /tmp/fail-all.txt
diff /tmp/fail-base.txt /tmp/fail-all.txt   # lines only in fail-all = regressions
```

A clean diff is the suite-wide no-regression proof for the whole PR train;
paste it into each PR.md. Then reset the repo (Phase A A1) before anything
else touches it.

Review pass per bundle:

1. `git -C $SITE_CONFIG apply --check --binary changes.patch` — clean against
   the canonicalized branch above (the `.xml` hunks are expected to fail
   against the partner's original serialization; that is not a bad patch).
2. Does the patch touch **only** what the ticket declared? For M5/M8/M7 that
   is one `.xlsx` + its regenerated `.xml` (+ possibly a generated spec); for
   M4/M3 the named JS files.
3. Does the diff match the HC2 bind diff / git diff you approved?
4. Is `app_settings.json` absent from the patch? It is generated and
   gitignored in the config repo — it should never be in a PR.
5. Does the QA section show a real transition (RED evidence, apply, rev
   change, GREEN evidence) rather than a skip? Read the **headline** — it is
   derived from the worst fact in the section and can be stricter than the
   console's aggregate; trust the document.
6. For M5/M8/M7: is the generated harness spec included and does it assert
   the fix (including *absence* for M8)?
7. Anything in the deferred-recommendations checklist you want fixed before
   the PR goes up?

Then, per ticket, open the PR against the partner repo yourself: apply the
patch on a branch off the pristine clone, paste `PR.md` (minus its
"Applying this change" docker-cp block), add the partner decisions the
ticket raised (M5's optional next-appointment capture; M7's two sibling
forms).

---

## 5. Traps that actually bit us

| Trap | Symptom | Guard |
|---|---|---|
| Host `cht` verbs pointed at `localhost` | every upload verb: `Unable to fetch xml attachment … status code = undefined` (tough-cookie rejects the `localhost` AuthSession cookie) | `$URL` uses `127.0.0.1` (§0.1) |
| `up` without `$CHT_CONF_PATH` exported | agent mounts the **placeholder** config; cht-conf tickets fail or edit the wrong tree | source `~/maisha-demo.env` first; the §1.10 mount-inspect |
| Tag created before the last baseline commit | resets strand the harness fix (tier-2 "No usable sandbox!") or restore a fixed bug | §1.5 tags ONCE, last, behind the five-bug assertion; re-tag with `git tag -f` after ANY later baseline commit |
| Stale CouchDB snapshot restored | uploads made since silently vanish (a fixed M5 came back once); newborn cohorts age past 28 days | retire old snapshots (§1.12); check `stat -c '%z'` not `mtime`; re-seed after every restore (A3) |
| `npm run full <ticket> --qa` without `--` | runs with **no QA**, silently | always `npm run full -- <ticket> --qa` |
| Answering **no** to the preview prompt | files written with NO HC2 gate | always yes (§2 Phase C) |
| Running Phase C without `-it` | HC5 records ACCEPT without asking | keep `docker exec -it` |
| Host `compile-app-settings` on Node ≥17 | `ERR_OSSL_EVP_UNSUPPORTED` (webpack-4 MD4) | `NODE_OPTIONS=--openssl-legacy-provider` (§0.1) |
| Host convert verbs without pyxform | `There was a problem executing xls2xform` | install medic's pyxform fork, or convert in-container (§1.7) |
| Partner-original XML deployed verbatim | every XLSForm ticket aborts `ENVIRONMENT DRIFT — N line(s) BEYOND the target bind` (serialization skew, not a real edit) | §1.7's mandatory canonicalize-commit-retag before uploading; HC4 may still offer a retry here — decline it, a dev pass cannot fix drift |
| Fix edits a SECOND bind (M8's occupation sibling) | drift abort whose sample lines are a bind the fix also changed — scope, not environment | this drift a retry DOES fix: yes at HC4, then at HC2 confirm the diff touches only the target bind (§3.2) |
| Bare `.cht-agent` in the config `.gitignore` | XLSForm descriptor hidden from git; `git clean` skips stale agent state | §1.5 commits `.cht-agent/pr`; §1.11 check-ignore; Phase A `rm -rf .cht-agent` |
| Agent container not rebuilt | old guards abort `--qa` for non-`form` artifacts; edited tickets not picked up (baked at build) | §1.10 build per demo day / after ticket edits |
| `docker compose start` on the CHT stack | `cht-agent` still not running | it is a separate compose project |
| Unauthenticated container | `claude -p` fails; host login does not propagate | one-time in-container `/login` (volume-persisted) or `CLAUDE_CODE_OAUTH_TOKEN` |
| Reused browser profile after a restore | client checkpoints ahead of the server; nothing looks right | fresh incognito window per ticket |
| Config repo missing `npm ci` | dev convert / QA apply / P4 compile / tier-2 all fail differently | §1.4 |
| Partner git hooks (installed by `npm ci` postinstall) | first commit prints a harmless `fatal: … 'HEAD'`; later commits on `master`/`main` are **refused** | §1.5: verify the first commit landed, then `git branch -m demo-baseline` |
| Stale PR bundle survives the reset | you archive the previous ticket's PR as this ticket's | `rm -rf .cht-agent` in Phase A + the freshness check in Phase D |
| Expecting M3's cards to vanish post-fix | looks like the fix did nothing | the change is *which* card clears (§3.5) |
| Expecting M4's flag on an older child | flag never renders | it is newborn-only (§1.9) |
| Expecting four choices at HC5 | only `accept`/`abandon` are offered | the widen paths are cut in this build (§2 Phase C) |

---

## 6. Reference

| Thing | Path / command |
|---|---|
| Environment block | `source ~/maisha-demo.env` (§0.1) — in EVERY terminal |
| Neutralize a fresh config clone | `node $WORKBENCH/demo/setup/neutralize-config.js --config <repo> [--check] [--strict]` |
| Seed / refresh cohorts | `node $WORKBENCH/demo/maisha-seed/seed-maisha-cohorts.js` (`M3_DUPLICATES=N`, `DEMO_CHV_USER=<name>`) |
| Seeded user password | `ChangeMe_123` (build-seed default) |
| Run a ticket | `docker exec -it cht-agent npm run full -- tickets/<f> --qa --qa-tier2` |
| PR bundle (host side) | `$CHT_CONF_PATH/.cht-agent/pr/{PR.md,changes.patch}` |
| PR archive | `$PR_ARCHIVE/<ticket>/` |
| Agent compose | `$WORKBENCH/docker/docker-compose.cht-agent.yml` (separate project from the CHT stack) |
| CHT-net override | `$WORKBENCH/docker/cht-agent-net.override.yml` |
| Drift escape hatch | `QA_ALLOW_DRIFT=1` (whole-document RED oracle → warning) |
| Deep dives | `maisha-demo-runbook.md` (reset model, browser detail), `demo-runbook.md` §1 (local-build stack), `all-config-artifacts-pipeline-plan.md`, `cht-conf-extension-pr-ledger.md` |

Teardown when the engagement closes: `docker compose down -v` on both
projects, and delete `$SNAP_DIR*` and `$PR_ARCHIVE` once the PRs are up.

---

## 7. One-run-through verification (2026-09-01, automated end-to-end)

This procedure was executed front-to-back by an agent operator against a raw
partner copy (`demo-conf-neutral2`), unattended: neutralize → baseline →
fresh stack → uploads → synthetic hierarchy → cohorts → freeze → five
tickets → full-suite regression → all-fixes deployment. **All five tickets
passed** (m5 PASSED · m8/m7 PASSED WITH the expected representative-scope
caveats · m4 PASSED with specs proven red→green after 1 automatic fixture
repair · m3 PASSED). Bundles: `pr/automated-full-run/<ticket>/`.

Corrections the run produced are already folded in above (§1.7 upload
verification + tty-only overwrite prompt; §1.6 scripted-compose quoting
trap; §1.5's contamination assertions held). Two variants it validated:

**Named-volume stack (no sudo anywhere).** The published couchdb compose
parameterizes the data mount (`${COUCHDB_DATA:-./srv}`), so a two-line
override puts data in a named volume and every freeze/restore runs through
docker instead of sudo:

```yaml
# <stack>/couch-volume.override.yml   (docker volume create <name> first)
services:
  couchdb:
    volumes: [ "maisha-auto-couchdata:/opt/couchdb/data" ]
volumes:
  maisha-auto-couchdata: { external: true }
```

```bash
# freeze (stack STOPPED):
docker run --rm -v maisha-auto-couchdata:/from -v $SNAP_DIR:/to alpine \
  sh -c 'mkdir -p /to/couch-data && cp -a /from/. /to/couch-data/'
# restore (stack STOPPED):
docker run --rm -v maisha-auto-couchdata:/to -v $SNAP_DIR:/from alpine \
  sh -c 'rm -rf /to/* /to/.[!.]* 2>/dev/null; cp -a /from/couch-data/. /to/'
```

**Unattended Phase C.** `yes | docker exec -i cht-agent npm run full -- \
tickets/<t> --qa --qa-tier2` (note: `-i`, no `-t`): the pipe answers the
preview prompt, HC1, HC2 and HC3; HC4 self-heals a drift abort with an
auto-yes retry; HC5 auto-records ACCEPT on a non-TTY. Launch under `nohup`
with a log file and watch the log for `Closed loop succeeded` /
`ENVIRONMENT DRIFT` / `PIPELINE-EXIT=`. Trade-off, stated plainly: nobody
reviews the HC2 diff — Phase D's check of PR.md's `**Result:**` headline is
the backstop, and a bundle that says DID NOT PASS must be re-run, never
shipped. Steps that stay human: the §1.9 browser login (the frozen
`demo_chv` keeps `ChangeMe_123` + a forced-change prompt) and the per-ticket
browser RED/GREEN story beats.

---

## 8. Second automated run — updated partner config on CHT 5.3.0 (2026-09-03)

Re-run of §7's unattended procedure against the partner's next config release
(`demo-conf-updated`), on a fresh stack pinned to the partner's new core
version. Bundles: `pr/automated-full-run-updated-conf-090327/`. New lessons:

- **Match the partner's core version.** `harness.defaults.json` still said
  `coreVersion: "4.0"` and the cht-conf pin barely moved
  (`^3.21.4` → `medic/cht-conf#v3-21-4-with-830`), so the TOOLCHAIN was
  unchanged — only the deployed core (5.3.0) differed. The published 5.3.0
  composes add a `nouveau` search service with its own data mount: the
  named-volume override must cover BOTH `couchdb` and `nouveau` (two
  external volumes), and freeze/restore copies both.
- **ECR public rate limits bite multi-image pulls.** A first `compose up`
  died on `toomanyrequests` for `nouveau` and silently left the stack
  incomplete. Pre-pull with a retry/backoff loop until every image is local,
  THEN `up`.
- **cht-conf's tty-only overwrite prompt also fires on `upload-resources`**
  on a fresh 5.x instance (it ships a default `resources` doc). Same pty
  remedy as §1.7.
- **Validate the TICKETS against the new config before running them.** A
  read-only research pass (Explore agent, ~10 min) over the updated tree
  found: M8 fixed upstream via the ticket's ALTERNATIVE route
  (`choice_filter`/`<itemset>`), M7's prescription a structural NO-OP
  (head-scoped `father_alive`/`mother_alive` are empty for adult-headed
  households — the per-child signal is `hh_member_caregiver`), and M4's
  "retire vs re-key" item flipped to re-key (upstream registered the task).
  Site-greps alone would have missed all three. Also caught: an earlier
  workbook check of mine was a sloppy substring match — dump the actual
  survey cell, never grep sharedStrings for a field name.
- **Pipeline certifies upstream fixes honestly**: running the now-fixed M8
  ended in `symptom did not reproduce` before any apply — the abort IS the
  artifact (`m8-certification/`).
- **Run both prescriptions when a ticket is wrong**: `m7-as-written/`
  (structurally green, clinically inert) next to `m7-corrected-caregiver/`
  (the shippable fix) demonstrates that oracles prove what the ticket
  ASKED, not what the CHP NEEDED — ticket prescriptions need domain review.
- Tickets are baked into the agent image; for a mid-campaign ticket edit,
  `docker cp` the file into `cht-agent:/app/tickets/` instead of rebuilding
  and recreating (which would kill an in-flight run).

**§8 outcome.** Baseline (updated config, CHT 5.3.0 stack) **1453 passing /
0 failing**; merge of the four shippable fixes (m5, m7-corrected, m4, m3)
**1467 passing / 0 failing**; +14 = the generated specs, verified in
isolation. Zero regressions across a config release AND a core-version
jump. m5/m4/m3 fix hunks byte-identical to both earlier campaigns.

**What changed since v1** (every item was hit live during the 2026-08-25
verification run; each is now folded into the sections above):

- **§0.1 environment block**: every path is a variable, exported once and used
  verbatim in every command. The working copy is now `demo-conf-neutralized`.
- **Auth**: the agent authenticates via a one-time in-container `/login`
  persisted in a named volume (or `CLAUDE_CODE_OAUTH_TOKEN`). The v1 story
  (host credential mount, `--force-recreate` for a rotated file) is obsolete.
- **`127.0.0.1`, never `localhost`**, for every host-side `cht` command: the
  API's `AuthSession` cookie is set for domain `localhost`, and the
  tough-cookie version `npm ci` installs rejects `localhost` as a special-use
  domain — every upload verb then dies with
  `Unable to fetch xml attachment … status code = undefined`.
- **The baseline tag moves LAST.** v1 tagged in §1.4 and kept committing into
  the baseline afterwards; the reset then restored a tag missing the harness
  fix (and once, missing the M5 bug). v2 tags once, after every baseline
  commit, behind an explicit five-bug assertion.
- **pyxform is optional on the host.** The standard route keeps the
  `convert-*` verbs (install medic's pyxform fork if missing), but the
  partner repo commits the generated `.xml` next to each `.xlsx`, so §1.7 now
  documents an upload-only variant and the in-container convert (the agent
  image bakes pyxform).
- **`NODE_OPTIONS=--openssl-legacy-provider`** for host `compile-app-settings`
  (webpack-4 MD4 vs OpenSSL 3 on Node ≥17).
- **Workbench `npm ci`** is now an explicit step (v1 never installed the
  workbench deps; `demo:build-seed` needs ts-node).
- **Phase A removes all of `.cht-agent/`** (not just `pr/`) and has a
  remediation line for a non-empty `git status`.
- **Phase C documents the preview prompt** (answer **yes** — it is what arms
  HC2) and corrects HC5: this build offers **accept / abandon** only (the
  widen paths are implemented but deliberately cut — `scope-gate.ts`,
  "DEMO SAFETY CUT").
- **Verify the container mounts after `up`** — bringing the agent up in a
  shell without `$CHT_CONF_PATH` silently mounts the placeholder config.
