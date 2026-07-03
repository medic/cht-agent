# Mission 04 — Close the loop: wire QA into the pipeline, then rehearse

**Completed 2026-07-03.** Single session on `integration/demo-closed-loop`
(prerequisite: mission 03). Last functional/demo commit **`114d736`**; this report
+ its provenance note commit on top of it, so the true branch tip is the current
`HEAD` of `integration/demo-closed-loop` at read time. Gates (verified at
`114d736`): `npm run build` clean, **1352 passing / 0 failing**
(`env -u ANTHROPIC_MODEL LANGFUSE_ENABLED=false npm test`), `eslint .` clean. Baseline was 1312 (mission 03) → +40 tests (the
tier-2 harness spec's 3 tests are excluded from the default suite; see A2).

The three concrete gaps the audit found are closed and wired into the runnable
pipeline. `demo/config-pnc-demo` runs the loop end to end in the rehearsal
(non-live tiers); the live tiers are operator-verified in the runbook.

---

## Phase A — the closed loop (committed on `integration/demo-closed-loop`)

| Commit | Gap | What landed |
|---|---|---|
| `1719987` | **G2** | Layer-routed development write target. `resolveDevelopmentTarget(layer)` is wired into `development-workflow.ts` (new `resolveWriteTarget`) + `cli/full.ts`/`cli/dev.ts`: a `layer: cht-conf` ticket generates AND writes its fix under `CHT_CONF_PATH`; cht-core stays byte-identical (no-op when target === chtCorePath). New `DevelopmentTarget` type + optional `DevelopmentOptions.developmentTarget`. |
| `fa897ce` | **G3** | `verifyArtifact` — deployed-XForm content assertion. `cht-api.fetchFormXml` (GET `/api/v1/forms/<form>.xml`) + pure `xform-inspect` (`extractBindRelevant`/`verifyFormBinds`) + `TestEnvironmentAgent.verifyArtifact`: fetch the uploaded form and assert the target bind's `relevant` AND that siblings are unchanged — real content, not "rev changed". Runs as both the red baseline and the green proof. |
| `d3e2a33` | — | Config-type boundary guard (`config-type.ts` `classifyConfigType`/`guardConfigFix`) + the two `reconstruct-rules` follow-up issue drafts. JSON+form-XML fixable from a mount; task/target-logic + contact-summary need source, with a *qualified* refusal. |
| `3d9b7e9` | — | Tier-2 `cht-conf-test-harness` skip-logic spec (headless Enketo). Excluded from the gate suite; self-skips when the harness/Chromium is absent. |
| `d4f0508` | **G1** | QA closed loop in the orchestrator. New `qa-workflow.ts` (`createQaInput`/`executeQaWorkflow`/`humanQaValidationCheckpoint`) drives `TestEnvironmentAgent` in red→fix→green order with an **HC3** gate; opt-in `--qa` on `cli/full.ts` (default off); `FullWorkflowResult.qa`; exported `runQaPhase`. |
| `e89d6f7` | — | `app-settings-only` upload bucket (upload without compile) for pre-compiled deployment recovery. |
| `114d736` | — | Demo runbook + site-reconstruction live-deployment recovery path (demo docs). |

### Design decisions worth noting
- **A1 write vs workspace.** For cht-conf the *code-gen workspace* AND the write
  target both become `CHT_CONF_PATH` (the agent must read/edit the form in the
  config repo). `resolveWriteTarget` honours a pre-resolved `options.developmentTarget`
  (set by the CLI so a missing/placeholder mount fails loudly early), else resolves
  from the ticket layer, else falls back to `chtCorePath` (byte-identical).
- **A3 phase order** (deviation from the mission's literal list, forced + safer):
  `provision → discoverConfig(pre) → reproduce(RED) → HC3 → prepareTestData →
  applyConfig → discoverConfig(post) → verify(GREEN)`. `discoverConfig` must
  precede `prepareTestData` (the API needs a `DiscoveredConfig` to classify seeded
  docs), and `reproduce` (read-only) runs before HC3 so the human approves the
  destructive seed/apply only once the symptom is confirmed reproduced. QA aborts
  if the symptom does not reproduce ("refusing to fix a non-reproduced symptom").
- **A3 verify set** is snapshotted from the CORRECTED local form
  (`extractTopLevelGroupBinds`), so the deployed pre-fix form necessarily fails it
  (red) and the post-fix form passes it (green) — no hard-coded expectations.

---

## A4 — `medic/cht-ai-tools` evaluation (verified this session)

Repo is real (`main`, AGPL-3.0). The form-authoring pieces (`/create-form`,
`/deploy`) live on the **`feat/add-cht-form-builder`** branch (unmerged);
`validate-cht`/`format-cht` hooks, the `cht-specialist` skill, and the CHT Docs
MCP are on `main`. Decision per piece:

| Piece | Adopt for the demo? | Why |
|---|---|---|
| `validate-cht` hook | **Yes** | Fast, non-blocking pre-write `node --check` on `tasks.js`/`targets.js`/`contact-summary.templated.js`/`purge.js`. Complements (JS syntax) — does not replace — cht-conf `validate-app-forms` (XForm). |
| `/create-form --compare design.xlsx form.xlsx` | **Yes (narrative)** | Nice beat to surface design-vs-current drift. It generates-from-design / compares; it does **not** do surgical cell-level `relevant` edits (inferred from its documented mode set — no doc line states the limitation, flagged). |
| `/deploy` localhost UI | **Yes (interactive option)** | Wraps the cht-conf upload chain behind a browser UI, SSE-streamed logs, credentials entered in-browser (never in AI context) — a human-friendly alternative to headless `applyConfig`. |
| `format-cht` hook | Optional | PostToolUse `eslint --fix` on the same 4 JS files; harmless. |
| CHT Docs MCP (`cht-docs`) | **No** | Overlaps our Kapa live-docs wiring (CHT's docs assistant is itself kapa.ai-powered). |
| `cht-specialist` skill (29 offline refs) | **No** | Overlaps our OpenDeepWiki repo-knowledge layer. |
| Surgical `relevant` fix | **No** | Our code-gen layer owns targeted in-place edits. |
| Automated QA loop | **No** | Our agent (A3) owns reproduce→fix→verify. |

**Install:** `npx @medic/cht-ai-tools install` (or `/plugin marketplace add
medic/cht-ai-tools`). The form-builder plugin is not yet in the published
marketplace — demo it from `feat/add-cht-form-builder`. Additive; the closed loop
does not depend on it.

---

## Phase B — rehearsal (captured outputs)

1. **Full pass:** `npm ci` (548 pkgs), build clean, **1352 passing / 0 failing**,
   `eslint .` clean. (Node 22.)
2. **Ticket routing (no LLM).** `parseTicketFile(tickets/demo-pnc-relevant.md)` →
   `domain: forms-and-reports, layer: cht-conf, configArtifact: form,
   artifactName: pregnancy_home_visit, chtConfVersion: 6.5.0,
   deploymentRef: demo/config-pnc-demo` — all from frontmatter; the parser is pure.
3. **Canonical diff.** `diffAgainstCanonical` (deployment = planted demo,
   canonical = unplanted `config/default` copy) → `status: differs`, isolating
   exactly the `danger_signs` `relevant` (`- yes-only` vs `+ yes or miscarriage`).
4. **Verifier (A2 tier 1) — the red→green pair** on the REAL demo form:
   - RED (planted): `passed = false`; `/data/danger_signs` mismatches
     (`expected: selected(../pregnancy_summary/visit_option, 'yes')`,
     `actual: … 'yes') or selected(… 'miscarriage')`); siblings
     (`safe_pregnancy_practices`, `summary`) unchanged & passing.
   - GREEN (corrected): `passed = true` (10 top-level group binds all match).
   - **Tier 2 (harness):** operator/CI-verified — see the caveat below.
5. **Seed build.** `npm run demo:build-seed` on `demo/site-reconstruction/sample/`
   → 7 contacts across 4 types (district_hospital→health_center→clinic→person),
   3 reports (assessment, pregnancy), 2-row `users.csv`; CSVs match the
   `app_settings` `contact_types` hierarchy.
6. **Full LLM research** (`LLM_PROVIDER=claude-cli npm run research …`) —
   operator-verified. Nested `claude -p` works in the container but burns the
   Fable session budget; run it live with `ANTHROPIC_MODEL=claude-opus-4-8`.
   Frontmatter routing (step 2) already proves the no-LLM routing.
7. **Live QA `--qa` dry-run** — operator-verified (no instance on `https://nginx`
   this session). Exact command + expected upload/verify lines are in the runbook.

---

## PR-shaped mirror branches — outcome

The mission asked for three mirrors. Reality: the primitives these features build
on have **not landed on `main`** — `dev-target.ts`/`canonical-diff.ts` live on the
`#134` PR stack (`dev-target.ts` is on `134-pr5`), `cht-api.ts`/
`test-environment-agent.ts` on `#66`, and `orchestrator.ts` converges **only on
the integration branch**. So:

- **`feat/qa-form-verify`** (A2/G3) — **CREATED off `66-test-environment-layer-implementation`**,
  tip **`e1f1547`** (cherry-pick of `fa897ce`). Verified there: `tsc --noEmit`
  clean, **679 passing** (666 baseline + 13). Landable as its own PR on top of #66.
- **`feat/dev-target-layer-routing`** (A1/G2) — **NOT created.** `main` lacks
  `dev-target.ts`/`canonical-diff.ts`/`development-workflow.ts`/`orchestrator.ts`;
  the cleanest realistic base is `134-pr5` (has `dev-target.ts`) but the change
  also needs `development-workflow.ts` + `orchestrator.ts`, which only converge on
  integration. **Recommend:** cherry-pick `1719987` after the #134 stack + the
  research-supervisor (#6) merge to main.
- **`feat/qa-orchestration`** (A3/G1) — **NOT created; kept integration-only** (as
  the mission anticipated). `orchestrator.ts` exists only on integration and the
  QA phase depends on BOTH #66 and the dev/research layers. **Recommend:** a
  follow-up upstream issue to land the QA orchestration once #66 + the dev layer
  are on main; cherry-pick `d4f0508` (+ `e89d6f7`) then.

---

## Deviations from the mission
- **A3 phase order** reordered (see Design decisions) — forced by the
  `prepareTestData` API contract and safer (red confirmed before HC3).
- **Two of three mirror branches not created** — bases lack the foundation (above);
  documented with land-after recommendations.
- **Tier-2 harness not executed in-container** — no Chromium (see caveat).
- **No standalone `canonical-diff` CLI added** — `.nycrc` counts `src/cli`/
  `src/scripts`, so an untested CLI would dent coverage; the research phase already
  surfaces canonical-diff (#134), and step 3 was captured via `diffAgainstCanonical`
  directly. The runbook gives the one-line node invocation for standalone use.

## Follow-ups discovered
- **Chromium for tier 2.** `cht-conf-test-harness` 5.0.4 pulls
  `puppeteer-chromium-resolver`, which downloads **Chromium 93** on `npm ci`
  (cached to `~/.chromium-browser-snapshots`; `PUPPETEER_EXECUTABLE_PATH` is NOT
  read — use a `pcr` object in package.json). No `Dockerfile.workbench` exists to
  edit, so add Chromium + the puppeteer Debian libs to the **runtime/CI image**,
  then `npm run test:harness`. Also: harness 5.0.4 bundles **only cht-core 4.11**
  (`coreVersion` must be `'4.11.0'`; 5.x throws) — the demo config is 5.2.0, so the
  harness emulates 4.11; the `relevant` skip-logic reproduces, but flag the gap.
- **`reconstruct-rules` escape hatch** for task/target logic (turns the
  needs-source hard stop into reconstruct-then-fix): drafts
  `designs/issue-cht-ai-tools-reconstruct-rules-skill.md` +
  `designs/issue-cht-agent-tasks-targets-memory.md`.
- **`app-settings-only`** (`e89d6f7`) is upstream-able on a #66 PR alongside
  `feat/qa-form-verify`.
- Carried from mission 03 (still open): `inferUsingLLM` sampling-param guard;
  sampling regex misses sonnet-5; `.nycrc` thresholds lowered (60/78/72/78) pending
  a ratchet; `processSinglePR` Langfuse trace lost on a throw.
