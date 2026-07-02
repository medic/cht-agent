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
