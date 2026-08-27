# Review: `maisha-demo-full-procedure.md`

Adversarial correctness/completeness review, 2026-08-25, against branch
`fix/pipeline-hardening` @ `09942a4`. Everything below was checked against the
actual code, the demo-conf working copy (read-only), and the repo's own test
suite (`npm test`: **1882 passing, 0 failing**). The live instance was down
during this review, so the §1.11/§3 curls were verified against code and the
local demo-conf files instead of live responses (noted per claim).

---

## 1. Verdict

**No — not from this doc alone, as it stands.** A competent operator who has
never seen this system hits three hard stops:

1. The container-auth model the doc describes no longer exists (the compose
   file uses an in-container `/login` volume, not a host credential mount), so
   the very first agent command fails and the doc's remedy cannot fix it.
2. The doc's own §1.4→§1.5 ordering strands the harness `--no-sandbox` commit
   outside the `maisha-baseline` tag, so every Phase A reset breaks tier-2 for
   the rest of the run — and this exact state exists in demo-conf right now.
3. On this machine the `maisha-baseline` tag itself contains the M5 fix
   ("demo baseline v2: M5 pnc fix applied"), so ticket 1 cannot go RED.

The pipeline code itself checks out: nearly every claim the doc makes about
what the code does is accurate (checkpoint order, flag parsing, apply buckets,
oracles, PR-bundle scoping, binary hunks, descriptor capture). The failures
are in the *setup and state* half of the doc — auth, baseline hygiene, and two
places where the doc describes a design that has since changed. Each blocker
is a small, local fix; with them applied the verdict becomes yes-with-gaps.

---

## 2. Findings (most severe first)

| # | Severity | Where | What goes wrong for the operator | Smallest fix |
|---|---|---|---|---|
| 1 | **blocker** | §0 bullet 4, §1.10, §5 trap "Stale OAuth mount" | The doc says the container "mounts the host credentials read-only" and that `--force-recreate` re-binds a rotated host file. The **committed** compose file does neither: credentials live in the named volume `agent-claude-config`, minted by a one-time in-container `/login` (or supplied via `CLAUDE_CODE_OAUTH_TOKEN`); the host-file bind is commented out (`docker/docker-compose.cht-agent.yml:141-178`). On a cold machine `docker exec cht-agent claude -p "say ok"` fails unauthenticated, and the doc's remedies (host `claude -p`, `--force-recreate`) cannot fix it — the operator is stuck at the first agent command with wrong guidance. | Replace the §0/§1.10 auth story: one-time `docker exec -it cht-agent claude` → `/login` (persists in the volume across recreates), or `claude setup-token` on the host → `export CLAUDE_CODE_OAUTH_TOKEN` before `up`. Delete the stale-inode rationale and the §5 trap row's remedy. |
| 2 | **blocker** | §1.4 → §1.5 ordering | §1.4 runs `git tag maisha-baseline`; §1.5 *then* says to commit the harness `--no-sandbox` fix "into the baseline" — with no re-tag. Phase A's `git checkout -B fix/maisha-$TICKET maisha-baseline` resets to the tag, stranding that commit, so in-container tier-2 dies environmentally ("No usable sandbox!") for **every** ticket after the first reset (Phase A runs before ticket 1 too). This is not hypothetical: in demo-conf today, the tag is `bb73fbd` and the `--no-sandbox` commit `5bb13de` sits after it, outside the tag. | Add `git tag -f maisha-baseline` to §1.5 after the harness commit, and a §1.11 preflight line: `git show maisha-baseline:harness.defaults.json \| grep no-sandbox`. |
| 3 | **blocker** (this machine) / major (cold clone) | §1.4, §2 Phase A | The current `maisha-baseline` tag = `bb73fbd` "demo baseline v2: **M5 pnc fix applied**". Phase A restores a config where `next_pnc_visit_date` already carries `relevant="…has_delivered ='yes'"` (verified in `git show maisha-baseline:forms/app/postnatal_care_service.xml`), so M5's QA aborts at "symptom did not reproduce". §1.4's reuse bullet does cover this — but as an aside, with an undefined `<pristine-baseline-sha>` placeholder (it is `f847ea1` here), and it is easy to skip. Also `test/forms/postnatal_care_service.agent.spec.js` is **tracked** in the tag; if the `git rm --cached` in that bullet is skipped, the M5 patch emits a modify-hunk for a file the pristine clone doesn't have and `git apply --check` in §4 fails. | Promote the §1.4 revert bullet to a checked preflight: `grep -L 'next_pnc_visit_date.*relevant' forms/app/postnatal_care_service.xml`-style local assertion on the **tagged tree** for all five bugs, and name the sha (`f847ea1`). |
| 4 | **major** | §2 Phase C table (HC5 row), §3.3 | The doc says HC5 offers `accept / widen / widen-relax / abandon`. The code offers **accept / abandon only**: `scopeGateOptions` has a "DEMO SAFETY CUT" early-return (`src/utils/scope-gate.ts:435-450`), and `askWithOptions` accepts only listed options (`src/utils/prompt.ts:79-100`), so the widen paths are unreachable. An operator planning to widen at the gate is misled at a live prompt. | State that this build offers accept/abandon only (widen branches cut for the demo; the panel/conflict findings still render). |
| 5 | **major** | §2 Phase C ("Five human checkpoints") | Before research, the CLI asks an interactive question the doc never mentions: "👁️ Would you like to preview changes before writing to cht-core? (recommended)" (`askDevelopmentOptions`, `src/workflows/orchestrator.ts:317-332`). **HC2 exists only in preview mode** (`src/workflows/development-workflow.ts:377-389`): answering "no" writes the generated files with no approval gate at all. A new operator meets an unexplained prompt whose wrong answer silently deletes checkpoint 2. | Document the prompt as step 0 of Phase C and instruct "yes". |
| 6 | **major** | §1.8 | Two failures for a cold machine: (a) `npm run demo:build-seed` runs `ts-node` from the workbench's `node_modules`, and no step ever runs `npm ci` in the **workbench** (only in demo-conf, §1.5) — the command dies with "ts-node: not found"; (b) `<scrubbed-export.json>` and `<users.json>` are placeholders with no stated source — a new operator cannot produce them. The `demo_chv` password is also never stated (the builder defaults it to `ChangeMe_123`, visible only in tool output), and the seeder's assumption that the CHV username is `demo_chv` (overridable via `DEMO_CHV_USER`, undocumented) is silent. | Add `cd <workbench> && npm ci` to §1; say where the scrubbed exports come from (engagement owner / the `demo-seed-design.js` alternative); state the default password and the `DEMO_CHV_USER` override. |
| 7 | **major** | §2 Phase A (A1) | Two false comfort claims. (a) The comment "`git clean -qfd` — drop generated specs + the fix descriptor" only holds while `.cht-agent` is *not* gitignored: demo-conf's working tree currently carries the legacy bare `.cht-agent` entry as an **uncommitted** `.gitignore` edit, which `checkout -B` silently carries into every ticket branch (the file is identical across the relevant commits), and `git clean -fd` skips ignored files — so a stale `xlsform-fix.json` survives resets, and the ignore-proof capture (`workspace.ts:155-167`) can then attribute a previous ticket's descriptor to a run whose CLI failed to write one. (b) "`git status --short` MUST be empty" — on this machine it will not be (dirty `.gitignore`, PNC xlsx/xml, agent spec), and the doc gives no remediation. | Phase A: `rm -rf .cht-agent` (the whole directory, not just `pr/`), and add one remediation line for a non-empty status (`git checkout -- . && git clean -fd`, after confirming nothing wanted is dirty). |
| 8 | **major** | §1.10 (TLS) | "NODE_EXTRA_CA_CERTS=/workspace/local-ca.crt (preferred)" points at a mount that is **commented out** in compose (`LOCAL_CA_CERT` stub, line 182) — set alone, it names a nonexistent file. And on the committed branch `NODE_TLS_REJECT_UNAUTHORIZED` defaults to **empty** (the `:-0` default is an uncommitted local edit to the compose file): a cold clone that reads "or NODE_TLS_REJECT_UNAUTHORIZED=0 for self-signed" as optional gets a QA phase that burns the full 300 s readiness poll and aborts with a bare "fetch failed". | Commit the compose default (or make `export NODE_TLS_REJECT_UNAUTHORIZED=0` an explicit numbered command before `up`); note that the CA route requires uncommenting the `LOCAL_CA_CERT` mount. |
| 9 | minor | §2 Phase C | `--qa-auto` also auto-resolves **HC5** to `accept` without prompting, and HC5 prompts only on a TTY (`isScopeGateInteractive`, `orchestrator.ts:118-119`) — running Phase C without `-it` silently records ACCEPT. The doc names only HC3 and HC4. | One sentence: `--qa-auto` (or a missing TTY) records ACCEPT at HC5; keep `-it`. |
| 10 | minor | §3.3 | "HC5 will surface the narrowing" is overstated: the gate opens only on deferred *blocking* recommendations or new tier-2 failures (`assessScope`, `scope-gate.ts:315-344`). The three-forms narrowing is surfaced as the REPRESENTATIVE-scope caveat in the QA transition and PR.md (`verify-scope` → `qa-workflow.ts:391-396`), which may never present a prompt. If HC5 doesn't open, the bundle is written without any question — fine, but not what the doc primes you for. | Rephrase: the narrowing rides the QA scope caveat and PR body; HC5 opens only if validation deferred blocking items. |
| 11 | minor | §1.11 | The M5 curl's grep prints **two** binds — the target and the `_supporting_info/_next_pnc_visit_date` mirror, which legitimately has no `relevant` — so "no relevant=" needs to be read against the right line. The `git check-ignore` line detects the bare entry but gives no action when it fires (the auto-narrow only happens at PR-bundle write time, i.e., at the *end* of the first successful ticket). | Name the target bind; add "if check-ignore matches, edit the line to `.cht-agent/pr` and commit it into the baseline". |
| 12 | minor | throughout | Placeholders `<workbench>`, `<stack-dir>`, `<project>`, `<cht-core-checkout>`, `<pristine-baseline-sha>` are never defined in one place; `<stack-dir>`/`<project>` are only inferable from §1.6 (`cht-421-official`, compose project name). | A 5-line "paths used in this doc" block at the top. |
| 13 | minor | §4 vs PR.md | The generated PR.md's own "Applying this change" section instructs `docker cp` (`pr-bundle.ts:626`), while the doc (correctly) says the bind mount makes that unnecessary. Reviewers will notice the contradiction. | One sentence in §4: ignore PR.md's docker-cp block. |
| 14 | minor | §1.10 | "Set `ANTHROPIC_MODEL=claude-opus-4-8`" — that is already the compose default (`docker-compose.cht-agent.yml:90`). Harmless, but reads as a required action. Also worth stating: tickets are **baked into the image** (`Dockerfile: COPY tickets ./tickets`), so editing a ticket file requires the §1.10 rebuild, not just a new `exec`. | Reword as "the compose default; override only to change it"; add the ticket-rebuild note. |
| 15a | **major** (found live, 2026-08-25) | §1.7, §1.8, §6 | Every host-side cht-conf verb that hits the instance fails with `Unable to fetch xml attachment … status code = undefined`: the API's `AuthSession` cookie is set for domain `localhost`, and the newer transitive `tough-cookie` installed by §1.5's `npm ci` rejects `localhost` as a special-use public suffix inside cht-conf's PouchDB fetch. Reproduced and isolated with a direct PouchDB call; the identical call via `127.0.0.1` succeeds. In-container runs are unaffected (`https://nginx`). | Change the doc's `URL` to `https://medic:password@127.0.0.1:10443` everywhere host-side cht-conf runs (curl checks can keep localhost). |
| 15 | minor | §1.11/§1.12 | A stale bundle exists in demo-conf right now (`.cht-agent/pr`, dated 2026-08-10) and it predates the binary-hunk fix — zero `GIT binary patch` markers, so §4 step 1 would fail on it. Phase D's freshness check is the guard, but setup should clear it once. | Add `rm -rf demo-conf/.cht-agent/pr` to §1.11. |

---

## 3. Claim-by-claim verification (the eight technical claims)

1. **HC1–HC5, order and choices** — ✔ verified with two corrections.
   HC1 `research-workflow.ts:134`, HC2 `development-workflow.ts:206` (preview
   mode only — finding 5), HC3 `qa-workflow.ts:257-284`, HC4
   `orchestrator.ts:289-312`, HC5 `orchestrator.ts:457` — in that order.
   HC5 choices are **accept/abandon only** (finding 4). `abandon` writes no
   bundle, prints the revert list, and exits 1 (`orchestrator.ts:496-499`,
   `full.ts:184-186`) — ✔ as the doc says.
2. **CLI flags** — ✔. `--qa`, `--qa-tier2`, `--qa-auto`/`--qa-yes` parsed by
   inclusion in argv (`full.ts:99-111`); ticket = first non-dash arg. The
   `--qa-auto` claim about suppressing HC4 is ✔ (`askQaRetry`,
   `orchestrator.ts:307-310`) — it additionally auto-accepts HC3 and HC5. The
   npm `--`-swallowing warning is correct npm behavior.
3. **Per-artifact routing** — ✔ in full. `isXlsformFixTicket` routes
   `form` + `contact-form` to the descriptor path (`xlsform-fix.ts:229-235`);
   apply buckets exactly as documented (`APPLY_ACTIONS_BY_ARTIFACT`,
   `qa-workflow.ts:80-87`: M5→app-forms, M8/M7→contact-forms,
   M4/M3→app-settings); XLSForm tickets get the bind + whole-document XML
   oracle, settings tickets the compiled-settings oracle
   (`deriveVerifyOptions`, `qa-workflow.ts:117-159`) with sections
   task→`tasks.rules`/`tasks.targets`/`tasks.isDeclarative`,
   contact-summary→`contact_summary` (`compiled-settings.ts:161-180`), and the
   comparator is the byte/deep compare over compiled-owned keys the doc
   describes. The documented QA order (provision → discover → RED → HC3 →
   seed → apply → discover/rev → GREEN → tier-2) matches
   `executeQaWorkflow` exactly. The §3.5 ordering note is ✔: the app-settings
   apply runs `compile-app-settings` with `cwd = the mount`
   (`cht-conf-runner.ts:37,271`), regenerating the mount's
   `app_settings.json` before tier-2 reads it.
4. **Deployed-form id mapping** — ✔ in code: `deployedFormId` maps
   `e_household-create → contact:e_household:create`,
   `f_client-create → contact:f_client:create` (`form-paths.ts:74-90`),
   matching the doc's curl URLs. **Live curls not re-verifiable** — the
   instance is down (http 000). Local demo-conf files confirm the buggy M7
   bind (`relevant="../age_in_years_member &lt; 18"` only), the buggy M8
   `calculate`, and the M3 typo; the local M5 form carries the *fix* (see
   finding 3).
5. **PR bundle** — ✔ in full. Written to `<configRoot>/.cht-agent/pr/{PR.md,
   changes.patch}` (`pr-bundle.ts:34,650-660`); the config repo is a plain rw
   bind mount (`docker-compose.cht-agent.yml:153`) so it is on the host with
   no docker cp; the patch is scoped to `filesWritten` with excluded files
   reported, `--binary` on both tracked and untracked hunks
   (`buildPatch`, `pr-bundle.ts:213-289`); abandon writes nothing — ✔.
6. **gitignore/descriptor** — ✔ with a timing caveat. `ensureGitignored`
   appends only `.cht-agent/pr` and narrows a legacy bare entry on sight
   (`pr-bundle.ts:44-151`), and `captureChtCoreDiff` force-captures the
   descriptor even when gitignored (`IGNORE_PROOF_PATHS`,
   `workspace.ts:155-167`) — so the doc's "current pipeline narrows … capture
   works anyway" is true. Caveat: the narrowing runs only inside
   `writePrBundle` (end of a successful run), and Phase A's checkout restores
   the baseline `.gitignore` each ticket, so the preflight's remediation gap
   matters (findings 7, 11). demo-conf's bare entry is confirmed present
   today (working-tree edit; the baseline commit has none).
7. **tier-2 selection + qaSpecs** — ✔. Pinned `qaSpecs` run exactly, with
   missing entries an honest skip that names them (`findTier2Specs`,
   `cht-conf-tier2.ts:184-210`); defaults per artifact as documented. All
   five pinned spec files exist in demo-conf (M4's three, M3's two). The
   "regression-guard only" claim is **consistent with spec content**:
   `test/tasks/postnatal_care_service_newborn.spec.js` exercises the
   `pnc_home_visit_newborn` task, not the `newborn-immunization-follow-up`
   referral task M3 fixes — but "all three pass on the buggy baseline" was
   not re-run here (running the partner harness in the read-only repo was out
   of scope).
8. **Setup scripts** — ✔. `neutralize-config.js`: `--check` makes no edits,
   `--strict` exits 1 on findings, edits are idempotent, forms/tasks/etc.
   untouched. `seed-maisha-cohorts.js` (read only, not run): idempotent
   rev-fetch + `_bulk_docs` upsert, every id `maisha-seed-`-prefixed,
   hierarchy discovered from `demo_chv` (`DEMO_CHV_USER` overridable), the
   four lanes exactly as tabled (M4: 14-day newborn + `bcg opv_0 opv_1`
   report; M3: 10-day newborn + delivery + `M3_DUPLICATES`=3 reports due
   today), DOBs refreshed on rerun.

**Ticket-specific mechanics (claim 9)** — ✔ against demo-conf: M3 event
`{start: 0, end: 14}` with `dueDate` = the form's `immunization_follow_up_date`,
whose bind calculates `today()+3` (`postnatal_care_service_newborn.xml`);
`resolvedIf` at `tasks.js:1368` carries the `posnatal_` typo and omits the
`sourceID` argument the mother-side template passes at `tasks.js:207-215`.
M4: `is_immunization_defaulter` computed only inside `if (isNewborn)`
(`contact-summary.templated.js:171-176`), mirror at `tasks.js:1329`; the
`imm_schedule_upto_date` predicate exists at `tasks.js:1007` (its deadness not
independently verified). M8/M7 binds as quoted. M5's *absence of relevant*
holds only for the pristine partner form — the local tree and the baseline tag
both already carry the fix (finding 3). The M8 pyxform guardrail is real:
the editor refuses `clear: true` on a `calculate`-type row with a descriptive
error (`xlsform-editor.ts:273-301`).

---

## 4. Claims I could not verify

- ~~Anything asserted about the deployed instance~~ **Update (2026-08-25,
  instance restarted):** the §1.11 preflight GETs were run live. M3 typo,
  M7 age-only bind, and M8 calculate are deployed and buggy ✔. **M5's
  deployed bind already carries the fix** (`relevant="…has_delivered ='yes'"`)
  — finding 3 is confirmed on the instance as well as in the tag: the M5
  bug must be restored (revert to `f847ea1`, re-tag, re-upload app-forms)
  before ticket 1. Still unverified live: the M3 task-pile behavior
  (3→0 pre-fix / 3→2 post-fix) and Phase A A4's reset assertion — both need
  a seeded, reset cycle to observe.
- **Pinned tier-2 specs pass on the buggy baseline** (§3.4). Requires running
  the partner harness inside the read-only repo. Spec content supports it
  (they don't assert the broken behaviors), but "pass" was not observed here.
- **§1.6 external artifacts**: the staging.dev compose URLs, and the
  `VERSION=` vs `TAG=` local-build behavior.
- **The pristine partner repo contains all five bugs** — no `site-config`
  clone exists on this machine to check, and demo-conf's git history starts
  at the neutralized import. If the partner repo has since fixed any of the
  five, RED never reproduces; §1.11 is the (deployed-side) catch.
- **M5 handback note** "nothing in-config consumes those fields (verified)" —
  no method stated, not re-derived here.
- **Time budgets** (2–3 h setup, 25–35 min/ticket) and the in-container
  Chromium/tier-2 behavior for M3/M4 (the doc itself flags the latter).
- **"HC2's compile gate has already proven compile-app-settings passes"**
  (§3.4) — the gate and its skip-banner exist (`development-workflow.ts:233-240`);
  that it *ran* rather than skipped in a given run is only visible at HC2.

---

## 5. What's missing (a newcomer would still be stuck on)

- **Failure paths.** The doc documents the happy path plus traps, but not
  what to *do* when: HC2 is rejected 3× (the dev loop exits unapproved —
  nothing tells you whether to re-run or edit the ticket), QA aborts on
  non-reproduction (which of "config drift / wrong version / bug already
  fixed" to check first — the §1.11 curls are the tool, but nothing says so),
  the apply fails mid-QA (the instance may now hold a half-uploaded config —
  is a Phase A reset mandatory before retrying?), ENVIRONMENT DRIFT aborts
  fire (`QA_ALLOW_DRIFT=1` exists in code, `qa-workflow.ts:305`, and is
  nowhere in the doc), or §4's `git apply --check` fails (no triage steps).
- **Workbench `npm ci`** (finding 6) and the **provenance of the seed
  exports** — the only two hard gaps in "nothing set up → running".
- **The preview-mode question** (finding 5) — the sixth interactive prompt.
- **demo_chv credentials** (`ChangeMe_123` default) — needed twice (§1.9
  login, Phase A A5).
- **§4 sufficiency**: the review pass is good (apply-check, scope, HC2 match,
  `app_settings.json` absence — which is real: demo-conf gitignores it, so it
  can never enter the patch as an untracked file) and the freshness check in
  Phase D closes the stale-bundle hole. Two additions would make it robust:
  check PR.md's **QA headline** (the fact-derived verdict can be stricter
  than the console's "succeeded" — `pr-bundle.ts:464-474`), and diff the
  patch's file list against PR.md's "Changes" list (they are generated from
  the same object today, but that is the invariant worth checking).
- **A one-shot preflight for the baseline tag** — the two worst findings (2,
  3) are both "the tag isn't what you think". A five-line check
  (`git show maisha-baseline:…` for the M5 bind, the M3 typo, the harness
  args, and a clean `git status`) would catch every state this review found.

---

*Review artifacts: workbench suite green (1882 passing). No files were
modified; demo-conf was accessed read-only; the live instance was not
contacted beyond GET probes (it is down).*
