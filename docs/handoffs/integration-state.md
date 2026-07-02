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
