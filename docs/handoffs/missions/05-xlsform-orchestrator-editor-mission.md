# Mission 05 — XLSForm orchestrator-editor: fix the real source, keep the sandbox

**Status: NOT STARTED.** Branch off `integration/demo-closed-loop`. Companion
handoff (read it FIRST — it carries the verified seam map and the full risk
register): `docs/handoffs/xlsform-orchestrator-editor-handoff.md`.

## Goal

For `layer: cht-conf` + `configArtifact: form` tickets, make the development
phase fix the **`.xlsx` source of truth** — fully automated, sandbox intact —
so the QA phase's unchanged `app-forms` bucket (`convert-app-forms` +
`upload-app-forms`) becomes legitimate instead of clobbering XML-only fixes
(the trap documented in `docs/handoffs/demo-e2e-gaps-plan.md §2`).

Architecture in one line: **the code-gen CLI emits a structured fix
descriptor; a deterministic orchestrator step applies it to the `.xlsx`,
converts offline, asserts the regenerated bind, and stages both artifacts for
HC2.** The LLM never touches the binary; Bash stays disabled in code-gen; the
mount is never mutated before human approval.

Why not cht-ai-tools: researched 2026-07-13 (see gaps-plan §2). Main has no
form authoring; the PR #4 form-builder generates new forms from scratch
(openpyxl via `uv run` + PyPI at exec + Bash-on) and cannot surgically edit.
Mission-04 §A4 already ruled the surgical fix is owned by our code-gen layer.

## Non-goals

- No Bash / no new tools inside the code-gen CLI sandbox
  (`EXECUTE_PHASE_TOOLS` stays `['Read','Write','Edit','Grep','Glob']`).
- No change to the QA bucket (`app-forms` remains convert+upload).
- No xlsx *generation* (new forms) — surgical edits to existing workbooks only.
- Tasks/targets/contact-summary recovery (`reconstruct-rules`) — separate
  issue drafts, out of scope.
- The no-git snapshot fallback (gaps-plan #1(b)) is a **prerequisite**, not
  part of this mission (see Phase 0).

## The contract — fix descriptor

New file the code-gen CLI writes at the config-project root (repo-relative, so
it rides the existing git-diff capture as a utf-8 `GeneratedFile`, dodges the
zero-edit abstain machinery, appears at HC2, and keys `perFileFeedback` for
the refinement loop):

`.cht-agent/xlsform-fix.json`

```jsonc
{
  "version": 1,
  "form": "postnatal_care_service",          // forms/app/<form>.xlsx
  "edits": [{
    "sheet": "survey",
    "match": {                                 // row locator
      "column": "name",
      "value": "next_pnc_visit_date",
      "groupPath": ["pnc_visit", "..."]        // optional; disambiguates duplicate names
    },                                         //   via the begin_group/end_group stack
    "set": {
      "column": "relevant",
      "value": "${pnc_outcome} != 'miscarriage' and ..."   // XLSForm syntax
    }
  }],
  "expect": {                                  // the dev-phase oracle
    "nodeset": "/data/pnc_visit/next_pnc_visit_date",
    "relevant": "<expected compiled XPath>",   // what xls2xform should emit
    "siblingsUnchanged": true
  },
  "rationale": "one paragraph for the HC2 reviewer and the operator report"
}
```

Schema enforced with `ajv` (already a dependency). `expect` is mandatory: the
ticket frontmatter carries no oracle, so the descriptor is where the LLM
commits to a verifiable outcome (the assert compares against the *converted*
output, which is the honest ground truth — not the LLM's own XML edit).

## The flow (target state)

```
code-gen CLI (sandboxed, file tools only)
  └─ writes .cht-agent/xlsform-fix.json           (only file it produces for form fixes)
supervisor: applyXlsformFix node (NEW, deterministic)
  ├─ validate descriptor (ajv) — absent ⇒ passthrough (cht-core tickets unaffected)
  ├─ build convert sandbox: copy config project (sans node_modules/.git) to tmp
  ├─ apply edit to sandbox forms/app/<form>.xlsx   (src/utils/xlsform-editor.ts, exceljs)
  ├─ offline convert: cht-conf `convert-app-forms -- <form>` (URL-less variant, CHT_CONF_BIN)
  ├─ assert: extractBindRelevant(regenerated.xml, expect.nodeset) ≈ expect.relevant
  │          + sibling binds unchanged vs pre-edit conversion (extractTopLevelGroupBinds)
  ├─ PASS ⇒ stash corrected .xlsx + regenerated .xml via new state channel
  └─ FAIL ⇒ CrossFileIssue + perFileFeedback keyed to .cht-agent/xlsform-fix.json
            ⇒ existing refinement loop regenerates the descriptor (≤3 iterations)
writeToStaging (EXTENDED)
  └─ copies the stashed binary/derived artifacts into staging (fs.copyFile, byte-safe)
HC2 checkpoint (EXTENDED display)
  └─ bind-level diff (old vs new relevant, "N sibling binds unchanged") — the
     positional line differ is useless on regenerated XML
approval ⇒ copyToTarget writes .xlsx + .xml to the mount; descriptor is NOT
           copied to the partner repo (cleaned from staging before copy)
QA (UNCHANGED) ⇒ reproduce(RED, still-buggy deployed form) → HC3 →
           applyConfig app-forms (convert+upload — now legitimate) → verify(GREEN)
```

Dev-phase convert is **convert-ONLY, never upload** — uploading during dev
would fix the deployed form before QA's reproduce step and abort the whole QA
phase ("symptom did not reproduce", `qa-workflow.ts:207-217`).

## Phases (each ends green: `npm run build` && `npm test` && `eslint .`)

**P0 — prerequisites (verify, don't build).** The dev target must be a git
repo with ≥1 commit (claude-code-cli's snapshot/rollback,
`workspace.ts:71`) — for the demo the operator runs `git init` in the mounted
config repo; the durable no-git fallback is gaps-plan #1(b), separate work.
Verify `xls2xform-medic` and `CHT_CONF_BIN` resolve in the runtime image
(both baked/wired already). Confirm `demo/config-pnc-demo` fixtures:
`forms/app/pregnancy_home_visit.xlsx` carries the planted bug at the xlsx
level (PLANTED-BUG.md — including the shared-strings discipline).

**P1 — `src/utils/xlsform-editor.ts` (+ exceljs dependency).**
`applyXlsformEdits(xlsxPath, edits): Promise<AppliedEdit[]>` — load workbook;
locate header row → column index by header name; walk `begin_group`/
`end_group` to compute each row's group path; match rows per `edits[].match`
(name + optional groupPath; ambiguous or zero matches ⇒ typed error); set the
cell; save. **Fidelity gate (decision point):** a spec must prove that editing
one cell of `demo/config-pnc-demo/forms/app/pregnancy_home_visit.xlsx`
(a) changes only the target cell when reopened, and (b) offline-converts to
XML whose only bind delta is the target `relevant` (sibling byte-invariance
per PLANTED-BUG.md §fidelity — same cht-conf version). Respect the
shared-strings reality: the planted fixture aliases one string across
K153/K173/K205 — the edit must repoint only the target cell (exceljs handles
this on write; the spec proves it, not assumes it). If exceljs fails
fidelity, STOP and switch to the fallback (orchestrator-shelled python
openpyxl helper, same interface) before proceeding.

**P2 — descriptor contract.** `src/schemas/xlsform-fix.schema.json` + ajv
validation util + `XlsformFixDescriptor` type; prompts: layer-aware variant in
`claude-code-cli/prompts.ts` — for cht-conf **form** tickets instruct: do NOT
edit the form files; write `.cht-agent/xlsform-fix.json` (and nothing else);
declare it in the summary's files_modified. Unit tests: schema
accept/reject matrix; prompt snapshot.

**P3 — offline convert runner.** `cht-conf-runner.ts`: URL-less exec variant
(`buildExecArgs` currently hardcodes `--url`; `ChtConfExecOptions.instanceUrl`
is required — add an offline arg-builder or make the option discriminated),
reusing the existing per-form filter (`-- <form>` positional after the
separator, already supported via `options.artifact`) and `--skip-validate`
(matches the fixture's documented offline convert; NOT in `AUTONOMOUS_FLAGS`).
Convert sandbox helper: copy project (exclude `node_modules`, `.git`,
`.cht-agent`) to `os.tmpdir()`, run convert there, never against the mount.

**P4 — the `applyXlsformFix` supervisor node.** Insert into the
`DevelopmentSupervisor` graph between `validateImpl`'s END edge and
`generateTests` (see seam map §1 — the conditional edge currently remaps END
→ `generateTests`). Behavior per the flow diagram above. New state channel
(e.g. `xlsformApply: { xlsxPath, xmlPath, bindDiff } | undefined`) +
`writeToStaging`/`copyToTarget` extension to carry the artifacts (staging's
tree copy is already byte-safe raw `fs.copyFile`; the utf-8 constraint lives
in the `GeneratedFile` path, which these artifacts must bypass). Failure
surfacing: `CrossFileIssue` + `perFileFeedback` keyed to the descriptor path
(an LLM-generated file — selective regeneration matches it). Ensure the
descriptor-only run does NOT trip the zero-edit `execute-no-op` abstain (the
descriptor IS a file edit, so `captureChtCoreDiff` is non-empty — add a spec
asserting this).

**P5 — HC2 display.** For runs with `xlsformApply`, print the bind-diff
summary (target bind old→new + sibling count unchanged) alongside (or instead
of) the positional file diff for the regenerated XML. Clean the descriptor
out of staging before `copyToTarget` so `.cht-agent/` never lands in the
partner repo; persist it (plus the bind diff) into the run's report payload
instead.

**P6 — CLI wiring + QA seam check.** Both `src/cli/full.ts` AND `src/cli/dev.ts`
(dev.ts duplicates target/banner logic and always runs preview mode — the
node must work with its stub research findings). Verify `createQaInput` /
`deriveVerifyOptions` pick up the corrected `forms/app/<name>.xml` the node
wrote (it snapshots binds from disk), and that the QA bucket stays untouched.

**P7 — e2e rehearsal + report.** `npm run dev:run` (or `full` with mock QA)
against `tickets/demo-pnc-relevant.md` + `demo/config-pnc-demo` (planted xlsx
bug): descriptor emitted → apply → offline convert → assert green → HC2 shows
bind diff → approval writes corrected `.xlsx` + `.xml`. Then the tier-1 QA
content check red→green per the runbook (live tiers operator-verified).
Convert-dependent specs must self-skip when `xls2xform-medic` is absent
(mirror the tier-2 harness self-skip pattern) so the default gate suite stays
green on Chromium-less/pyxform-less hosts. Write the mission report
(`docs/handoffs/missions/05-...-report.md`, mission-04 format: gates table,
commit-per-gap, design-decisions section, deviations).

## Acceptance gates

1. `npm run build` clean; `env -u ANTHROPIC_MODEL LANGFUSE_ENABLED=false npm
   test` — all passing (baseline 1351/1352 per mission-04; every phase adds
   specs); `eslint .` clean.
2. The P1 fidelity spec passes against the real planted fixture (or the
   openpyxl fallback decision is documented in the report).
3. A cht-core ticket run is byte-identical in behavior (descriptor absent ⇒
   passthrough; prove with a spec).
4. The P7 rehearsal transcript is captured in the mission report, red→green.
5. Sandbox posture unchanged: `EXECUTE_PHASE_TOOLS` untouched, no new
   in-sandbox binaries, descriptor never written to the partner repo.

## Kickoff prompt (paste into the workbench container session)

> You are implementing Mission 05 of the cht-agent-workbench. Read, in order:
> `docs/handoffs/missions/05-xlsform-orchestrator-editor-mission.md` (the
> mission — your scope, phases, and acceptance gates),
> `docs/handoffs/xlsform-orchestrator-editor-handoff.md` (the verified seam
> map with file:line references and the risk register — every design
> constraint in it is load-bearing; do not re-derive seams from scratch, but
> verify each cited line before depending on it), and
> `docs/handoffs/demo-e2e-gaps-plan.md` §2 (the decision record). Then
> implement the phases IN ORDER, P0 through P7. Rules: work on a branch off
> `integration/demo-closed-loop`; one commit per phase minimum, conventional
> style `feat(mission-05): …`; after every phase run `npm run build`,
> `env -u ANTHROPIC_MODEL LANGFUSE_ENABLED=false npm test`, and `eslint .` —
> never proceed on red; never weaken the code-gen sandbox (no Bash, no new
> tools in EXECUTE_PHASE_TOOLS); never mutate the mounted config repo outside
> the staging/approval contract; the P1 fidelity spec is a decision gate —
> if exceljs cannot round-trip the planted fixture with only the target cell
> changed, stop and implement the documented openpyxl fallback instead. The
> demo fixture `demo/config-pnc-demo` (PLANTED-BUG.md) is your ground truth
> for P1/P7. Do not push; leave the branch local for review. Finish by
> writing the mission report in the mission-04 format and updating
> `docs/handoffs/demo-e2e-gaps-plan.md` §2 to mark option (c) implemented.
