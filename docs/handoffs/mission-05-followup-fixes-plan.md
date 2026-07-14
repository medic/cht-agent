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

## F6 — PROPOSED (not built): whole-document QA oracle

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
