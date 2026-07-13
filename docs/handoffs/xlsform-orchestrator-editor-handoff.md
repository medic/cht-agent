# Handoff — Mission 05: XLSForm orchestrator-editor

Companion to `docs/handoffs/missions/05-xlsform-orchestrator-editor-mission.md`
(scope, phases, acceptance gates, kickoff prompt live THERE; this document
carries the context, the risk register, and the verified seam map). Produced
2026-07-13 from a three-way investigation (prior-session memory archaeology,
medic/cht-ai-tools main + PR #4 review, two seam-mapping readers) whose maps
were adversarially re-verified line-by-line against the source.

## Lineage — how we got here

1. First live e2e run (echis PNC ticket, 2026-07-13) exposed the **XLSX trap**:
   QA's `app-forms` bucket is `convert-app-forms` → `upload-app-forms`, so an
   XML-only fix is regenerated-over (clobbered) from the buggy `.xlsx` before
   upload. Full findings: `docs/handoffs/demo-e2e-gaps-plan.md`.
2. cht-ai-tools was evaluated as the fix engine and **rejected** (gaps-plan
   §2): main ships no form authoring; PR #4's form-builder generates new
   forms from scratch (openpyxl via `uv run`, PyPI at exec, needs Bash-on in
   the sandbox) and cannot surgically edit. Mission-04 §A4 had already drawn
   the boundary: cht-ai-tools is additive; the surgical fix is ours.
3. Prior-session memory (../cht-agent project): the `.xlsx` is unrecoverable
   from a live deployment (`config-type.ts` reasons about exactly this) —
   xlsx-source fixing applies to full-source handovers; reconstructed-backup
   deployments stay on the `app-settings-only`/xml paths.

## Settled design decisions (do not relitigate)

- **The LLM never touches the `.xlsx`.** Binary edits are deterministic,
  orchestrator-side, via a first-party Node utility. (Also structurally
  forced: `GeneratedFile.content` is utf-8; staging/capture would mangle
  binary — see R1.)
- **The descriptor is the contract AND the oracle.** The code-gen CLI's whole
  output for a cht-conf form fix is `.cht-agent/xlsform-fix.json` (schema in
  the mission doc). Its `expect` block is what the dev-phase assert verifies
  against the *converted* XML — the ticket frontmatter carries no
  machine-readable expectation (verified: `technical_context` has no
  mechanism/expression fields).
- **Dev phase converts offline and never uploads.** Upload stays exclusively
  in QA so reproduce(RED) still sees the buggy deployed form.
- **Sandbox posture is inviolate.** `EXECUTE_PHASE_TOOLS` stays
  `['Read','Write','Edit','Grep','Glob']`; no new binaries reachable from the
  CLI; the mount is mutated only via the staging→HC2→copyToTarget contract.
- **exceljs first, openpyxl fallback.** P1's fidelity spec against the
  planted fixture is the decision gate; the fallback keeps the same TS
  interface and is orchestrator-shelled (never CLI-reachable).

## Risk register (each verified against source; mitigations map to phases)

| # | Risk (verified) | Mitigation |
|---|---|---|
| R1 | Binary `.xlsx` cannot ride the `GeneratedFile` pipeline: content is utf-8 string (`types:1081-1089`); `writeToStaging`/`writeToChtCore` write utf-8 (`staging.ts:165,189`); `captureChtCoreDiff` reads utf-8 + `git show` (`workspace.ts:185,194`) | Artifacts bypass `GeneratedFile`: new state channel + `writeToStaging` extension; approval-time `copyToTarget` is already a raw recursive `fs.copyFile` (byte-safe, `staging.ts:199-230`) (P4) |
| R2 | No module→supervisor channel for a descriptor (`CodeGenModuleOutput`, `interface.ts:56-85`; state channels `development-supervisor.ts:143-208`) | Descriptor is a normal repo file → captured by git-diff as a utf-8 `GeneratedFile`; supervisor parses it out of `state.codeGeneration.files` (P2/P4) |
| R3 | Zero-edit abstain machinery: no file edits ⇒ relaxed retry ⇒ `execute-no-op` ⇒ `resolveValidateImplEdge` ends the graph early (`index.ts:166-201,265-288`; `development-supervisor.ts:90-93`) | Descriptor file IS an edit, so capture is non-empty; add a spec asserting a descriptor-only run does not trip `execute-no-op` (P4) |
| R4 | Running convert against the mount mutates it pre-approval; module-phase rollback `git reset --hard` + `git clean -fd` would wipe it (`workspace.ts:227-263`) | Convert sandbox: temp copy of the project (sans `node_modules`/`.git`/`.cht-agent`); mount untouched until copyToTarget (P3) |
| R5 | `buildExecArgs` hardcodes `--url` and `ChtConfExecOptions.instanceUrl` is required (`cht-conf-runner.ts:103-109`; `types:786-807`) — but the binary supports URL-less convert (proven: PLANTED-BUG.md:95-101) | Offline arg-builder variant + `--skip-validate` (absent from `AUTONOMOUS_FLAGS`, `cht-conf-runner.ts:52-60`); reuse the existing `-- <form>` filter (`FORM_BUCKETS`/`options.artifact`, 74/103-125/212-249) (P3) |
| R6 | Reusing the `app-forms` bucket in dev would upload → QA reproduce PASSES → `executeQaWorkflow` aborts ("symptom did not reproduce", `qa-workflow.ts:207-217`) | Dev step is convert-ONLY; spec asserts no upload verb ever runs in the dev phase (P4) |
| R7 | No dev-time oracle in the ticket (`ticket-parser.ts:224-228`; `types:63-76`); QA's `deriveVerifyOptions` snapshots the corrected local `.xml` — circular for a dev assert | `descriptor.expect { nodeset, relevant, siblingsUnchanged }` is the oracle; assert on the CONVERTED output via `extractBindRelevant` + `extractTopLevelGroupBinds` (pure utils, `xform-inspect.ts:53-90`) (P2/P4) |
| R8 | Assert-failure feedback keying: `perFileFeedback.filePath` must equal a generated file's `relativePath` or selective regen falls back to generic full regeneration (`development-supervisor.ts:333-351`) | Key feedback to `.cht-agent/xlsform-fix.json` — an LLM-generated file, so the refinement loop targets the descriptor (P4) |
| R9 | For cht-conf tickets the CLI's git snapshot/rollback runs against the MOUNT (`development-workflow.ts:297-300` rewrites chtCorePath; `workspace.ts:71` throws on non-git; rollback `git clean -fd` deletes untracked files) | P0 prerequisite: mount is a git repo with ≥1 commit (operator `git init`); durable no-git fallback is gaps-plan #1(b), separate work |
| R10 | HC2 diff noise: staging's differ is naive positional line comparison (`staging.ts:92-133`), 50-line truncation (316-317) — a regenerated XML shows as a whole-file change; the human can't see the one-bind fix | Bind-level diff display for `xlsformApply` runs (old→new target relevant + "N sibling binds unchanged") (P5) |
| R11 | Convert may churn beyond the target bind; byte-fidelity only holds when the SAME cht-conf version converts (PLANTED-BUG.md fidelity notes; demo fixture proven with 6.5.0) | Pin via `CHT_CONF_BIN` (`resolveChtConfBin`, `cht-conf-runner.ts:71`); assert tolerates benign churn but requires sibling-bind invariance; fidelity spec pins the version it proves (P1/P3) |
| R12 | CLI wiring is duplicated: `full.ts` (117-121, 149-152) AND `dev.ts` (203-222, always previewMode, stub research findings) | P6 wires both; node must work with dev.ts's stub findings |
| R13 | New production dependency (no xlsx lib exists today) + shared-strings aliasing: the planted fixture shares one string across `survey!K153/K173/K205` — a careless write that mutates the shared string corrupts sibling cells | P1 fidelity spec proves only-the-target-cell semantics on the real fixture before anything builds on the editor |

Additional environment facts the implementer inherits (already true in the
runtime image / compose):
- `xls2xform-medic` (medic pyxform fork) is baked into `docker/Dockerfile`
  (pip, tarball URL) — required by cht-conf ≤3.x convert; the image's global
  cht-conf ≥4 bundles its own zipapp.
- `NODE_OPTIONS=--openssl-legacy-provider` rides compose env (webpack-4
  `compile-app-settings` under Node 22) — irrelevant to convert but present.
- Chromium rev-901912 is baked for `cht-conf-test-harness` (tier-2 oracle,
  `npm run test:harness`) — available for an optional Enketo-level check of
  the corrected form, same as the runbook's step 6b.

## Verification recipes

- **Editor fidelity (P1):** edit `danger_signs` `relevant` in a temp copy of
  `demo/config-pnc-demo/forms/app/pregnancy_home_visit.xlsx` → offline
  convert (PLANTED-BUG.md:95-101 command shape) → `extractBindRelevant` on
  the output equals the corrected gate; `extractTopLevelGroupBinds` shows all
  sibling binds unchanged; reopening the workbook shows K173/K205 untouched.
- **Abstain regression (P4):** module run whose only edit is the descriptor →
  `captureChtCoreDiff` non-empty, no `execute-no-op` CrossFileIssue.
- **Passthrough (gate 3):** cht-core ticket (no descriptor) → node is a
  no-op; existing supervisor specs stay green.
- **Full rehearsal (P7):** `tickets/demo-pnc-relevant.md` +
  `demo/config-pnc-demo` end-to-end in preview mode; HC2 shows the bind diff;
  approval writes corrected `.xlsx` + `.xml`; QA tier-1 red→green per the
  runbook.

---

# Verified seam map (adversarially re-checked, line-by-line)

All paths relative to the workbench repo root. Every line number below was
verified by opening the file at review time (2026-07-13, branch
`integration/demo-closed-loop`) — re-verify before depending on exact lines
if the branch has moved.

## 1. Pipeline spine (dev flow)

| Seam | Location | Verified facts |
|---|---|---|
| CLI entry (full) | `src/cli/full.ts` | `parseTicketFile` → `resolveCliDevelopmentTarget(ticket)` (117-121: layer==='cht-conf' → `resolveDevelopmentTarget('cht-conf')`, else undefined); banner `🎯 layer: cht-conf → development target: <repoPath> (<toolchain>)` at 147; `developmentOptions = { ...baseOptions, developmentTarget }` 149-152; `parseQaOptions()` 99-108 (`--qa`, `--qa-auto`/`--qa-yes`, `TEST_ENV_MOCK_DOCKER`, `CHT_TEST_DATA_PATH`; never sets `provision`); calls orchestrator `executeFullWorkflow(researchSupervisor, developmentSupervisor, ticket, developmentOptions, qaOptions)` 159-165. |
| CLI entry (dev-only) | `src/cli/dev.ts:180-232` | Duplicates target resolution + banner (203-209); synthesizes research stubs (no LLM) 192-195; **always `previewMode: true`** (219); calls `executeDevelopmentWorkflow` directly (226-229). Any CLI-level wiring must be added in BOTH CLIs. |
| Orchestrator | `src/workflows/orchestrator.ts` | `executeFullWorkflow` 86-137 (Research → HC1 → Development → HC2 → QA-if-approved). `QaOptions` 52-59 `{ enabled; agent?; useMockDocker?; testDataPath?; autoApprove?; provision? }`. `runQaPhase` 144-175: gates on `qaOptions?.enabled` then `ticket.issue.technical_context.layer !== 'cht-conf'` skip; `createQaInput({ issue, configPath: developmentOptions.developmentTarget?.repoPath, provision, testDataPath, autoApprove })` 158-164. **Do not confuse** with the 4-arg `executeFullWorkflow` in `development-workflow.ts:420-447` (Research-result → Dev only). |
| Write-target routing | `src/workflows/development-workflow.ts` | `resolveWriteTarget(input): DevelopmentTarget` 266-274 (precedence: options.developmentTarget → layer cht-conf → `{ repoPath: chtCorePath, toolchain: 'cht-core' }`). `executeDevelopmentWorkflow` 279-329: **rewrites `runInput.options.chtCorePath = targetPath`** for cht-conf (297-300) so inside the supervisor `state.options.chtCorePath` IS the deployment config root. `MAX_DEVELOPMENT_ITERATIONS = 3` (line 38) — the HC2 feedback loop, distinct from the supervisor-internal loop. |
| Target gate | `src/utils/dev-target.ts:22-46` | `resolveDevelopmentTarget(layer?: CHTLayer): DevelopmentTarget` — throws on `'investigate'` (23-27) and on cht-conf with no real mount (`resolveDeploymentConfigRoot()` undefined, 29-39). `DevelopmentTarget { repoPath: string; toolchain: 'cht-conf'|'cht-core' }` (`src/types/index.ts:1035-1039`). |
| Config root | `src/utils/canonical-diff.ts` | `resolveDeploymentConfigRoot(): string|undefined` 43-49 — `CHT_CONF_PATH` unless placeholder marker `.cht-conf-placeholder` exists (`isPlaceholderRoot` 36-37). `artifactCandidatePaths('form', name)` 71-78 → `forms/app/<name>.xlsx`, `.xml`, `.properties.json` (probe order: xlsx first). `.xlsx` is in `BINARY_EXTENSIONS` (line 26). |

## 2. Development supervisor graph — where the new node hooks

`src/supervisors/development-supervisor.ts`:
- Constants: `MAX_ITERATIONS = 3`, `REFINEMENT_THRESHOLD = 75` (47-48).
- `buildGraph()` 235-262: `StateGraph(DevelopmentStateAnnotation)`; START→`generateCode`→`validateImpl`; `addConditionalEdges('validateImpl', resolveValidateImplEdge, { generateCode: 'generateCode', [END]: 'generateTests' })`; `generateTests`→END. New deterministic node inserts here.
- `resolveValidateImplEdge(state: ValidateImplEdgeState): 'generateCode' | '__end__'` 79-104 (pure, exported). `belowBar = score < 75 || crossFileIssues.length > 0`; loops while `iterations < 3`; **early-ends on shutdown or any `issueType === 'execute-no-op'`** (90-93). `ValidateImplEdgeState` 64-68 (narrow: validationResult?.overallScore, iterationCount, codeGeneration?.crossFileIssues).
- `codeGenerationNode` 267-325; guard 279-286 needs issue+orchestrationPlan+researchFindings+contextAnalysis+options ("Missing required data" at 281). Selective regen: `buildSelectiveRegenInput` 333-351 (keys `perFileFeedback.filePath === file.relativePath`).
- `validationNode` 356-374; guard needs issue+codeGeneration ("Missing required data" at 366). **Three exits**: empty-files skip → `skipValidationForEmptyFiles` 376-387 (heuristic result, `currentPhase: 'complete'`, no LLM); success → `buildValidationStateUpdate` 418-444 (writes validationResult + validationFeedback + perFileFeedback, `currentPhase: 'test-generation'`); throw → catch 401-408 writes only `errors` (validationResult stays undefined → edge reads score 0 → loops).
- `validateImplementation` 606-680: LLM `invokeForJSON<ImplementationValidation>` with diff-based code section; catch → `heuristicValidation` 771-787. **No form conversion or bind assertion anywhere in the dev graph.**
- `testGenerationNode` 458-488: terminal, non-fatal, owns printSummary.
- State channels: `DevelopmentStateAnnotation` 143-208 (messages, issue, orchestrationPlan, researchFindings, contextAnalysis, codeContextFindings, options, codeGeneration, validationResult, testGeneration, currentPhase, errors [append reducer], iterationCount, validationFeedback, perFileFeedback). A new channel = new Annotation entry + `DevelopmentState` (`types:1235-1256`).
- `writeToStaging(state)` 892-912 / `writeToChtCore(state, chtCorePath)` 917-932: both collect `codeGeneration.files` **plus `testGeneration.files`**, delegate to staging utils.

## 3. Types (exact shapes)

`src/types/index.ts`:
- `IssueTemplate.issue.technical_context` 63-76: `{ domain; components; existing_references?; layer?: CHTLayer; configArtifact?: ConfigArtifact; artifactName?: string; chtConfVersion?: string; deploymentRef?: string }`. **No mechanism, no expected expression** — `mechanism` lives only on `ResolvedIssueContext` (line 246). Parser sets config fields spread-conditionally (`src/utils/ticket-parser.ts:211-212, 224-228`); `parseTicketFile` 184-239.
- `DevelopmentOptions` 1044-1056 `{ chtCorePath: string; previewMode: boolean; stagingPath?: string; developmentTarget?: DevelopmentTarget }`.
- `GeneratedFile` 1081-1089 `{ relativePath: string; content: string; language: FileLanguage; type: FileType; description: string; action: 'create'|'modify'; originalContent?: string }` — full content, utf-8 strings, no diffs, no binary. `FileLanguage` 1061-1071 has **no xlsx**. `FileType` 1076: `'source'|'test'|'config'|'documentation'|'fixture'`.
- `CodeGenerationResult` 1140-1153 (files, summary, implementedRequirements, pendingRequirements, notes, confidence, beadsSessionId?, crossFileIssues?, compileGateSkipped?, compileGateSkipReason?). `CrossFileIssue` 1122-1135 (filePath + optional issueType/description/reason; known issueTypes include 'compile-error', 'partial-completion', 'plan-adherence-missing', 'plan-adherence-extra', 'plan-discovered-missing', plus 'execute-no-op' emitted by the CLI module).
- `ImplementationValidation` 1213-1220 (requirementsMet, acceptanceCriteriaPassed, overallScore 0-100, recommendations, feedbackForCodeGen?, perFileFeedback?: FileValidationFeedback[] 1204-1208).
- `DevelopmentState` 1235-1256, `DevelopmentInput` 1261-1270, `DevelopmentPhase` 1225-1230.
- QA/cht-conf types: `ConfigUploadAction` 592-597 ('app-settings'|'app-settings-only'|'app-forms'|'contact-forms'|'resources'); `ApplyConfigOptions` 605-618 (**`artifact?: string` single-form filter at 617**); `ConfigActionStatus` 626 ('uploaded'|'skipped'|'failed'); `ConfigApplyResult` 643-652; `FormBindExpectation { nodeset; relevant }` 662-667; `FormBindCheck` 670-677; `VerifyArtifactType = 'form'` 680; `VerifyArtifactOptions` 687-693; `VerifyArtifactResult` 696-702; `QaInput` 715-729; `QaResult` 736-760; `ChtConfRunOptions` 767-779; `ChtConfExecOptions` 786-807 (**instanceUrl required**; verbs; configPath; extraArgs?; cwd?; logLabel?; bin?; timeoutMs?); `ChtConfExecResult` 815-824.

## 4. Staging + HC2 preview

`src/utils/staging.ts`:
- `resolveWithin(base, rel)` 27-37 — path-traversal guard on every GeneratedFile write/read.
- `createStagingDirectory()` 138-146 — `path.join(os.tmpdir(), 'cht-agent-staging-' + Date.now())`.
- `writeToStaging(files, stagingPath)` 151-170 / `writeToChtCore(files, chtCorePath)` 175-194 — **`writeFile(fullPath, file.content, 'utf-8')`** (no binary).
- `copyToTarget(stagingPath, chtCorePath)` 199-230 — the approval-time writer: recursive `fs.copyFile` of the WHOLE staging tree (byte-safe; binary staged files survive).
- `generateDiffs(files, stagingPath, chtCorePath)` 250-284 → `FileDiff` per file (action 'create' when target absent); `generateUnifiedDiff` 65-79 backed by a **naive positional line comparison** (92-133, not LCS). `displayDiffs` 289-299 truncates at 50 lines (316-317).
- HC2: `humanDevelopmentValidationCheckpoint(state, stagingPath, chtCorePath, iterationCount)` `development-workflow.ts:157-182`; preview iteration `runPreviewModeIteration` 338-364 ("Writing generated files to staging area..." at 345; approve → `copyToTarget` → `clearStaging`; reject → feedback → re-run).

## 5. claude-code-cli module contract

- **Interface** `src/layers/code-gen/interface.ts`: layer-local `GeneratedFile { path; content; purpose?; originalContent? }` 11-17 (NOTE: `path`, not `relativePath`); `CodeGenModuleInput` 28-54 (ticket, researchFindings, contextFiles, orchestrationPlan, codeContextFindings?, targetDirectory, readFile?, listDirectory?, directoryListing?, failingFiles?, lifecycle callbacks onPlan/onFileInProgress/onFileCompleted/onFileFailed/onAttemptFailure); `CodeGenModuleOutput` 56-85 (files, explanation, tokensUsed?, modelUsed?, partialGeneration?, partialGenerationReason?, crossFileIssues?, compileGateSkipped?, compileGateSkipReason?); `CodeGenModule { name; version; generate(input); validate?() }` 87-92.
- **Registry** `src/layers/code-gen/registry.ts`: aliases `{ anthropic → claude-api, claude-cli → claude-code-cli }` 7-10; `getActiveModule(provider?)` 61-74 — `CODE_GEN_MODULE` env, **default 'claude-code-cli'**; `createDefaultCodeGenRegistry()` 77-90 registers claude-api, claude-code-cli, opencode + `validateAliases()`.
- **Module** `src/layers/code-gen/modules/claude-code-cli/index.ts`: `PLAN_PHASE_TOOLS = ['Read','Grep','Glob']` (46); `EXECUTE_PHASE_TOOLS = ['Read','Write','Edit','Grep','Glob']` (47) — **no Bash**. `generate()` 68-87: `snapshotChtCore` → `runGeneration` 113-149 (plan → execute → capture → compile gate → issues) → `rollbackChtCore` always. Zero-edit path: `captureWithRelaxedRetry` 166-201 (relaxed re-execute, then `executeNoOp: true`) → `collectModuleIssues` 265-288 emits `issueType: 'execute-no-op'`. Execute-summary JSON contract `{ files_modified, files_created, summary }` parsed by `extractSummaryBlock` 421-438 (fenced json block, else LAST `{...}` in result text); `reconcilePlanAdherence` 503-531 (plan-adherence-missing/-extra).
- **Plan contract** `src/layers/code-gen/lib/plan.ts`: markers `=== PLAN ===`/`=== END PLAN ===`, item regex `^\d+\.\s*(MODIFY|CREATE)\s+(\S+)\s*[-–—]\s*(.+)` (1-3); `parsePlan` 22-29. Execute prompt requires the final-line JSON summary (`modules/claude-code-cli/prompts.ts:55-60, 119-124`).
- **Driver** `cli-driver.ts`: `spawnClaudeCli(prompt, opts)` 99-162 — argv `['-p','--output-format','json','--max-turns','150','--allowedTools',csv,'--permission-mode','acceptEdits']` (45-53, `DEFAULT_MAX_TURNS = 150` line 41); binary from `CLAUDE_CLI_PATH` env else 'claude'; **full `process.env`** (111); prompt via stdin (116); timeouts 10 min plan / 30 min execute; `parseCliResult(stdout): { result; isError; numTurns; sessionId?; cost? }` 218-229.
- **Workspace** `workspace.ts`: `snapshotChtCore` 69-116 (`git rev-parse HEAD` — throws on non-repo; refuses unmerged paths; `git stash push -u`); `captureChtCoreDiff(chtCorePath, preRunSha)` 123-140 = `git diff --name-status <sha>` + `git ls-files --others --exclude-standard`; deletes dropped (status 'D', `parseDiffStatusLine` 156-162); content read `fs.readFile(...,'utf-8')` (185), originalContent via `git show` (194) — **binary-unsafe**; `rollbackChtCore` 227-297 = `git reset --hard` + **`git clean -fd`** + stash pop. For cht-conf tickets these git ops run against the CHT_CONF_PATH mount (because chtCorePath was rewritten).
- **Adapter** `src/agents/code-generation-agent.ts`: `generateWithLLM` 684-715 → `convertModuleFiles` 763-779 (`path`→`relativePath`; `action = 'modify'` iff existingFiles.has(path) or originalContent; originalContent backfilled); `inferLanguage` 804-820 (ts/js/json/xml/yml/yaml/properties/md/html/css/sh; **fallback 'typescript'; no xlsx**); `inferFileType` 825-839; `normalizeGeneratedFile` 793-799 **drops files with empty content**.

## 6. QA phase (contrast: today's only convert seam)

- `src/workflows/qa-workflow.ts`: `APPLY_ACTIONS_BY_ARTIFACT = { form: ['app-forms'] }` / `defaultApplyActions` 51-56. `deriveVerifyOptions(configPath, issue)` 63-80 — requires `configArtifact === 'form'` + artifactName + `<configPath>/forms/app/<name>.xml` on disk + non-empty `extractTopLevelGroupBinds`; returns `VerifyArtifactOptions`. `createQaInput` 101-124 (configPath fallback `resolveDeploymentConfigRoot()`; provision fallback env CHT_CORE_PATH/CHT_VERSION/CHT_URL 82-86). `executeQaWorkflow(agent, input)` 179-269: `guardConfigFix({ artifact, configRoot })` pre-flight at 188-191 (**no mechanism passed**); reproduce-red 207-217 (aborts if deployed form PASSES); HC3 220-224; seed 227-235; `agent.applyConfig(handle, { configPath, actions, artifact })` 238-242 (**per-form filtered**); green verify 246-252; `succeeded = reproduced && applyResult.succeeded && verified` 254.
- `src/agents/test-environment-agent.ts`: `applyConfig(handle, options: string | ApplyConfigOptions)` 315-342 — real path builds `credentialedUrl(handle)` and calls `runBucket` per action; **instance-coupled**.

## 7. cht-conf-runner (the primitive the new step extends)

`src/utils/cht-conf-runner.ts`:
- `CONFIG_ACTION_COMMANDS` 35-44: `'app-forms': ['convert-app-forms','upload-app-forms']` (also app-settings, app-settings-only, contact-forms, resources).
- `AUTONOMOUS_FLAGS` 52-60: `--force --skip-git-check --skip-version-check --skip-dependency-check --skip-translation-check --accept-self-signed-certs --verbose` (**no `--skip-validate`**).
- `resolveChtConfBin()` line 71: `process.env.CHT_CONF_BIN || 'cht'` (deployment-pinned cht-conf seam, commit 92a98de).
- **Per-form filtering EXISTS**: `FORM_BUCKETS = ['app-forms','contact-forms']` (74); `buildExecArgs` 103-109 appends `['--', ...extraArgs]` (positionals must ride after `--` or cht-conf throws "Unsupported action(s)"); `buildChtConfArgs` 115-125 and `runBucket` 212-249 pass `options.artifact` as that filter.
- `buildExecArgs` **always emits `--url=${options.instanceUrl}`** (104) — offline convert needs a new arg-builder variant (the `cht` binary itself supports it; see demo evidence in §10).
- `minimalEnv()` 86-94: child env allowlist PATH/HOME/NODE_PATH/TMPDIR/LANG/LC_ALL (LLM keys never reach cht-conf). `runChtConf(options: ChtConfExecOptions): Promise<ChtConfExecResult>` 162-205 (never rejects; timeout default 180 s; supports `cwd`, `bin`). `classifyChtConfOutput` 144-155 (skip-line-first parsing).

## 8. Deterministic assertion utils (pure, reusable offline)

`src/utils/xform-inspect.ts`:
- `decodeXmlAttr(value: string): string` 33-42.
- `extractBindRelevant(xml: string, nodeset: string): string | undefined` 53-61 — exact-nodeset `<bind>` match, attribute-order agnostic.
- `extractTopLevelGroupBinds(xml: string): FormBindExpectation[]` 78-90 — every `/data/<segment>` bind carrying `relevant`, deduped.
- `verifyFormBinds(xml, expectations): { passed: boolean; checks: FormBindCheck[] }` 97-123.

`src/utils/config-type.ts`: `classifyConfigType(artifact, mechanism?)` 92-121 — 'form'/'contact-form' → fixable-from-deployment with reason "...the .xlsx source is lost, so this is authoring-only" (97-99); `guardConfigFix({ artifact, mechanism?, configRoot? }): { ok; fixability; sourcePresent; message }` 146-183. The new dev-phase step should call this guard too (mechanism unavailable from ticket).

## 9. Test & dependency conventions

- Runner: **mocha 11** + chai 6 + sinon 21 + proxyquire + mock-fs; nyc coverage. `.mocharc.json`: spec `test/**/*.spec.ts`, **ignores `test/harness/**`**, `ts-node/register`, timeout 10 s. `npm run test:harness` uses `.mocharc.harness.json` (timeout 120 s).
- Tests mirror src paths: `test/utils/cht-conf-runner.spec.ts`, `test/utils/xform-inspect.spec.ts`, `test/workflows/qa-workflow.spec.ts`, `test/supervisors/development-supervisor.spec.ts`, `test/layers/code-gen/modules/claude-code-cli/{index,cli-driver,workspace,prompts}.spec.ts`. Ticket fixtures in `test/fixtures/` (incl. `valid-ticket-cht-conf.md`).
- Deps (`package.json`): langchain/langgraph, `diff` ^8, zod, gray-matter, js-yaml, dotenv, ajv, langfuse. **No xlsx/exceljs/jszip library** — the planned Node-lib .xlsx apply requires a new dependency. `cht-conf-test-harness` ^5.0.4 is a devDependency (bundles ONLY cht-core 4.11; coreVersion must be '4.11.0').
- Scripts: `npm run full|dev:run|research` run `dist/` (build first); `test`, `test:harness`, `demo:build-seed`.

## 10. Demo fixtures

- **`demo/config-pnc-demo/`** — pruned cht-core 5.2.0 `config/default`; every app form has `.xlsx` + `.xml` + `.properties.json` (**`pregnancy_home_visit.xlsx` exists** — the xlsx-present case). `PLANTED-BUG.md`: bug planted in `forms/app/pregnancy_home_visit.xlsx` `survey!K153` (relevant column of the `danger_signs` begin-group, row 153); shared-string surgery — new index 860 appended, only K153 repointed (K173 `safe_pregnancy_practices` / K205 `summary` still share index 360); shipped `.xml` regenerated so line 1167 carries the planted bind `/data/danger_signs`. Planted gate = `selected(../pregnancy_summary/visit_option, 'yes') or selected(../pregnancy_summary/visit_option, 'miscarriage')`; correct = yes-only. **Offline convert evidence (PLANTED-BUG.md:95-101)**: `cht --source=<demo> --skip-dependency-check --skip-validate --skip-version-check --skip-git-check --skip-translation-check convert-app-forms -- pregnancy_home_visit` (no --url) reproduces upstream XML byte-for-byte with cht-conf 6.5.0.
- **`tickets/demo-pnc-relevant.md`** frontmatter: `layer: cht-conf`, `domain: forms-and-reports`, `configArtifact: form`, `artifactName: pregnancy_home_visit`, `chtConfVersion: "6.5.0"`, `deploymentRef: "demo/config-pnc-demo"` — no mechanism/expression fields.
- **`test/harness/pregnancy-home-visit.spec.ts`** — tier-2 Enketo proof (headless Chromium; self-skips when harness absent): `DEMO_CONFIG = demo/config-pnc-demo` (58), `FORM = 'pregnancy_home_visit'` (59), `YES_GATE`/`PLANTED_GATE` constants (63-65), asserts danger_signs skipped for miscarriage / shown for yes.
- **`demo/site-reconstruction/`** — README + `build-seed-data.ts` + `sample/app_settings.json` (the xlsx-LOST reconstructed-deployment scenario; pairs with the `app-settings-only` bucket).

## 11. Key gap (confirmed)

`convert-app-forms` runs ONLY inside QA's `applyConfig` against a live instance. The dev graph's `validateImpl` is LLM+heuristic only. A deterministic dev-phase convert-and-assert is a NEW node with no existing offline convert seam; it should compose: `guardConfigFix` → apply descriptor to `.xlsx` (new Node lib, shared-string-safe) → offline `runChtConf` variant (no `--url`, `--skip-validate`, `-- <formName>` filter, `CHT_CONF_BIN`, minimalEnv, cwd=project) → `extractBindRelevant`/`extractTopLevelGroupBinds`/`verifyFormBinds` for the assert — while keeping upload exclusively in QA so the red baseline still reproduces.
