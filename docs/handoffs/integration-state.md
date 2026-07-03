# Integration state — `integration/demo-closed-loop`

Mission 03 assembly log. One section per merge-train step; SHAs are merge
commits on this branch. Base: `main` @ `ed07177`.

## S0 — `fix/filter-spec-skipped-pollution` (138c777) @ 3a8f4f5
- Tests: 558 → 558   Lint: clean
- Conflicts: none
- Notes / deviations: mission baseline said "~571"; measured main baseline is
  558 (571 is where the suite lands after S1's +13). Gate passed: `git status`
  clean after `npm test` — no `agent-memory/_skipped.ndjson` pollution, and
  the suite is green with ambient `ANTHROPIC_MODEL` set (both fixes active).

## S1 — `134-cht-conf` (8822abb) @ f6cdec2
- Tests: 558 → 571 (+13, as expected)   Lint: clean
- Conflicts: none
- Notes / deviations: mission described the branch as "single commit f63cc8b";
  it actually carries f63cc8b plus docs commit 8822abb (#135 closure-mapping
  correction in PR handoffs) — both merged. Fixture gate passed:
  `parseTicketFile('test/fixtures/valid-ticket-cht-conf.md')` →
  `technical_context.layer: "cht-conf"`, `configArtifact: "form"`,
  `artifactName: "pnc_followup"`.

## S2 — `134-pr5` stack (36942fb; contains PR3+PR4) @ 05410b6
- Tests: 571 → 652 (+81)   Lint: clean
- Conflicts: none (stacked on S1 as expected)
- Notes / deviations: gate specs present and green — routing
  (`test/supervisors/research-supervisor.routing.spec.ts`), scoring
  (config-aware scoring specs inside `context-analysis-agent.spec.ts` /
  `context-loader.spec.ts`), canonical diff (`test/utils/canonical-diff.spec.ts`,
  `dev-target.spec.ts`). Individual PR branches 134-pr3/pr4/pr5 left intact.

## S3 — `memory/promote-data-sync` (4a5ea3b) @ fa17314
- Tests: 652 → 712 (+60)   Lint: clean
- Conflicts: none — the expected `agent-memory/schema.json` conflict did not
  materialize; git auto-merged it (134's CHTLayer/ConfigArtifact/
  ConfigMechanism definitions + layer/configArtifact frontmatter props landed
  in different hunks than #129 A.4's nullable `issueNumber` + `resolvedIssue`).
  Union verified by hand against both parents: all additions from both sides
  present. `agent-memory/TEMPLATE.md` untouched by data-sync — no union needed.
- Notes / deviations: `npm run validate-schema` over full corpus: 64 passed,
  0 failed, 3 skipped (READMEs/TEMPLATE). Relink tool specs green in suite.
  Adversarial verification fan-out run post-merge (see mission report).

## S4 — 8 promote branches, Stream-B order @ cbe5f0f, f7c9894, 7f080ac, e847284, b2ebdc5, 2d62a58, 7897869, 193d885
- Tests: 712 → 712 (corpus-only merges)   Lint: clean
- Conflicts: none (all eight purely additive — 0 modified files vs main under
  `agent-memory/domains/**`)
- Notes / deviations: context-loader gate (one-off script, not committed) —
  loaded counts per domain: messaging 27, infrastructure 49,
  forms-and-reports 57, tasks-and-targets 35, authentication 39, contacts 54,
  interoperability 16, configuration 10, data-sync 24. Matches expectations
  once legacy corpora are accounted for: only messaging/forms-and-reports/
  contacts/interoperability/data-sync had 10 legacy files each on main; the
  newer domains (infrastructure, tasks-and-targets, authentication,
  configuration) had none. Mission's "forms-and-reports ≈47" counted promoted
  drafts only; cumulative is 47+10=57. contacts 54 (44+10) and data-sync 24
  (14+10) match the mission's cumulative numbers exactly.

## S5 — `66-test-environment-layer-implementation` (710a023, phases 1–3) @ 80e2ec4
- Tests: 712 → 820 (+108)   Lint: clean
- Conflicts: none — the anticipated `src/types/index.ts` overlap auto-merged;
  union verified against both parents (all 193 lines of #66's type additions
  present; 134's CHTLayer/ConfigArtifact/CanonicalDiff additions present; the
  only non-additive delta vs the #66 branch is 134's deliberate removal of
  `historicalSuccessRate` from f63cc8b, correctly carried).
- Notes / deviations: mission ballpark said "~640+"; actual 820 (ballpark was
  written before mission-02b's +75 Phase-3 tests landed).
  `docker/cht-agent-net.override.yml` present; test-environment specs green.
  S0–S3 adversarial verification fan-out returned 3/3 pass (schema union
  complete; no branch content lost; conventions ground rules upheld —
  claude-cli.ts/factory.ts/types.ts byte-identical to main,
  codeContextFindings wiring intact, package-lock identical to main).

## S6 — `feat/llm-provider-unification` (4a5c5b1, 02c) @ 3c63016
- Tests: 820 → 845 (+25)   Lint: clean
- Conflicts (hand-unioned, both features survive):
  - `src/supervisors/research-supervisor.ts`: took 02c's constructor-time
    planner selection (`isUsingCLIProvider() ? createCliPlanner() :
    createApiPlanner(...)`); ported 134's P0 sampling fix
    (`/opus-4-[678]|fable/` → `invocationKwargs` undefined overrides) into
    `createApiPlanner` with its original comment. No `plannerModel` remnants;
    `codeContextFindings` wiring intact (4 occurrences).
  - `src/utils/domain-inference.ts`: import union; `inferUsingLLM` keeps
    134's `Promise<InferenceResult>` + tolerant layer/configArtifact mapping
    (single-sourced in a shared `toInferenceResult()` used by BOTH provider
    paths); 02c's CLI structured-chain routing adopted; `inferenceSchema` and
    `INFERENCE_SHAPE` extended with optional `layer`/`configArtifact` so CLI
    mode returns them.
  - `test/utils/domain-inference.spec.ts`: import union; both parents' suites
    kept; two 02c CLI-path assertions widened with `layer: 'cht-core'` (the
    union legitimately widens the return shape).
- Notes / deviations: two sibling specs auto-merged without markers but were
  semantically stale and fixed: 02c's `research-supervisor-llm-routing.spec.ts`
  fixture dropped its `historicalSuccessRate` line (134 deliberately removed
  the field, asserted by 134's own tests); 134's
  `research-supervisor.routing.spec.ts` planner stub renamed
  `plannerModel` → `planner` (02c's field rename), resolving a plan string.
  Gate: default-path no-regression (routing spec) + CLI-path tests
  (llm-routing, display-helpers specs) green inside the 845.

## S7 — dev-layer hand-integration from origin/63 (a9eaac6, contains #86) @ 9 commits
- Tests: 845 → 1308 (+463)   Lint: clean
- Commits: C1 17d874b (types union), C2 77ec915 (code-gen/test-gen layers +
  dev utils), C3 e24727f (dev agents + supervisor), C4 fb8b94c (research-side
  hand-merges), C5 abd2bb0 (workflows, dev/full CLIs, package union),
  F1 761c7c6 (H1 registry guarantees), F2 bd39d10 (H2 assertion-only gate),
  F3 39508e6 (H3 staging containment), F4 83777c9 (codeContextFindings
  bridge).
- Conflicts: none in the git sense (hand-integration, not a merge). Global
  adaptations: `historicalSuccessRate` dropped everywhere (134's removal
  wins); `recommendedApproach` → `proposedApproach` at every 63-origin site.
  Hand-merged files (integration base + 63's additive hunks):
  research-supervisor (only addition: optional `additionalContext` param),
  context-analysis-agent (todos/gatherCodeContext/recommendations refactor),
  documentation-search-agent (askQuestion flow; `infrastructure` domain and
  mcpServerUrl/modelName options preserved), mcp/client (askQuestion/
  getSources added), display-helpers (banners/grouping added),
  code-gen registry/interface/claude-api (63's modules + main's duplicate
  guard + CODE_GEN_MODULE selector).
- Key plan discoveries: src/llm/{types,factory,index}.ts are byte-identical
  between integration and 63 — zero provider ports needed; integration's
  anthropic.ts already carries the tool-use loop (kept unchanged, judge call
  resolved keep-main); 63 never touched ticket-parser/constants;
  domain-inference superseded by 02c+134 (nothing taken).
- Rejected 63-side deletions (all intact, verified byte-identical):
  test-environment-agent (#66 wins), code-context-agent, deepwiki-client,
  types/pipeline, llm/{json-extract,rate-limit,structured-cli},
  utils/research-results, all pipeline scripts, promoted corpus.
- package.json: scripts union (all 15 kept + full/dev:run/example:full/
  validate-cli); @langchain kept at integration's 0.x pins (63's 1.x bumps
  rejected); +diff/@types/diff; typescript moved to dependencies
  (compile-validator runtime import); engines ≥22.17.0; lock regenerated
  additively (added 3, changed 1).
- Gates: build/test/lint green after EVERY commit; grep gates
  (recommendedApproach = 0, historicalSuccessRate = 4 known spec hits) after
  every commit; `npm run research tickets/10944.md` smoke via claude-cli
  provider (ANTHROPIC_MODEL=claude-opus-4-8): full graph, doc-search 4/4,
  context-analysis 6/6, code-context node semantics intact (architecture
  patterns + dependency edges rendered), plan generated, phase `complete`,
  0 errors. Adversarial verification fan-out: 4/4 pass (ground rules,
  wholesale fidelity on 19 files, hand-merge preservation with md5/count
  evidence, behavioral probes of all four fixes incl. traversal attempts and
  stranded-alias detection).
- Notes / deviations & follow-ups: H2's ASSERTION_PATTERNS adds
  /sinon\.assert/ (broadening, deliberate); regex gate accepts `expect(` in
  comments/strings (accepted limitation, on record); claude-api module
  renders arch-insights in the plan prompt but not per-file execute prompts
  (claude-code-cli renders in all three) — follow-up for full cross-module
  bridge coverage; .nycrc thresholds lowered to 63's (60/78/72/78) — follow-up
  to ratchet back up; `63-review-fixes` mirror branch being assembled in a
  separate worktree (tip recorded in the mission report).

## S8 — `126-langfuse-refactor` (88a340f) @ 7ce85b7 (+ cd0cd05 lock, 96be5ec lint fix)
- Tests: 1308 → 1312 (+4)   Lint: clean
- Conflicts (resolved by hand, ~6 min — well inside the 1 h timebox):
  - `src/scripts/run-pipeline.ts`: kept main's #119 batch/concurrency
    structure (BatchCtx/BatchState, runWorker, rate-limit abort,
    RATE_LIMIT_EXIT_CODE); re-applied 126's `startTrace` instrumentation by
    hand — trace + scrape span + distill score + trace.update on both
    decision branches + `flushAsync`, with `sessionId: randomUUID()` threaded
    through `BatchCtx` and `runFilter` passing `langfuseHandler` to
    `filterPR`.
  - `src/scripts/distiller.ts`: kept #135's `resolveDistillOpts` + no-issue
    flagging; threaded `opts.langfuseHandler` into the default `distillFn`.
  - `package.json`: +langfuse/langfuse-langchain (union); lock taken from
    ours in the merge, regenerated via `npm install` as its own commit
    (cd0cd05) per conventions.
  - `.env.example`: union — LANGFUSE_* block appended after ours.
- Notes / deviations: one post-merge lint fix (default-param-last on the new
  `processSinglePR` signature, 96be5ec). Gate passed: full suite green with
  `LANGFUSE_ENABLED=false` (observability no-op specs included). New clean
  files: `src/observability/index.ts`, its spec, `docs/observability.md`,
  Langfuse handoff docs.

## S9 — demo assets @ 5b1a705, 3e98156, 3817c56 (all `demo:` commits)
- Tests: 1312 → 1312   Lint: clean (demo/ added to eslint ignorePatterns —
  demo assets sit outside tsconfig.eslint's project, not part of the
  build/test surface)
- Conflicts: n/a (new files)
- Assets:
  - `demo/site-reconstruction/README.md` — artifact checklist + exact
    cht-conf upload paths, every command verified against the INSTALLED
    cht-conf 6.5.0 source with file:line citations (upload-app-settings
    reads a compiled app_settings.json and does not compile; forms via
    convert-app-forms + upload-app-forms; seed via csv-to-docs → upload-docs;
    users via create-users; the `--` argv rule for extra args; https://nginx
    self-signed-cert conventions).
  - `demo/site-reconstruction/build-seed-data.ts` (+ synthetic sample/) —
    scrubbed contact/report export + app_settings `contact_types` hierarchy →
    csv-to-docs CSVs (contact.<type>.csv per type, report.<form>.csv per
    form) and create-users users.csv. Validated end-to-end on the sample:
    7 contacts/4 types, 3 reports/2 forms, 2 users, design doc skipped.
  - `tickets/demo-cht-conf-site.md` — template with frontmatter
    `layer: cht-conf`; parse-verified (frontmatter precedence → routing with
    no LLM call); valid defaults + HTML comments for operator placeholders.
  - `demo/config-pnc-demo/` — cht-core `config/default` @ 57ea922 (v5.2.0),
    pruned to the upload surface (~2 MB, no .js sources; app_settings.json
    ships compiled). Planted bug: `pregnancy_home_visit` `danger_signs`
    group `relevant` (survey!K153) gains
    `or selected(../pregnancy_summary/visit_option, 'miscarriage')` — the
    form keeps prompting after a miscarriage. Edited surgically in the xlsx
    (shared string split; sibling cells K173/K205 keep the original), XML
    reconverted with cht-conf 6.5.0. Documented in PLANTED-BUG.md; paired
    filled-in ticket `tickets/demo-pnc-relevant.md` (parse-verified,
    domain: forms-and-reports, configArtifact: form).
- Notes / deviations: the mission said "PNC/miscarriage follow-up form";
  config/default's miscarriage-continuation logic actually lives in
  `pregnancy_home_visit` (the PNC danger-sign follow-up forms have no
  miscarriage branch), so the bug is planted there — same symptom, real form.
  Open question for the operator: the demo ticket advertises
  chtConfVersion 6.5.0 (the converting tool) while the config content is
  cht-core 5.2.0's — confirm which the demo should state.
