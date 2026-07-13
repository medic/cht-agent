# Mission 05 — XLSForm orchestrator-editor: fix the real source, keep the sandbox

**Completed 2026-07-13.** Single session on a branch off
`integration/demo-closed-loop`: **`feat/mission-05-xlsform-orchestrator`**
(local only — not pushed, left for review). This report + the gaps-plan §2
update commit on top of the phase commits, so the true tip is the current
`HEAD` of that branch at read time.

Gates (verified at the final commit): `npm run build` clean, **1430 passing /
0 failing** (`env -u ANTHROPIC_MODEL LANGFUSE_ENABLED=false npm test`),
`eslint .` clean. Baseline was **1354** (integration tip `c75e4a0`) → **+76
tests** (P0–P7 plus the post-implementation review fixes below). Convert-dependent and Enketo tiers self-skip when their toolchain is
absent, so the default gate suite stays green on cht/pyxform/Chromium-less
hosts (here cht 6.5.0 is present, so every convert-dependent spec ran).

The goal is met: for a `layer: cht-conf` + `configArtifact: form` ticket the
development phase now fixes the **`.xlsx` source of truth**, fully automated,
sandbox intact. The QA phase's unchanged `app-forms` bucket (`convert-app-forms`
+ `upload-app-forms`) is therefore legitimate — it regenerates from a workbook
that already carries the fix instead of clobbering an XML-only edit (the trap in
`demo-e2e-gaps-plan.md §2`, now option **(c) implemented**).

Architecture as shipped: the sandboxed code-gen CLI emits only
`.cht-agent/xlsform-fix.json`; a deterministic supervisor node applies it to a
temp copy of the `.xlsx`, converts offline, asserts the regenerated bind against
the descriptor's `expect` oracle, and stages both artifacts for HC2. The LLM
never touches the binary; `EXECUTE_PHASE_TOOLS` is unchanged; the mount is
mutated only via the staging→HC2→copyToTarget contract.

---

## Phases (commit per phase, each ends green)

| Commit | Phase | What landed |
|---|---|---|
| `270980d` | **P0** | Track the mission inputs (mission, seam-map handoff, gaps-plan). Prerequisites verified during scouting (no code): cht 6.5.0 resolves and `CHT_CONF_BIN` unset → `cht`; offline convert works and round-trips the planted `pregnancy_home_visit.xlsx` to the shipped XML **byte-for-byte**; planted bug present (xlsx `survey!K153`→string idx 860; siblings K173/K205→360; XML line 1167; `uniqueCount` 861). |
| `6692caf` | **P1** | `src/utils/xlsform-editor.ts` `applyXlsformEdits` (exceljs) — header→column map, `begin/end group\|repeat` stack for group-path matching, `end`-marker rows excluded, typed `XlsformEditError`. Adds `exceljs ^4.4.0`. **Fidelity gate PASSED** (see below). |
| `e20af2c` | **P2** | `src/schemas/xlsform-fix.schema.json` (ajv) + `src/utils/xlsform-fix.ts` (`XlsformFixDescriptor`, validate/parse, `isXlsformFixTicket`) + layer-aware plan/execute prompts (`lib/prompts.ts`, `claude-code-cli/prompts.ts`) that steer a cht-conf form ticket to write the descriptor and nothing else. |
| `3a97494` | **P3** | `cht-conf-runner.ts` URL-less variant: `buildExecArgs` emits `--url` only when `instanceUrl` is set and adds `--skip-validate`; `runOfflineConvert` (convert-only, never upload) + `createConvertSandbox` (temp copy sans `node_modules/.git/.cht-agent`). |
| `4165abf` | **P4** | `src/utils/xlsform-apply.ts` (`applyXlsformFixToProject`: sandbox → baseline convert → apply → convert → assert bind + sibling invariance) + `applyXlsformFixNode` in the supervisor graph (between a passing `validateImpl` and `generateTests`), new `xlsformApply` channel, byte-safe `stageArtifact` + writeToStaging/writeToChtCore extension, FAIL → `CrossFileIssue` + `perFileFeedback` keyed to the descriptor. |
| `0e71dac` | **P5** | HC2 bind-level diff banner (`renderXlsformBindDiffBanner`); `.cht-agent` stripped from staging before `copyToTarget` so the descriptor never reaches the partner repo; bind fix echoed into the completion summary. |
| `ec49562` | **P6** | CLI wiring **verified** (both entrypoints reach the node via the same `executeDevelopmentWorkflow`; no new wiring needed) + QA-seam specs: bucket unchanged, node→verify loop closure, dev.ts stub-independence. |
| _(this)_ | **P7** | Graph-integration test (`develop()` routes a descriptor-only run through `applyXlsformFix`); e2e rehearsal transcript (below); this report; `demo-e2e-gaps-plan.md §2` marked option (c) implemented. |

---

## P1 fidelity decision (acceptance gate 2)

**exceljs PASSES; the openpyxl fallback is NOT needed.** Proven against the real
planted `demo/config-pnc-demo/forms/app/pregnancy_home_visit.xlsx` at cht 6.5.0:

- **Reopen:** editing `survey!K153` changes ONLY K153 (no cell dropped/added);
  the shared-string siblings K173/K205 — which aliased string index 360 — keep
  the yes-only gate. exceljs manages the shared-strings table on write, so
  repointing the target cell never mutates a string other cells alias (R13).
- **Convert oracle:** converting the exceljs-rewritten workbook offline (same
  cht version) differs from the pre-edit conversion by **exactly one XML line**
  — the `/data/danger_signs` bind (planted→corrected). Every sibling bind is
  byte-invariant. The baseline is a same-version convert so R11 version churn
  cancels and the spec is drift-robust.

`test/utils/xlsform-editor.spec.ts` carries both halves; the convert half
self-skips when cht is absent.

## P7 e2e rehearsal (acceptance gate 4)

Deterministic loop driven against an **isolated, git-init'd copy** of
`demo/config-pnc-demo` (never the repo fixture — R9), using the real Mission-05
functions from `dist/`. The LLM descriptor-emission and live instance
upload/Enketo tiers are operator-verified (per the mission); this rehearsal
proves the deterministic pipeline the mission owns. Transcript:

```
============  MISSION 05 — e2e REHEARSAL (deterministic loop)  ============
isolated mount (git-init'd, stands in for CHT_CONF_PATH): /tmp/m05-rehearsal-mount-…
✔ mount is a git repo with 1 commit (workspace snapshot/rollback prerequisite, P0/R9)
STEP 1 — RED: the deployed form carries the planted bug
  /data/danger_signs relevant = selected(../pregnancy_summary/visit_option, 'yes') or selected(../pregnancy_summary/visit_option, 'miscarriage')
  symptom present (shows danger_signs after miscarriage): true
STEP 2 — descriptor the code-gen CLI would emit at .cht-agent/xlsform-fix.json
  schema valid (ajv): true
STEP 3 — deterministic apply -> offline convert -> assert (the new dev-phase node)
  applied edit: survey!K153 (danger_signs)
  convert+assert GREEN: bind /data/danger_signs now "selected(../pregnancy_summary/visit_option, 'yes')"
STEP 4 — HC2 checkpoint (bind-level diff shown to the reviewer)
  🔧 XLSFORM FIX — verified against the OFFLINE conversion
  bind:   /data/danger_signs
    before: …'yes') or selected(…'miscarriage')
    after:  selected(../pregnancy_summary/visit_option, 'yes')
  9 sibling top-level group bind(s) unchanged.
STEP 5 — approval: write corrected .xlsx + .xml to the mount; descriptor NOT copied
  .cht-agent present in mount: false  (must be false)
  .xlsx SOURCE OF TRUTH now corrected — survey!K153 = "selected(../pregnancy_summary/visit_option, 'yes')"
STEP 6 — QA tier-1 content check (the unchanged app-forms bucket is now legitimate)
  RED  (planted deployed form)  matched expectation? false
  GREEN (corrected mount form)  matches expectation? true
STEP 7 — surgical: only the two form artifacts changed in the mount
  M forms/app/pregnancy_home_visit.xlsx
  M forms/app/pregnancy_home_visit.xml
REHEARSAL RESULT: ✅ PASS — red(planted) -> green(corrected), source-of-truth fixed, sandbox intact
```

The committed, reproducible equivalents run under `npm test` (self-skipping):
`applyXlsformFixToProject` PASS + 3 failure modes; `applyXlsformFixNode` PASS;
`develop()` graph-integration; and the QA loop-closure spec.

---

## Acceptance gates

1. ✅ `npm run build` clean; `npm test` **1424 passing / 0 failing**; `eslint .`
   clean. Baseline 1354 → +70 (every phase added specs).
2. ✅ P1 fidelity spec passes against the real planted fixture — exceljs, no
   openpyxl fallback (decision documented above).
3. ✅ cht-core ticket behaviour is byte-identical: descriptor absent ⇒ the node
   passthrough returns `{}`, prompts branch only on `isXlsformFixTicket`. Proved
   by passthrough specs (node + prompt) and the unchanged existing supervisor
   suite.
4. ✅ P7 rehearsal transcript captured above, red→green.
5. ✅ Sandbox posture unchanged: `EXECUTE_PHASE_TOOLS` still
   `['Read','Write','Edit','Grep','Glob']`, no new in-sandbox binary (exceljs
   and cht run orchestrator-side only), the descriptor never lands in the
   partner repo (stripped from staging before copy; excluded from the direct
   write path).

## Design decisions worth noting

- **The descriptor is the contract AND the oracle.** `expect { nodeset,
  relevant, siblingsUnchanged }` is asserted against the *converted* XML (the
  honest ground truth), not the LLM's own edit. The ticket carries no
  machine-readable expectation, so the descriptor is where the fix commits to a
  verifiable outcome.
- **Same-version baseline convert.** Sibling invariance is checked against a
  fresh convert of the *unedited* workbook with the same `cht`, so cht-version
  cosmetic churn cancels (R11) and only the intended bind delta remains.
- **Two loops share one budget.** `applyXlsformFix` FAIL loops back to
  `generateCode` (regenerate the descriptor) via `resolveApplyXlsformFixEdge`,
  bounded by the same `iterationCount` (`MAX_ITERATIONS = 3`) as the validation
  loop — so total dev iterations stay ≤ 3 across both.
- **Binary bypasses the `GeneratedFile` pipeline.** The corrected `.xlsx`/`.xml`
  are byte-copied (`fs.copyFile` via `stageArtifact`) into staging/target; only
  the utf-8 descriptor rides the `GeneratedFile` capture (R1/R2). A descriptor
  is a real file edit, so a descriptor-only run never trips the zero-edit
  `execute-no-op` abstain (R3; workspace capture spec added).

## Deviations from the mission

- **P6 is verification-only (no production code change).** The node lives inside
  the supervisor graph, which both CLIs already reach through
  `executeDevelopmentWorkflow` (full.ts via the orchestrator, dev.ts directly),
  and that function already rewrites `options.chtCorePath` to the mount for
  cht-conf. So "wire both CLIs" was satisfied by construction; P6 landed the
  confirming specs instead. Verified by reading `orchestrator.ts:119`,
  `development-workflow.ts:297-300`, `dev.ts:203-229`.
- **`xls2xform-medic` self-skip generalized to `canOfflineConvert()`.** At cht
  6.5.0 the bundled pyxform is used and `xls2xform-medic` is not on PATH, yet
  convert works. The self-skip therefore probes the `cht` binary's convert
  capability (via `--version`) rather than `xls2xform-medic` specifically — the
  correct signal for whether an offline convert can run here.
- **P7 rehearsal is the deterministic loop, not a live `npm run dev:run`.** The
  live LLM descriptor-emission and instance upload are non-deterministic and
  operator-verified (mission wording: "live tiers operator-verified"); the
  rehearsal drives the real deterministic functions the mission adds.

## Post-implementation adversarial review (fixed)

A multi-agent adversarial review of the full diff (correctness + sandbox
posture, each finding independently verified) confirmed 3 defects, all fixed in
`7dc2589` with regression tests:

- **HIGH — descriptor leak on the direct-write path.** `writeToChtCore`
  (non-preview) dropped `.cht-agent/xlsform-fix.json` only when `xlsformApply`
  was set, so a *failed* apply (descriptor still in `codeGeneration.files`,
  `xlsformApply` undefined) wrote it into the partner repo — breaking the
  inviolable invariant (gate 5). Now drops anything under `.cht-agent/`
  unconditionally, matching the preview path.
- **MEDIUM — collateral-damage false GREEN.** The sibling oracle compared only
  top-level `/data/<segment>` binds, so a multi-edit descriptor corrupting a
  child/nested bind passed. Added `collateralChangedLines` — a byte/line-level
  check (valid because same-version convert is deterministic) that flags ANY
  non-target differing line.
- **LOW — misleading `siblingsUnchanged` count.** Reported a positive count
  even when the check was disabled (`expect.siblingsUnchanged:false`); now 0.

## Follow-ups discovered

- **Descriptor-path gitignore.** The design relies on `.cht-agent/xlsform-fix.json`
  being an untracked-but-not-ignored file so it rides `captureChtCoreDiff`
  (R2/R3). The demo config has no `.gitignore`; a partner repo that ignores
  `.cht-agent/` would silently drop the descriptor and trip `execute-no-op`. If
  that surfaces, either write the descriptor outside `.cht-agent/` or force-add
  it in the snapshot. (Noted, not fixed — out of scope.)
- **Multi-edit / `${...}` expressions.** The editor and descriptor support
  multiple edits and any `set.value`; the demo fix is single-cell with an
  expression that passes through xls2xform unchanged. A fix whose XLSForm `${x}`
  compiles to a different XPath must set `expect.relevant` to the *compiled*
  form — the assert compares against the converted output, so the descriptor
  author (the LLM) must predict it. Covered by the contract; unexercised by the
  demo.
- **Convert sandbox is left for the OS to reap on the success path** (its
  `.xlsx`/`.xml` are the staged artifacts; kept alive until copy). One temp dir
  per applied fix — acceptable (matches the existing staging-dir behaviour).
