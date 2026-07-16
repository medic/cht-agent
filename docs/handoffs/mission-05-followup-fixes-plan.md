# Mission 05 follow-up fixes — first live run findings (2026-07-13)

> **STATUS: IMPLEMENTED + REVIEWED, 2026-07-13** (same day, workflow-driven;
> adversarial review confirmed one additional defect — multi-line `<bind>`
> tags defeated per-line canonicalization; fixed via logical-tag reassembly).
> Final gates: build clean, **1464 passing / 0 failing**, `eslint .` clean;
> empirical end-check: `collateralChangedLines` = `[]` on the real repro pair
> (was 78 raw-line false positives), `extractTopLevelGroupBinds` non-empty
> for the `/postnatal_care_service` root. Uncommitted in the working tree —
> operator commits.

Source: the first Mission-05 live run (echis PNC ticket) failed 3/3 dev
iterations and then degraded confusingly. Root causes were verified in source
and by host-side reproduction. **Key reversal: the agent's iteration-1 fix was
CORRECT — the pipeline rejected its own good work.** Four fixes, in priority
order. Branch: `feat/mission-05-xlsform-orchestrator` (working tree; operator
commits).

Reproduction evidence (this session, host): real echis workbook + repo-pinned
cht-conf 3.21.4 + the same exceljs single-cell edit → raw diff **78 lines**;
after canonicalizing attribute order inside tags → **exactly the one intended
bind change**. Every "collateral" line was the same attributes serialized in a
different order (`required` migrating to tag end, `relevant`/`calculate`
swapping). The exceljs re-save perturbs pyxform's attribute ordering on this
workbook; the demo fixture (P1's fidelity gate) never triggers it.

## F1 — collateral oracle must be attribute-order-insensitive (+ expect normalization)

`src/utils/xlsform-apply.ts`:
- `collateralChangedLines(baselineXml, regenXml, targetNodeset)` compares raw
  lines → false positives on pure attr-order churn. Fix: canonicalize each XML
  tag before comparison (parse attributes, sort by name, re-serialize; keep
  values byte-exact). Only then diff, and still exclude the target bind.
- Step 5a compares `afterRelevant !== descriptor.expect.relevant` byte-exact.
  The converter trims/normalizes whitespace (a leading space written to the
  cell is absent in the emitted attribute). Fix: compare after collapsing
  whitespace runs to single spaces + trim, on both sides. (XPath is
  whitespace-insensitive outside string literals; internal-double-space
  literals are an accepted edge — document it in a comment.)
- Same normalization for `describeSiblingChanges` value comparison.

Acceptance: a regression spec feeding two XMLs that differ ONLY in attribute
order (synthesize inline — permute `required`/`relevant`/`constraint`
positions) must report zero collateral; a real value change must still be
caught; the existing fidelity spec stays green.

## F2 — bind extraction must not assume the `/data` instance root

`src/utils/xform-inspect.ts:68`: `TOP_LEVEL_GROUP_RE = /^\/data\/[^/]+$/`.
Real partner forms use the form id as root (`/postnatal_care_service/…`) →
`extractTopLevelGroupBinds` returns `[]` → (a) QA's `deriveVerifyOptions`
fails ("could not derive form verification" — the exact live abort), (b) the
dev-phase sibling check silently checks nothing.

Fix: derive the instance root from the XML itself (e.g. from the first
`<bind nodeset="/<root>/…">` or the model's primary instance), then match
`/<root>/<segment>` two-segment nodesets. Keep the existing behavior for
`/data` forms byte-identical. Audit ALL `TOP_LEVEL_GROUP_RE` /
`extractTopLevelGroupBinds` consumers (`qa-workflow.ts` `deriveVerifyOptions`,
`xlsform-apply.ts` sibling snapshot, `verifyArtifact` path) — they must all
work for a non-`/data` root without further change.

Acceptance: spec with a `/postnatal_care_service`-rooted XML fixture (copy a
few real binds from `../demo-conf` — do NOT read the partner repo at test
runtime; inline the fixture) returns the top-level group binds; existing
`/data` specs unchanged.

## F3 — retry feedback must actually reach the code-gen CLI

Verified: `code-generation-agent.ts:738-756` packs `additionalContext` into a
`feedback/additional-context.md` context file and passes `failingFiles`
through — and `src/layers/code-gen/modules/claude-code-cli/{index,prompts}.ts`
reference NEITHER (live-run proof: plan/execute prompts byte-identical across
all three iterations). Each retry also runs a fresh `claude -p` (no session
resume) and rollback wipes the previous descriptor, so retries are fully blind.

Fix (minimal, no session-resume work now): when the module input carries
`failingFiles` and/or the feedback context file, append a clearly-delimited
FEEDBACK section to the plan AND execute prompts containing (a) the failure
reason text, (b) the full content of each failing file (the previous
descriptor — it is small), (c) an explicit instruction: "your previous attempt
produced the content above and failed for the stated reason; produce a
corrected version, do not repeat it verbatim". Bound the section (e.g. 8 KB)
defensively.

Acceptance: prompts spec asserting the FEEDBACK section appears (with
failing-file content) when inputs carry it and is absent otherwise; an
index-level spec that the module threads `input.failingFiles` into the prompt
builders.

## F4 — exhaustion must be a loud stop, not a segue into test generation

Verified: `resolveApplyXlsformFixEdge` (development-supervisor.ts:122-146)
routes "failed + out of iterations" to `generateTests`. Live consequence:
junk unit tests generated FOR THE DESCRIPTOR JSON, LLM validation score 90%
displayed, HC2 showed only the junk tests, approval wrote 3 junk files into
the partner repo, QA aborted.

Fix:
- On exhaustion (xlsform-apply attempted and failed, no `xlsformApply`
  result, iterations spent): route to END with a distinct state marker (e.g.
  `xlsformApplyExhausted: true` channel or a terminal error entry) — do NOT
  enter `generateTests` for cht-conf form tickets in this path.
- The preview/HC2 path (`development-workflow.ts` + `cli/full.ts`/`dev.ts`)
  must, when the marker is set: print a prominent "NO FIX PRODUCED — xlsform
  apply failed after N iterations: <last failure reason>" banner, stage
  NOTHING (or refuse approval), and make the workflow result a failure
  (non-zero exit from the CLIs).
- While there: fix the cosmetic lie "Target: /workspace/cht-core" in the
  completion banner when the target is the conf project.

Acceptance: supervisor spec — exhaustion path never reaches testGeneration
and sets the marker; workflow/CLI spec — marker → no staging, failure result.
Passthrough (cht-core tickets, no descriptor) byte-identical.

## F5 — QA red/green oracle is blind to child-bind fixes (second live run, 2026-07-13)

> **STATUS: SHIPPED + PROVEN LIVE, 2026-07-13.** Third live run closed the
> loop end-to-end: RED = 1 of 10 bind assertions failed (the target child
> bind, actual "(none)") → HC3 → applyConfig (app-forms, pinned 3.21.4) →
> GREEN = 10/10, form rev 2-acb009… → 3-b849c0…. Gates at ship time: build
> clean, 1477 passing / 0 failing, eslint clean; adversarial review PASS.

Observed: with F1–F4 shipped, the dev phase completed end-to-end (descriptor →
verified apply, 9 siblings unchanged → HC2 bind-diff → corrected `.xlsx`+`.xml`
written to the mount), but QA aborted "symptom did not reproduce" — while
`curl` proved the deployed bind still had NO `relevant` (bug live; nothing was
ever uploaded — every prior abort happened before `applyConfig`).

Root cause: `deriveVerifyOptions` (qa-workflow.ts) builds the verify
expectation set from `extractTopLevelGroupBinds` — TWO-segment group binds
only. The echis fix is a THREE-segment child bind
(`/postnatal_care_service/group_mother_pnc_danger_signs/next_pnc_visit_date`),
absent from the set; deployed-vs-local matched on all 9 group binds → no RED.
The demo fixture masked this: its planted bug IS a group-level bind
(`/data/danger_signs`).

Fix: when the development phase produced an `XlsformApplyResult`, thread its
`bindDiff` (nodeset + after-relevant) into the QA verify expectations so the
target bind itself is asserted — RED fires when the deployed bind differs
(including a missing `relevant`), GREEN when it matches post-apply. The
group-bind set stays as the sibling-invariance oracle. Fallback unchanged
when no dev result is in scope (standalone QA, cht-core tickets). Seams:
`orchestrator.ts` `runQaPhase`/`createQaInput` (dev result must reach QA),
`QaInput`/`VerifyArtifactOptions` types, `deriveVerifyOptions`,
`test-environment-agent.verifyArtifact` (a missing-`relevant` bind must count
as a MISMATCH against an expected expression, not as "bind not found").

Acceptance: spec where the corrected local form gates a child bind but the
"deployed" XML lacks it → reproduce = RED; after swapping in the corrected
XML → GREEN; existing group-level demo-fixture specs unchanged; standalone
QA (no dev result) behavior byte-identical.

## F6 — IN PROGRESS: whole-document QA oracle

**Implementation contract (added when F6+F7 were greenlit):**
- Comparator: reuse the dev phase's canonicalized comparison
  (`collateralChangedLines` — export/move it to a shared seam if needed; it
  lives in `src/utils/xlsform-apply.ts` and already handles multi-line tags
  and attr-order churn).
- ACTIVE ONLY when a dev-phase `bindDiff` is present (the Mission-05 path).
  Standalone QA / cht-core / no-dev runs: byte-identical current behavior —
  spec it.
- reproduce (RED): in addition to the existing bind assertions, fetch the
  deployed XML and compare whole-document against the corrected local
  `forms/app/<form>.xml`: the docs must differ EXACTLY at the declared
  target nodeset(s) and nowhere else. Extra diffs ⇒ abort loudly as
  ENVIRONMENT DRIFT (sample lines in the message) — escape hatch
  `QA_ALLOW_DRIFT=1` falls back to the targeted oracle with a warning.
- verify (GREEN): bind assertions PLUS whole-document canonical identity;
  any residual diff fails verify and lists the collateral lines.
- QaResult transition entries must say which oracle level passed/failed.
- Empirical end-check available in the session scratchpad: `deployed-pnc.xml`
  (buggy deployed) vs `edited.xml` (corrected conversion) differ exactly at
  the target bind under the canonical comparator.

Motivation (Hareet's question after F5): the group-bind set has no
completeness meaning — measured on the deployed postnatal_care_service:
315 binds total, **121 carry `relevant` at some depth, the oracle checks 9**
(~7%). F5 adds only the one fix-declared bind. Adjacent blind-spot classes
that would each evade the targeted oracle differently: non-`relevant`
attribute fixes (constraint/required/calculate), non-bind fixes (choices,
itext labels, settings), multi-edit descriptors (bindDiff is single-target),
deeper-than-two-segment page gates (e.g. the demo fixture's own
`/data/safe_pregnancy_practices/malaria`), contact forms, app_settings
artifacts.

Proposal: QA compares the FULL deployed XML against the corrected local XML
with the dev phase's canonicalized comparator (`collateralChangedLines`):
- reproduce (RED): deployed vs local must differ EXACTLY at the declared
  target(s) (bindDiff), nothing else — proves the bug AND env fidelity;
- verify (GREEN): canonically identical documents.
Covers every bind/body/itext line for any attribute, depth, or edit count.
Trade-off: genuine mount-vs-deployed drift turns into a loud red (desirable
for a closed loop; document a fallback to the targeted oracle with a
warning). Converter parity is already pinned via CHT_CONF_BIN. Candidate for
the next follow-up round after F5 proves out in the live loop.

## F7 — IN PROGRESS: layer-aware test generation → partner harness specs + tier-2 QA hook

Observed (third live run): for cht-conf tickets, test-gen emits generic JS
unit tests of the fix DESCRIPTOR into `tests/unit/` (plural) — the partner
repo's mocha glob is `test/**/*.spec.js` (singular), so the generated files
are dead code their suite never executes, and they test the descriptor JSON
with a hand-rolled regex evaluator rather than the form.

Proposal: for `layer: cht-conf` + `configArtifact: form`, test-gen should
emit ONE `cht-conf-test-harness` spec at `<configRoot>/test/forms/<form>.spec.js`
following the repo's own house pattern (detect from existing specs: harness
lifecycle in before/after/beforeEach, `fillForm`, `expect(harness.consoleErrors)
.to.be.empty`), using the repo-pinned harness + its `harness.defaults.json`
coreVersion. The spec asserts the ticket's behavior (here: has_delivered='no'
→ next_pnc_visit_date not prompted; ='yes' → prompted) — the durable
"fails before the fix, passes after" artifact that ships WITH the partner
repo.

**Implementation contract (added when F6+F7 were greenlit):**
- Generation (`layer: cht-conf` + `configArtifact: form` ONLY; other tickets
  byte-identical): replace the current `tests/unit/` descriptor-JS output
  entirely. Emit ONE spec at `<configRoot>/test/forms/<form>.spec.js`; if
  that path already exists, emit `<form>.agent.spec.js` beside it instead —
  never overwrite partner specs. House-pattern detection: read 1-2 existing
  specs under `test/forms/` for the harness require/lifecycle idiom; fall
  back to the canonical cht-conf-test-harness pattern when the dir is empty.
  Spec content derives its scenario from the fix descriptor/bindDiff (gate
  question, gating values), not from free-form LLM imagination.
- Tier-2 QA hook (opt-in): new `--qa-tier2` CLI flag → `QaInput.tier2`. When
  enabled and the config repo has a runnable spec for the affected form,
  AFTER the tier-1 GREEN the QA phase shells the repo-pinned mocha
  (`<configRoot>/node_modules/.bin/mocha test/forms/<form>*.spec.js`,
  cwd=configRoot, minimal env + the repo's TZ convention, generous timeout)
  and records `QaResult.tier2 { ran, passed, outputTail }`;
  `succeeded &&= tier2.passed` when the hook ran. Missing harness/spec ⇒
  tier2 = { ran: false } with an honest reason, succeeded unchanged (mirror
  the self-skip philosophy). Default OFF (full-suite regression stays an
  operator step; the hook runs only the affected form's spec).
- Runtime prerequisites already true in-container: Chromium rev-901912 baked
  for resolver ^10 (harness 3.0.15 + 5.0.4); the mounted repo's PCR
  .stats.json self-heals. Workbench unit tests for the runner must mock the
  child process; an end-to-end spec may self-skip unless a real config-repo
  path env var is provided (existing self-skip pattern).

## F8 — SHIPPED (2026-07-15): retry continuity, descriptor robustness, iteration economics

> Implemented + adversarially reviewed; review confirmed 3 issues (dead
> resume-fallback on thrown spawn errors, cross-ticket session leak, BOM
> rejection), all fixed. Final gates: build clean, **1553 passing / 1
> pending / 0 failing**, eslint clean.

Observed (fourth live run, 2026-07-15): F4's exhaustion stop fired correctly
(NO FIX PRODUCED, nothing staged), but all 3 iterations were lost to
avoidable causes: iter 1 burned by the LLM validator score (52%<75) BEFORE
the deterministic apply ever ran (the validator doesn't understand the
descriptor contract); iter 2 failed on trailing non-JSON content after the
descriptor object (recurring signature — line 25, twice across runs); iter 3
failed on `groupPath` as string instead of array. Retries are fresh
`claude -p` sessions — the captured sessionId is never used — so each retry
can invent new mistakes instead of building on its own context.

**Implementation contract:**
1. `DEV_MAX_ITERATIONS` env → supervisor `MAX_ITERATIONS` (parse int,
   clamp 1–10, default 3, log when non-default). Compose passthrough
   `DEV_MAX_ITERATIONS: ${DEV_MAX_ITERATIONS:-}` in the demo env block.
2. Session-resume retries: `cli-driver.spawnClaudeCli` gains a
   `resumeSessionId` option → argv `--resume <id>` before `-p`. The module
   records the execute-phase sessionId per generation; a retry that carries
   feedback resumes that session with a retry prompt that MUST state the
   workspace was rolled back (its file edits are gone — recreate the
   corrected file). Resume failure (nonzero exit / unknown session) falls
   back to today's fresh-session path once, with a log line. Plan phase
   stays fresh each iteration.
3. Descriptor robustness in `parseXlsformFixDescriptor` (src/utils/
   xlsform-fix.ts): (a) tolerant extraction — take the first balanced
   top-level JSON object; strip fences/trailing prose with a WARN, only
   erroring when no parseable object exists; (b) normalization before ajv —
   string `groupPath` coerced to one-element array (warn); (c) harden the
   execute prompt with an exact minimal descriptor example + "the file must
   contain ONLY the JSON object — no trailing text, no code fences;
   groupPath is an ARRAY".
4. Iteration economics: for cht-conf form tickets whose generation produced
   a descriptor, run the deterministic applyXlsformFix verdict BEFORE the
   LLM-score gate can loop the graph — a passing apply must not be sent back
   for a low LLM score (apply verdict outranks); a failing apply loops with
   the apply feedback as today. cht-core tickets byte-identical.

Acceptance: env-clamp spec; resume argv + rollback-notice + fallback specs
(mocked driver); tolerant-parse specs (trailing prose, fenced object, string
groupPath — each salvages with warn; garbage still errors); economics spec
(descriptor + low LLM score + passing apply ⇒ proceeds, no loop; failing
apply ⇒ loops); gates: build + full suite + eslint clean.

## F9 — SHIPPED (2026-07-16): sandbox-safe generated specs + tier-2 output visibility

> Implemented + adversarially reviewed; review confirmed one real emission
> bug (a two-object-literal positional ctor slipped the object-literal guard
> via the comma operator and emitted unparseable JS — fixed by validating
> with the exact emitted statement shape). Final gates: build clean,
> **1587 passing / 1 pending / 0 failing**, eslint clean.
>
> **Addendum (sixth live run):** tier-2 ran end-to-end and surfaced one
> environment gap — harness 3.x's `loadForm` runs the legacy cht-core XSL
> pipeline via the **`xsltproc`** binary, absent from the image (the
> workbench harness 5.x doesn't need it). The bind assertion passed; only
> the form-load smoke failed. Proven single-gap by running the emitted spec
> on the host (has xsltproc): 2 passing. Fix: `xsltproc` baked into the
> Dockerfile's deployment-toolchain layer with a fail-closed check.

Observed (fifth live run, 2026-07-16): the ENTIRE loop went green through
both F6 oracles on iteration 1 (the 15% LLM score correctly overruled by the
passing apply), but tier-2 failed: the generated harness spec faithfully
copied the partner's `new TestHarness()` construction, and Chromium's SUID
sandbox cannot initialize under the container's cap_drop ALL hardening
("No usable sandbox!"). Harness 3.0.15 forwards its options object to
`puppeteer.launch()` (harness.js:133), so constructor `args` ride through.
Also: the QA summary said "tier-2 FAILED — see outputTail" without printing
it — the diagnosis needed a manual rerun.

**Implementation contract:**
1. `src/utils/cht-conf-test-spec.ts` `renderSpec`: the emitted harness
   construction must merge sandbox-safe launch args AT RUNTIME —
   `new TestHarness({ ...HOUSE_OPTIONS, args: [...(HOUSE_OPTIONS.args || []),
   '--no-sandbox', '--disable-dev-shm-usage'] })` with HOUSE_OPTIONS being
   the detected partner options object (or `{}`) — concatenating (never
   clobbering) any partner-supplied args, deduping the two flags, and still
   passing the parse guard. Manual proof of the shape exists: the mount's
   generated spec was hand-patched with these args after the live failure.
2. Tier-2 visibility: when tier-2 ran, the QA result panel prints a bounded
   `outputTail` excerpt (last ~20 lines) on failure and a one-line
   "tier-2 passed (N passing)" on success; the transition entry carries the
   same instead of "see outputTail".
3. Score display honesty: when the deterministic apply verdict overrode a
   below-threshold LLM score (F8 economics), annotate the displayed
   validation score ("overridden by verified apply") so a low number does
   not read as a failed run.

Acceptance: emitted-spec specs (sandbox args present; partner args
concatenated not clobbered; dedupe; parse guard green); QA display specs
(fail → tail excerpt; pass → one-liner); score annotation spec; full gates.

## Gates (after EVERY fix, and finally)

`npm run build` && `env -u ANTHROPIC_MODEL LANGFUSE_ENABLED=false npm test`
(baseline: current suite green on this branch) && `eslint .` — never proceed
on red. No sandbox-posture changes anywhere (EXECUTE_PHASE_TOOLS untouched).

## Empirical end-check (this session)

The reproduction artifacts live at the session scratchpad:
`baseline.xml` / `edited.xml` (attr-order-churned pair whose only semantic
delta is the target bind). After F1, running the new `collateralChangedLines`
over that pair with target
`/postnatal_care_service/group_mother_pnc_danger_signs/next_pnc_visit_date`
must return `[]`. After F2, `extractTopLevelGroupBinds(edited.xml)` must
return the form's top-level group binds (non-empty).
