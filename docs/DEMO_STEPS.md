# Driving the closed-loop demo on config-echis (fresh setting)

Exact steps to reproduce → fix → verify the PNC skip-logic bug through the
cht-agent, on a throwaway test env, using dummy data. **Never run git in
`/workspace/site-config`** (the pristine partner download stays git-free).
Since **Mission 05** the TEST working copy is the one exception: it **must**
be a local, remote-less git repo (step 0.5) — the agent's code-gen
snapshots/rolls back via git and its fix descriptor rides git-diff capture.
Remote-less = nothing can ever be pushed; the container's git additionally has
a dummy identity + a system-level push block.

## State going in (already done)
- `/workspace/site-config` — pristine partner download (the fix baseline).
- `/workspace/site-config-test` — working copy: 653 `:Zone.Identifier` removed;
  `branding.json` title → `CHT Demo`; `base_settings.json` neutralized
  (`oidc_provider` removed → password login; `outbound` `{}`; `app_url`
  `https://nginx`) → **no `env.*` placeholders remain**, so compile needs no env;
  README brand/org identity scrubbed.
- Ticket ready: `/workspace/site-config-test/demo-echis-pnc-ticket.md`.

## 0. Sanity (in the fresh setting)
```bash
node -e 's=require("/workspace/site-config-test/app_settings/base_settings.json");console.log("oidc?",("oidc_provider" in s),"outbound",JSON.stringify(s.outbound),"app_url",s.app_url)'
# expect: oidc? false outbound {} app_url https://nginx
```

## 0.5 Mission-05 prerequisites (blocking — the dev phase dies without them)

```bash
# The working copy must be a LOCAL, REMOTE-LESS git repo with ≥1 commit
# (agent snapshot/rollback + descriptor capture):
cd /workspace/site-config-test
git rev-parse HEAD 2>/dev/null || { git init && git add -A && git commit -m "demo baseline: neutralized live config (buggy PNC form)"; }
git remote -v        # MUST print nothing
```

- **Workbench branch + image**: the cht-agent image (step 4) must be built
  from a branch carrying **Mission 05** (`feat/mission-05-xlsform-orchestrator`
  or a branch it's merged into). Mission 05 adds **exceljs** (production
  dep) — a stale image crashes at `require('exceljs')`. `npm ci` + image
  rebuild after switching branches.
- **`.cht-agent/` must not be gitignored** in this repo (it isn't — no
  `.gitignore` here): the fix descriptor `.cht-agent/xlsform-fix.json` is the
  code-gen CLI's only output; if git can't see it the run aborts as
  `execute-no-op`.
- **Converter pin**: compose now defaults `CHT_CONF_BIN` to this repo's
  pinned cht-conf 3.21.4 (`node_modules/.bin/cht`, installed by step 2's
  `npm ci`) — both the dev phase's offline `convert-app-forms` and QA's
  apply run it. Matches the ticket's `chtConfVersion: "3.21.4"`.

## 1. [OPERATOR] Provision the test instance (their custom cht-core 4.21.1 build)
The deployed version is a **custom fork** (`4.21.1-…-sync-interval-30…`), so build
the test images locally from that cht-core checkout, then compose up on
`cht-agent-net` (full detail incl. `.env` requirements: cht-agent runbook
`docs/handoffs/demo-runbook.md` step 1):
```bash
# in the cht-core (4.21.x fork) checkout — Node ≥22.15, docker compose v2:
npm ci && npm run build          # webapp/admin/ddocs first; local-images only copies them
export VERSION=4.21.1            # ⚠️ NOT `TAG=` (yields 4.21.1.undefined image tags),
                                 #    and a detached-HEAD tag checkout alone yields EMPTY tags
npm run local-images             # 6 images medicmobile/cht-*:4.21.1 + local-build/*.yml
cd local-build                   # .env: COUCHDB_PASSWORD is mandatory (see runbook)
docker compose --env-file ./.env -f cht-core.yml -f cht-couchdb.yml \
  -f <cht-agent>/docker/cht-agent-net.override.yml up -d
curl -k https://localhost:10443/api/v2/monitoring   # expect version.app ~ 4.21.1
```
TLS: nginx uses a self-signed OR local-IP service-signed cert — for the agent
process set `NODE_EXTRA_CA_CERTS=/path/to/local-ca.crt` (service-signed, preferred)
or `NODE_TLS_REJECT_UNAUTHORIZED=0` (self-signed).

## 2. [OPERATOR] Reconstruct the neutralized config on the test env
Use the **repo-pinned cht-conf 3.21.4** (NOT the workbench 6.5.0), and **skip
`upload-branding`** (keeps CHT's default logo — no Kenya coat of arms):
```bash
cd /workspace/site-config-test
npm ci                                # installs cht-conf 3.21.4 + harness 3.0.15 locally
URL='https://medic:password@nginx'
FLAGS='--force --skip-git-check --skip-version-check --skip-dependency-check --skip-translation-check --accept-self-signed-certs'
CHT=./node_modules/.bin/cht
$CHT --url=$URL --source=. $FLAGS compile-app-settings upload-app-settings
$CHT --url=$URL --source=. $FLAGS convert-app-forms upload-app-forms
$CHT --url=$URL --source=. $FLAGS convert-contact-forms upload-contact-forms
$CHT --url=$URL --source=. $FLAGS upload-resources upload-custom-translations
#   NOTE: deliberately NOT running upload-branding.
```
This puts the LIVE (buggy) config on the test env → the PNC bug is now live and
reproducible, but with CHT-default branding and no external integrations.

## 3. [OPERATOR] Seed dummy data + a local login user
Hierarchy is `county → sub_county → CHU → CHV_area → household → person`. Build
dummy CSVs (from a scrubbed export, or `medic/test-data-generator` for volume),
then load, and create a **password** user (OIDC is neutralized) with a role that
can do PNC and has `can_create_records`:
```bash
$CHT --url=$URL --source=<seed-project> $FLAGS csv-to-docs upload-docs create-users
```

## 3b. [OPERATOR] Manually prove the bug (browser + curl) — BEFORE the loop

Content-level proof from the host (no UI):

```bash
curl -sk -u medic:password "https://localhost:10443/api/v1/forms/postnatal_care_service.xml" \
  | grep -o '<bind nodeset="[^"]*next_pnc_visit_date"[^>]*>'
# BUGGY: the bind has NO relevant attribute at all — the question is
# unconditionally shown whenever its parent group renders:
#   <bind nodeset="/postnatal_care_service/group_mother_pnc_danger_signs/next_pnc_visit_date"
#         type="date" ... required="true()"/>    ← no relevant=
```

Browser walkthrough — log in at `https://localhost:10443` as the **password
CHV user from step 3** (e.g. `demo_chv` — an offline user under a
`d_community_health_volunteer_area`; NOT `medic`, which is an online admin
with no offline app). Let the initial sync finish.

**The bug needs TWO visits** — the "Mother PNC Danger Signs" page (where the
ungated question lives) only renders for a woman with a **recorded delivery**
(`days_since_delivery >= 0`, derived by contact-summary from a prior PNC
report's `group_pnc_visit.date_of_delivery`) when the form is launched from
her contact page. On a fresh not-delivered woman, answering "Has she
delivered ?" → No skips that page entirely — you will NOT see the bug there.

Visit 1 — record a delivery (setup):
1. **People** → drill `county → sub_county → CHU → CHV area → household` →
   open an **`f_client`** patient → **"Mother and Newborn PNC Home Visit
   Service"**.
2. "Has <name> delivered ?" → **Yes** → Home Visit page: mother **Alive**,
   date of delivery = a couple of days ago, any place → Delivery outcome:
   1 delivered / 1 alive → fill newborn details → danger signs "No",
   visit-date questions as prompted (legitimate on this path) → submit.
3. **Sync now** (hamburger menu) — her profile now shows the PNC card and
   contact-summary carries `days_since_delivery >= 0`.

Visit 2 — THE BUG:
4. Reopen the **same form on the same woman** from her profile. This time
   "Has she delivered ?" is not asked (she is in the PNC cohort); the form
   lands directly on **"Mother PNC Danger Signs"** — and the required
   **"Enter next PNC visit date"** prompts **unconditionally**: every
   follow-up visit demands scheduling the next postnatal appointment,
   including when the visit's reason is that her subsequent pregnancy ended
   in miscarriage (the ticket's complaint — the bind has no `relevant` gate
   at all; see the curl above).

## 4. [OPERATOR] Rebuild + start the cht-agent runtime
From the branch carrying **Mission 05** (`feat/mission-05-xlsform-orchestrator`,
or `integration/demo-closed-loop` once it's merged) — see step 0.5, a stale
image without exceljs crashes the dev phase:
```bash
# HOST side — mount sources for docker-compose.cht-agent.yml. The config repo
# mounts rw at /workspace/cht-conf-project inside the container; step 2's
# `npm ci` must have run BEFORE `up` so the pinned cht-conf rides the mount:
CHT_CORE_PATH=/path/to/cht-core-4.21-build     # → /workspace/cht-core (provisioning source)
CHT_CONF_PATH=/workspace/site-config-test      # → /workspace/cht-conf-project

# CONTAINER side — agent env (compose hard-sets CHT_CONF_PATH to the container
# path; add the rest to the compose environment block or an override):
LLM_PROVIDER=claude-cli
ANTHROPIC_MODEL=claude-opus-4-8          # do NOT burn the Fable session budget
CHT_URL=https://nginx
NODE_EXTRA_CA_CERTS=/path/to/local-ca.crt      # or NODE_TLS_REJECT_UNAUTHORIZED=0
CHT_CONF_PATH=/workspace/cht-conf-project      # set by compose; A1 writes the generated fix here
CHT_CONF_BIN=/workspace/cht-conf-project/node_modules/.bin/cht  # QA applyConfig runs the
#   repo-pinned cht-conf 3.21.4 (installed by step 2's npm ci), not the workbench cht-conf
CHT_TEST_DATA_PATH=<container-visible path>    # optional (QA prepareTestData; needs its own mount)
# CANONICAL_CONF: leave UNSET — this is a real (un-planted) bug, so there is no
#   known-good baseline; canonical-diff is inconclusive here. The agent pinpoints
#   the skip-logic from the ticket + form, and reproduce→verify is the proof.
```
Copy the ticket into the runtime's tickets dir:
`cp /workspace/site-config-test/demo-echis-pnc-ticket.md <cht-agent>/tickets/`

## 5. [AGENT] Run the closed loop
```bash
docker exec -it cht-agent npm run full -- tickets/demo-echis-pnc-ticket.md --qa --qa-tier2
#                                      ^^ the -- is LOAD-BEARING: npm silently
# swallows unknown flags before it — `npm run full <ticket> --qa` runs WITHOUT
# QA (verified on npm 10.9). Add --qa-auto for unattended HC3. Answer YES to
# the preview prompt to get HC2. --qa-tier2 (optional): after tier-1 GREEN,
# QA also runs the generated test/forms/<form> harness spec with this repo's
# pinned mocha + cht-conf-test-harness 3.0.15 (in-container Chromium) and the
# closed loop only counts as succeeded if it passes.
```
- **HC1 (research):** routes from frontmatter (`layer: cht-conf`, `configArtifact:
  form`, `artifactName: postnatal_care_service`) with no LLM; code-context locates
  the next-PNC-visit-date question + the outcome field that should gate it.
- **HC2 (development — Mission 05, the fix lands in the `.xlsx` source):** the
  code-gen CLI writes only the fix descriptor
  (`.cht-agent/xlsform-fix.json`); a deterministic supervisor node applies it
  to a temp copy of the `.xlsx` survey row, runs an offline
  `convert-app-forms -- postnatal_care_service` (repo-pinned 3.21.4), and
  asserts the regenerated bind — expected result:
  `relevant=" /postnatal_care_service/group_pregnancy_status/has_delivered ='yes'"`
  on the `next_pnc_visit_date` bind (mirroring the sibling groups' gate). HC2
  shows a **bind-level diff** (before → after + "N sibling binds unchanged").
  Approve → the corrected **`.xlsx` AND `.xml`** are written into
  `CHT_CONF_PATH` (the working copy; `.cht-agent/` itself is never copied
  there). The corrected `.xlsx` is the partner handback artifact.
- **HC3 (QA, red→green):** provision → discoverConfig(pre) → **reproduce** (deployed
  form still unconditionally prompts = RED; aborts if it does NOT reproduce) →
  approve destructive seed/apply → applyConfig the fix (`app-forms` bucket —
  convert+upload, now legitimate since the workbook already carries the fix;
  artifact `postnatal_care_service`) → discoverConfig(post) → **verify**
  (deployed bind now gated = GREEN). QaResult carries both red + green evidence.

## 5b. [OPERATOR] Manually prove the fix (curl + browser) — AFTER the loop

```bash
curl -sk -u medic:password "https://localhost:10443/api/v1/forms/postnatal_care_service.xml" \
  | grep -o '<bind nodeset="[^"]*next_pnc_visit_date"[^>]*>'
# FIXED: the bind now carries
#   relevant=" /postnatal_care_service/group_pregnancy_status/has_delivered ='yes'"
```

Browser, as the same CHV user (`demo_chv`):

1. **Force a sync first** — hamburger menu → **Sync now** (offline clients
   pull config on their sync interval: 5 min stock, **30 min on the
   sync-interval-30 fork** — never wait for auto-sync in a demo).
2. Repeat step-3b **Visit 2** (reopen the form on the woman with the
   recorded delivery): the "Mother PNC Danger Signs" page still renders with
   its other questions, but **"Enter next PNC visit date" is gone** — it is
   now gated on an explicit `has_delivered = 'yes'`, which a follow-up visit
   never asserts.
3. No-regression half: run the **Visit-1 flow on a different seeded woman**
   ("Has she delivered ?" → **Yes**) → the question still prompts on the
   genuine delivery path.

## Caveats (fidelity — read before relying on results)
- **cht-conf version in convert + apply.** Compose now defaults
  `CHT_CONF_BIN` to this repo's pinned **cht-conf 3.21.4**; BOTH the
  Mission-05 dev-phase offline convert AND QA's `applyConfig` run it — full
  version parity, and the apply touches only the ONE changed form
  (`convert-app-forms`/`upload-app-forms -- postnatal_care_service`). Don't
  override `CHT_CONF_BIN` to the workbench cht-conf (6.5.0) here: the config
  was authored against 3.21.4, and the dev-phase assert compares the
  regenerated XML that the same pinned converter will produce at apply time.
- **Harness tier-2** (workbench 5.0.4 emulates core 4.11 only) can't emulate the
  custom 4.21 build — the **tier-1 deployed-XML assertion** (verifyArtifact) is the
  reliable automated proof here; run the repo's own harness (3.0.15) separately for
  Enketo-level skip-logic if desired.
- **verify-set** is snapshotted from the CORRECTED local form, so the deployed
  pre-fix form fails it (red) and the post-fix form passes it (green) — this is why
  no canonical baseline is needed.

## 6. Report + teardown
The agent reports the corrected `relevant` (with red→green evidence) for YOU to
apply on the real project. `[OPERATOR]` teardown: `docker compose down -v` — the
throwaway env + dummy data go away with the volumes.
