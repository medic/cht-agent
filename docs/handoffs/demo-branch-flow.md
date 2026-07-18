# Deliverable B — how the e2e demo was assembled (branch flow) + animation prompt

Compiled from `integration-state.md`, mission reports 01–05, and the
mission-05 follow-up ledger. Full citations live in those docs.

## The flow in one paragraph

`main@ed07177` (baseline: 558 tests) was assembled into
**`integration/demo-closed-loop`** by a ten-step merge train (Mission 03):
test-isolation fixes (#108) → the **#134 cht-conf stack** (ticket frontmatter
routing, layer-aware DeepWiki, config-aware scoring, canonical-diff +
`CHT_CONF_PATH` mounts) → nine **corpus promote** branches (#135,
agent-memory domains) → the **#66 Test Environment Layer** (discoverConfig /
prepareTestData / cht-conf-runner / cht-api) → **LLM–CLI unification** (the
claude-cli provider drives research) → the **dev layer** hand-integrated from
`origin/63-implement-test-generation-layer` (#8/#63/#86 lineage — code-gen,
test-gen, development supervisor; +463 tests, the biggest step) → **#126
Langfuse observability** → **demo assets** (the planted-bug fixture +
site-reconstruction tooling). **Mission 04** then closed the loop on that
branch (G1 QA orchestration with HC3, G2 layer-routed write target, G3
`verifyArtifact` deployed-XML assertions; 1352 tests). **Mission 05**
(`feat/mission-05-xlsform-orchestrator`) added the deterministic XLSForm
orchestrator-editor (P0–P7: descriptor contract → exceljs surgical editor →
offline convert+assert → HC2 bind-diff), and six live demo runs drove the
**F1–F9 follow-up fixes** on the same branch (final gates: 1587 passing / 0
failing). The demo that shipped = main + merge train + mission 04 + mission 05
+ F1–F9, proven end-to-end against a reconstructed eCHIS Kenya deployment.

## Future small PRs to carve out (the "in-progress set")

From `feat/mission-05-xlsform-orchestrator` (local, unpushed):
1. Mission-05 core (P1–P7: xlsform-editor, descriptor schema, offline
   convert runner, applyXlsformFix node, HC2 bind-diff, CLI wiring)
2. F1+F2 (canonical collateral oracle + root-agnostic bind extraction)
3. F3+F8 (retry feedback threading; session-resume, descriptor tolerance,
   apply-first gating, `DEV_MAX_ITERATIONS`)
4. F4 (exhaustion hard stop)
5. F5+F6 (bindDiff-driven QA oracle; whole-document oracle)
6. F7+F9 (partner harness spec generation + `--qa-tier2`; sandbox-safe
   emission, tier-2 output visibility, xsltproc bake)
7. Infra: Dockerfile Chromium/pyxform/xsltproc bakes + compose demo env block
   + runbook/DEMO-STEPS docs

Mission-04 mirrors still to create: `feat/dev-target-layer-routing` (G2) and
`feat/qa-orchestration` (G1) — `feat/qa-form-verify` (G3) already exists off
#66. Deferred/parked (not PRs yet): no-git snapshot fallback (#1b), pre-dev
reproduce gate (#3a), cht-conf corpus seeding (#4b), local-config context
node (#5).

## Shareable prompt for Claude Design Animation

> Create a whiteboard-style animated flowchart — hand-drawn squiggly arrows,
> marker-sketch node boxes, staggered draw-on animation as if being sketched
> live — showing how our multi-agent demo branch was assembled from `main`.
>
> Layout: `main` as a thick horizontal trunk on the left edge. Six feature
> branches curve off it as squiggly arrows, each labeled with a short chip,
> all converging into a large highlighted node named
> `integration/demo-closed-loop`:
> 1. "#108 test isolation"
> 2. "#134 cht-conf routing — ticket frontmatter, canonical diff, config mounts"
> 3. "#135 corpus promote ×9 — agent-memory domains"
> 4. "#66 test-environment layer — discoverConfig, cht-conf runner"
> 5. "#63/#8 dev layer — code-gen, test-gen, development supervisor (+463 tests)"
> 6. "#126 langfuse observability"
> plus a small dashed arrow "demo assets — planted-bug fixture".
>
> From `integration/demo-closed-loop`, one bold arrow continues right into a
> node "Mission 04 — the closed loop: research → HC1 → develop → HC2 → QA
> red→green → HC3", then a second bold arrow into "Mission 05 —
> feat/mission-05-xlsform-orchestrator: fix the real .xlsx source
> (descriptor → surgical edit → offline convert → verify)".
>
> Along the Mission-05 arrow, draw six small milestone ticks that pop in one
> by one, labeled: "F1/F2 canonical oracle + any-root binds", "F3/F8 informed
> retries (--resume)", "F4 loud failure", "F5/F6 QA sees the real fix
> (whole-document oracle)", "F7/F9 partner harness spec + --qa-tier2",
> "infra: Chromium + pyxform + xsltproc baked".
>
> Ending: the Mission-05 node bursts into a cluster of seven small
> squiggly-arrow stubs flying back LEFT toward `main`, each a dashed
> arrow labeled as an upcoming small PR: "mission-05 core", "F1+F2",
> "F3+F8", "F4", "F5+F6", "F7+F9", "docker/compose/docs" — plus two faded
> stubs "G2 dev-target routing" and "G1 QA orchestration" (mission-04
> mirrors). Final frame: a green stamp on the far right — "e2e demo: closed
> loop GREEN — 1587 tests, 6 live runs" — with a tiny caption "reconstructed
> eCHIS deployment, real PNC bug, fixed at the source".
>
> Style: dark-marker on whiteboard, two accent colors (green for shipped,
> amber dashed for in-progress/planned), arrows wobbly and hand-drawn,
> labels in a casual handwritten font, ~20–30 seconds total, each element
> drawing on in the order described.
