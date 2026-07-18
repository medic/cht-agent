# Implementation plan — full closed loop for ALL configArtifacts

Extends the pipeline from its current `configArtifact: form`-only closed
loop to every artifact in the taxonomy, so the Maisha tickets (M7/M8
contact-form, M4 contact-summary, M3 task) run end-to-end exactly like the
M5 demo: research → HC1 → dev → HC2 → **`--qa` red→green → HC3** →
`--qa-tier2`. This is the concrete elaboration of items 2–3 of the PR
sequencing in `134-cht-conf-extension-spec.md`, driven by the gap analysis
behind `maisha-demo-runbook.md` §1.

## 0. Facts this plan rests on (verified 2026-07-18)

Code seams (this branch):

- The **only** artifact routing gate is `isXlsformFixTicket` —
  `layer === 'cht-conf' && configArtifact === 'form'`
  (`src/utils/xlsform-fix.ts:187-190`). Everything downstream is gated on
  either that, the descriptor's presence, or `VerifyArtifactType = 'form'`
  (`src/types/index.ts:680`).
- Three hardcoding families to break: **(a)** the `forms/app/<form>.*` path
  (`xlsform-apply.ts:281-282,335`; `cht-conf-test-spec.ts:33,402`;
  `qa-workflow.ts:86,229`; prompts `lib/prompts.ts:191,196`), **(b)** the
  `relevant`-only oracle (`XlsformFixExpectation` `xlsform-fix.ts:28-33`;
  `FormBindExpectation` `types/index.ts:662-677`; `verifyFormBinds`
  `xform-inspect.ts:148-183`), **(c)** the `form`-only type wall
  (`types/index.ts:680`; guards `qa-workflow.ts:83,300-302`;
  `test-environment-agent.ts:391`; `APPLY_ACTIONS_BY_ARTIFACT`
  `qa-workflow.ts:55-57`).
- Already generalized, no work needed: `runOfflineConvert` takes a
  `bucket: 'app-forms'|'contact-forms'` param (`cht-conf-runner.ts:301-311`,
  `CONVERT_VERBS :261-264`) — callers just never pass it; the
  `contact-forms` upload bucket exists (`cht-conf-runner.ts:43`); the
  sandbox copier is artifact-agnostic (`createConvertSandbox :286-293`);
  the F2 bind inspector is root-agnostic and takes XML strings
  (`xform-inspect.ts:53-183`); the F6 whole-document comparator is
  attribute-complete and path-agnostic (`canonicalDiffLines`
  `xlsform-apply.ts:238-260`); `fetchFormRevs`' `form:`→`form:￰` range
  already includes `form:contact:*` docs (`cht-api.ts:142-163`).

cht-conf 3.21.5 (the pinned toolchain actually installed in the partner
repo — note frontmatter still says 3.21.4, see §7):

- `convert-contact-forms`/`upload-contact-forms` accept the same `--
  <form>` positional filter as the app-form verbs (`args-form-filter`), so
  per-form apply works unchanged.
- Contact-form doc id derivation: `e_household-create.xlsx` →
  `form:contact:e_household:create` (`-` → `:`, `contact:` prefix;
  `src/lib/upload-forms.js:55,73`).
- **`compile-app-settings` output is byte-stable** on unchanged input
  (deterministic `JSON.stringify(…, null, 2)`, deterministic embedded-JS
  minification, no timestamps in the compile path) → a byte-exact
  compiled-settings oracle is viable.

Empirical, against the running 4.21.1 instance (2026-07-18):

- `GET /api/v1/forms/contact:e_household:create.xml` → **200**, returns the
  deployed contact form (the buggy `is_orphan` bind included). So the
  existing `fetchFormXml` (`cht-api.ts:118-138`) serves contact forms as-is
  given `formId = contact:<type>:<action>`; no CouchDB-attachment fallback
  needed (that also works: `/medic/form:contact:e_household:create/xml` →
  200).

Harness (partner-pinned `cht-conf-test-harness@3.0.15`):

- Exposes `fillContactCreateForm`/`fillContactEditForm`
  (`src/harness.js:233,246`) but **no `loadContactForm`** — a generated
  contact-form spec must use the fill-based API, not the current
  `loadForm`+XML-read shape (`cht-conf-test-spec.ts:389-402`).

## 1. Target end-state (per configArtifact)

Two oracle families cover the whole taxonomy:

| configArtifact | Dev path | Apply bucket | QA oracle | Tier-2 |
|---|---|---|---|---|
| `form` | XLSForm orchestrator (today) | `app-forms` | form-xml binds + F6 whole-doc (today) | generated `test/forms/` spec (today) |
| `contact-form` | XLSForm orchestrator (**P1**) | `contact-forms` (**P3**) | form-xml binds + F6, `forms/contact/` + `contact:` id (**P3**) | generated fill-based spec (**P5**, stretch) |
| `task`, `target`, `contact-summary`, `app-settings` (incl. messaging/purge sections) | generic LLM code-gen (today — correct for JS/JSON) | `app-settings` (**P4**) | **compiled-settings byte-exact** (**P4**) | partner-suite spec selection (**P5**) |
| `translations`, `resources` | generic | `resources` | doc/attachment compare — backlog, not needed for Maisha | — |

## 2. P1 — contact-form parity in the XLSForm orchestrator

*Enables: M7 dev phase (descriptor → exceljs → offline convert → bind assert).*

1. **Routing**: `isXlsformFixTicket` accepts
   `['form','contact-form'].includes(configArtifact)`
   (`xlsform-fix.ts:187-190`).
2. **Path resolver**: new `resolveFormRelPaths(configArtifact, form)` →
   `{xlsxRelPath, xmlRelPath}` over `forms/app/` vs `forms/contact/`.
   Consumers: `applyXlsformFixToProject` (`xlsform-apply.ts:281-282`, XML
   read-back `:335`), the code-gen brief (`lib/prompts.ts:191,196` — the
   ONLY prompt edit site; the mirror
   `src/layers/code-gen/modules/claude-code-cli/prompts.ts` imports
   `buildXlsformFixBrief` and inherits the fix, no direct edit needed), HC2
   presentation, and the post-approve copy of corrected `.xlsx`/`.xml` into
   the mount.
3. **Convert bucket**: `applyXlsformFixToProject` passes
   `bucket: 'contact-forms'` for contact-form tickets — the runner already
   supports it. The `-- <form>` filter carries over (verified in 3.21.5).
4. **Descriptor**: schema unchanged (single `form` string; the artifact
   type comes from the ticket, threaded via `applyXlsformFixToProject`
   opts — do NOT duplicate it in the descriptor, one source of truth).
5. **Tests**: fixture contact form (planted bug) + unit specs for the
   resolver and the contact bucket convert; a `pyxform`/convert smoke that
   the contact-form convert path works offline in the sandbox.

Exit: `npm run dev:run -- tickets/maisha-m7-….md` produces a verified
bindDiff on `forms/contact/e_household-create.xml`.

## 3. P2 — generalized bind oracle: any attribute, including ABSENCE

*Enables: M8 (remove a spurious `calculate`); also closes the known
reverse-direction gap (cannot assert "relevant must be absent").*

1. **Descriptor `expect`** (`xlsform-fix.ts:28-33`, 
   `src/schemas/xlsform-fix.schema.json`): from `{nodeset, relevant,
   siblingsUnchanged?}` to
   `{nodeset, attrs: { [attr]: string | null }, siblingsUnchanged?}` where
   `null` = "attribute must be ABSENT". Back-compat shim: `relevant: x` ⇒
   `attrs: {relevant: x}` (keep parsing both; the descriptor-tolerance
   layer F8 already coerces shapes).
2. **Inspector** (`xform-inspect.ts`): `extractBindRelevant` →
   `extractBindAttr(xml, nodeset, attr)`; `verifyFormBinds` compares the
   full `attrs` map with three-way semantics (expected value / expected
   absent / bind missing), reporting honest mismatches both directions.
   `FormBindExpectation`/`FormBindCheck` (`types/index.ts:662-677`) carry
   `attrs`.
3. **Editor clear semantics** (`xlsform-editor.ts:261`): add
   `set: {column, clear: true}` → `cell.value = null` (true cell clear),
   rather than relying on `""` round-tripping through pyxform as absent.
   Unit-verify both: empty-string vs cleared cell through
   `convert-*-forms` — whichever provably drops the bind attribute becomes
   the documented pattern in the code-gen brief.
4. **Threading**: dev-phase assert (`xlsform-apply.ts:338-350`), QA
   `verifyArtifact` (`test-environment-agent.ts:387-416`), and the HC2
   bind-diff rendering all move to the `attrs` map. F6 whole-doc oracle is
   already attribute-complete — unchanged.

Exit: a descriptor `{attrs: {calculate: null}}` on the M8 fixture verifies
RED (calculate present) → GREEN (absent), with `relevant`/`required`
asserted unchanged.

## 4. P3 — QA closed loop for contact-form

*Enables: M7/M8 `--qa` red→green + HC3.*

1. **Type wall**: `VerifyArtifactType = 'form' | 'contact-form'`
   (`types/index.ts:680`); guards updated
   (`test-environment-agent.ts:391-394`, `qa-workflow.ts:300-302`).
2. **`deriveVerifyOptions`** (`qa-workflow.ts:77-105`): accept
   `contact-form`, read the corrected local XML from `forms/contact/`
   (via the P1 resolver). Same for the F6 oracle's
   `readCorrectedLocalForm` (`qa-workflow.ts:229`).
3. **Deployed fetch**: `deployedFormId(configArtifact, artifactName)` —
   `form` → `<name>`; `contact-form` → `contact:` + `<name>` with `-` → `:`
   (mirrors `upload-forms.js:55,73`; e.g. `e_household-create` →
   `contact:e_household:create`). `fetchFormXml` itself is unchanged
   (endpoint verified live, §0). Rev corroboration free
   (`fetchFormRevs` already spans `form:contact:*`).
4. **Apply bucket**: `APPLY_ACTIONS_BY_ARTIFACT['contact-form'] =
   ['contact-forms']` (`qa-workflow.ts:55-57`) — per-form filtered, pinned
   `CHT_CONF_BIN`, exactly like app-forms.
5. **Tests**: qa-workflow unit specs per artifact type; an integration
   spec against the planted contact-form fixture (RED abort-if-no-repro,
   HC3 gating, GREEN, rev change) mirroring the existing form specs.

Exit: `npm run full -- tickets/maisha-m7-….md --qa` runs the same
provision → discover → RED → HC3 → apply → discover → GREEN transcript the
M5 demo produced, on `e_household-create`.

## 5. P4 — compiled-settings oracle: task / target / contact-summary / app-settings

*Enables: M3/M4 `--qa` red→green. Dev phase intentionally stays generic
LLM code-gen (free JS edits, git-snapshotted, compile-gated) — that is the
right tool for JS artifacts; only QA verification is missing.*

1. **Oracle**: discriminate `VerifyArtifactOptions` into
   `{kind:'form-xml', …expectedBinds}` vs
   `{kind:'compiled-settings', sections: string[]}` (`types/index.ts:
   687-693`), and implement `verifyCompiledSettings`:
   - offline `compile-app-settings` on the LOCAL (corrected) source in a
     convert sandbox (reuse `createConvertSandbox`; add a `COMPILE` verb to
     the runner next to `CONVERT_VERBS`, `cht-conf-runner.ts:261-264`) —
     byte-stable output per §0;
   - fetch deployed settings (`fetchSettings`, `cht-api.ts:97-107`);
   - compare the artifact-owned **sections** byte-exact:
     `task|target` → `tasks` (and `targets`), `contact-summary` →
     `contact_summary`, `app-settings` → whole doc minus server-managed
     keys. RED = deployed section ≠ corrected-compiled. GREEN = equal.
   - **Drift guard (F6 analog)**: compile the PRE-FIX source too (the dev
     phase already captures the pre-fix git state — expose the baseline
     ref from the code-gen snapshot) and assert RED-time deployed ==
     baseline-compiled. "Deployed matches neither" = environment drift →
     abort, same posture as the whole-doc oracle
     (`QA_ALLOW_DRIFT` escape hatch carries over).
   - Normalization spike (first task of P4): diff
     `GET /api/v1/settings` output vs the compiled `app_settings.json` on
     an untouched deploy to enumerate server-injected/dropped keys and
     string-encoding differences; encode findings as a canonicalizer with
     unit fixtures. This is the only real unknown in P4.
2. **Apply bucket**: `task|target|contact-summary|app-settings` →
   `['app-settings']` (compile+upload; the `app-settings-only` bucket
   stays reserved for backup-recovered projects).
3. **Post corroboration**: capture the `settings` doc rev pre/post via
   `fetchDocRevs` (`cht-api.ts:170-193`, key `settings`) alongside the form
   revs.
4. **Config-type guard** (`config-type.ts:108-111`) unchanged — it already
   correctly demands the JS source in the mount for these artifacts.
5. **Tests**: unit fixtures with a planted `tasks.js` bug (the M3 typo
   shape is ideal) proving RED→GREEN and the drift abort.

Exit: `npm run full -- tickets/maisha-m3-….md --qa` reproduces RED
(deployed tasks section == buggy-compiled, ≠ corrected-compiled), applies
`app-settings`, verifies GREEN byte-exact, with the settings-doc rev change
in the QaResult.

## 6. P5 — tier-2 & test-gen generalization

*Behavioral proof layer; M7/M8 get generated specs, M3/M4 reuse the
partner's own suites.*

1. **Tier-2 spec selection** (`cht-conf-tier2.ts:79` `findFormSpecs`):
   parameterize by artifact —
   `form` → `test/forms/<form>*.spec.js` (today);
   `contact-form` → `test/forms/<form>*.spec.js` + generated spec (below);
   `task|target` → `test/tasks/**/*.spec.js` narrowed by a
   ticket-frontmatter override; `contact-summary` →
   `test/contact-summary*.spec.js`. Add optional frontmatter
   `qaSpecs: [<glob>, …]` (single-sourced in the ticket schema) so a
   ticket can pin exactly which partner specs constitute its regression
   surface — the M3/M4 tickets already name them in prose.
2. **Deterministic spec gen for contact-form**
   (`cht-conf-test-spec.ts`): second template using
   `fillContactCreateForm` (harness 3.0.15 API, `harness.js:233`) for the
   behavioral half, plus the durable XML-read oracle re-pointed at
   `forms/contact/` (path via the P1 resolver). Keep the app-form template
   untouched.
3. **task/contact-summary test-gen** stays LLM-generated but the prompt
   gains the house-pattern constraint (feed 1–2 existing specs from
   `test/tasks/` / `test/contact-summary.spec.js` as exemplars, same
   never-overwrite discipline as F7). Stretch, not demo-blocking — the
   partner suites already exist for M3/M4.

## 7. P6 — fixtures, docs, hygiene

- **CI-safe fixtures**: extend `demo/config-pnc-demo` with one planted
  contact-form bug (M7-shaped `relevant`) and one planted `tasks.js` bug
  (M3-shaped typo) + `PLANTED-BUG.md` entries, so every new path rehearses
  without the partner repo.
- **Docs**: update `demo-runbook.md`, `maisha-demo-runbook.md` §1/§5 (the
  manual-apply sections collapse into `--qa` runs), TEMPLATE worked
  examples for a contact-form and a task ticket.
- **Version-pin hygiene**: the partner repo's installed cht-conf is
  **3.21.5** (caret range) while ticket frontmatter says `3.21.4` — align
  frontmatter (or pin the repo) so the parity claim stays honest.
- **Gates**: full suite green; the four Maisha tickets each produce a
  clean `--qa` transcript against the fixture or the reconstructed env.

## 8. Sequencing, dependencies, sizing

```
P1 (contact-form orchestrator)  ──►  P3 (contact-form QA)  ──►  M7 e2e ✅
P2 (attrs+absence oracle)       ──►  (joins P3)            ──►  M8 e2e ✅
P4 (compiled-settings oracle)   ──────────────────────────────►  M3/M4 --qa ✅
P5 (tier-2/test-gen)            — after P1/P4, demo-optional
P6 (fixtures/docs)              — rolling, closes last
```

- P1 ≈ 0.5–1 day (path resolver + bucket param threading + fixtures).
- P2 ≈ 1–1.5 days (schema + inspector + editor-clear + threading; the
  pyxform empty-vs-clear verification is the only research item).
- P3 ≈ 1 day (type union + guards + id mapping + integration spec — the
  endpoint risk is already retired empirically).
- P4 ≈ 1.5–2 days (oracle + normalization spike + drift guard + revs).
- P5 ≈ 1 day (spec selection + contact template).
- Suggested PR boundaries = P1+P2, P3, P4, P5 (+P6 folded into each) —
  matching the "small PRs" carve-out list in `demo-branch-flow.md`.

## 9. Does this make M7/M8 full-pipeline demo tickets? (the question)

**Yes — M7 after P1+P3, M8 after P1+P2+P3.**

- **M7** (`is_orphan` `relevant`) is *exactly* an M5-class fix on a contact
  form: survey-sheet `relevant` edit → descriptor → offline
  `convert-contact-forms` assert → HC2 bind-diff → QA RED
  (`/api/v1/forms/contact:e_household:create.xml` today literally serves
  the buggy age-only bind — verified) → apply `contact-forms` bucket →
  GREEN + F6 whole-doc identity. One scoping call: the ticket names three
  affected forms (`e_household-create`, `f_client-create`, the reminder
  app form). The descriptor is single-form by design — run the demo on the
  reported surface (`artifactName: e_household-create`) and handle the two
  siblings as two more one-descriptor runs or a follow-up; do **not**
  extend the descriptor to multi-form for this (schema churn the retry
  tolerance layer would have to absorb; three small runs demo better than
  one wide one anyway).
- **M8** (remove a spurious `calculate`) additionally needs P2, because
  today's oracle can neither express a `calculate` expectation nor assert
  absence, and the editor can't provably clear a cell — all three are P2
  items. After P2 its descriptor is
  `edits: [{sheet:'survey', match:{column:'name', value:'hh_member_education_lvl'}, set:{column:'calculation', clear:true}}, …]`,
  `expect: {nodeset:'/data/f_client/hh_member_education_lvl', attrs:
  {calculate: null, relevant:'…at_school…left_school…', required:'true()'}}`
  — and the sibling `hh_member_occupation` is either a second edit in the
  same descriptor (same form — supported today) with its own expected-bind
  entry, or a second run.
- **M3/M4** get the full `--qa` red→green via P4 (compiled-settings
  byte-exact oracle + `app-settings` bucket + settings-rev corroboration),
  with the partner's `test/tasks/` / `test/contact-summary.spec.js` wired
  in as tier-2 via P5. Their dev phase remains generic LLM code-gen — the
  correct behavior for JS artifacts, not a gap.

Until the phases land, the interim manual procedure in
`maisha-demo-runbook.md` §5 stands; each landed phase deletes the
corresponding manual step from that runbook.

## 10. Execution setup — topology, roles, commit protocol (decided 2026-07-18)

Operating constraints: the AI agents **never run git/docker/gh** — every
git operation is a `[OPERATOR]` step Hareet runs from commands we supply;
implementation sub-agents run on **Opus 4.8**; Fable plans each phase and
reviews the combined diff before any commit step is handed over.

### Topology: ONE worktree (the existing checkout), phases strictly sequential

Decided via a fact-checked judge panel (single vs one-worktree-per-PR vs
hybrid); all three advocates converged on single-tree sequential. The
determining facts:

- **Hot-file contention**: `src/workflows/qa-workflow.ts`
  (`deriveVerifyOptions` + `APPLY_ACTIONS_BY_ARTIFACT` — both edited by P3
  AND P4), `src/agents/test-environment-agent.ts` (`verifyArtifact` —
  edited by P2, P3, AND P4), and `src/types/index.ts` (P2/P3/P4, adjacent
  regions) are each touched across three phase-PRs, at the same symbols.
  Parallel uncommitted trees would force a by-hand reconciliation of the
  exact functions each phase was reviewed against — the per-phase diff
  review is the thing worktrees would poison.
- **No-commit-by-agents deletes the rebase machinery**: worktree stacks pay
  off through branch/commit/rebase, all operator-only here. A second dirty
  tree has no git relationship to the first until Hareet serializes it
  manually — the "parallel" work collapses back to sequential at commit
  time, minus coherence.
- **The critical path is serial anyway**: P1+P2 → P3 → P4 by dependency,
  and P3/P4 both gate on the ONE running CHT instance for their
  integration exit criteria. Genuine parallelism exists only in the
  offline spikes and fixtures — which need a scratchpad, not a worktree.
- **Hook hazard**: the push hard-block lives in the main worktree's
  `.git/hooks/pre-push`, while linked worktrees resolve hooks via
  `core.hooksPath=.husky` — which has NO pre-push. **Any additional linked
  worktree silently bypasses the push guard.** If a worktree is ever
  added for other reasons, add a `.husky/pre-push` mirror of the block
  first.
- Cost, for the record (not decisive): extra worktrees are ~318 MB
  `node_modules` + a warm `npm ci` each (the 400 MB Chromium rev-901912
  snapshot is HOME-cached and shared); `npm test` is hermetic (ts-node, no
  `dist/` needed, no network, harness specs excluded) so per-tree gates
  would have worked — the blockers are the two structural points above.

Spikes run in the session scratchpad (never inside `demo-conf` — copy
sources out first): the **P2 pyxform empty-vs-clear experiment** (offline
convert on a throwaway workbook) and the **P4 settings-normalization
spike** (read-only curls against the running instance + an offline compile
of a demo-conf copy). Both are read-only w.r.t. the repos and can run
EARLY — the P4 spike during P1/P2 retires the plan's only real unknown
before it reaches the critical path.

### [OPERATOR] Step 0 — commit the current dirty tree (before any phase work)

The working tree carries two coherent, unrelated change sets; commit them
separately so phase diffs start clean (commitlint enforces conventional
format; pre-commit blocks direct commits to master/main only):

```bash
cd cht-agent-workbench   # on feat/mission-05-xlsform-orchestrator
# 1 — post-mission-05 hygiene sweep (comment/doc-ref scrubs + the
#     test-isolation fix in the env-agent spec; no logic changes):
git add docker/cht-agent-net.override.yml src/ test/ \
        docs/handoffs/demo-runbook.md docs/handoffs/mission-05-followup-fixes-plan.md
git commit -m "chore(mission-05): scrub stale doc refs; isolate env-agent spec instances"
# 2 — Maisha demo + planning artifacts:
git add docs/ tickets/
git commit -m "docs(maisha): demo runbook, all-artifacts pipeline plan, triage docs, M3/M4/M7/M8 tickets"
```

### [OPERATOR] Per-phase branch + commit loop (stacked PRs)

```bash
# start of phase N (branch stacks on the previous phase's branch):
git checkout -b feat/all-artifacts-p1p2-bind-oracle        # P1+P2 (from mission-05 branch)
#   later: feat/all-artifacts-p3-contact-form-qa           # from p1p2
#          feat/all-artifacts-p4-compiled-settings-oracle  # from p3
#          feat/all-artifacts-p5-tier2-testgen             # from p4
git status --short   # MUST be clean before agents start

# end of phase N (after Fable's review + green gates):
git add -A
git commit -m "<conventional message supplied with the phase handoff>"
```

PR creation (gh) is likewise operator-run, against the branch stack, when
the phases are ready to go up.

### Per-phase agent protocol (Fable orchestrates)

1. **Plan** — Fable decomposes the phase into file-disjoint work packages.
2. **Implement** — Opus 4.8 sub-agents (workflow-orchestrated) edit in
   place; packages touching the hot trio are NEVER parallelized with each
   other.
3. **Gates** — `npm run build && npm test && npm run lint` (build still
   runs even though tests don't need it — tsc catches type breaks in the
   CLI surface).
4. **Adversarial review** — a find→verify review workflow (Opus 4.8) over
   the phase diff; Fable reviews the survivors and the combined diff.
5. **Handoff** — Fable gives Hareet the commit command + conventional
   message; nothing proceeds to phase N+1 until the commit lands.
6. Integration evidence for P3/P4 (live RED→GREEN transcripts) is captured
   into the phase handoff before the commit step, since the instance is
   shared and later phases will mutate it.
