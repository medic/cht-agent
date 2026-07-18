# cht-conf extension spec — reply for medic/cht-agent#134

Everything below the marker is the paste-ready comment for
https://github.com/medic/cht-agent/issues/134. It is written in the repo's
`designs/layer_recommendations/` style and is partner-neutral (safe for a
public issue). Optionally also commit it to the cht-agent repo as
`designs/layer_recommendations/cht-conf-extension.md` alongside the comment.

> **Recoverable WIP for this extension (found 2026-07-17):** the cht-agent
> repo carries `stash@{1}: On 134-cht-conf-pr1: "134 P0+PR1+PR2 wip
> (migrate to main)"` — inspect (`git stash show -p stash@{1}`) when the
> cht-conf-extension PRs begin; it may already contain the migrate-to-main
> rebase work for the #134 stack.

---8<--- PASTE AS #134 COMMENT FROM HERE ---8<---

# Extending cht-agent to cht-conf — design spec + what the e2e demo proved

This is the consolidated design record of the cht-conf extension, validated
end-to-end: the full pipeline (research → HC1 → development → HC2 → QA
red→green → HC3) closed the loop live on a **real production partner
configuration** (reconstructed read-only onto a throwaway CHT 4.21.1
instance), fixing a real XLSForm skip-logic bug **at the `.xlsx` source**,
proving it at three levels (deployed-XML content, whole-document canonical
identity, real-Enketo harness), and handing back the corrected source plus
a regression spec that runs in the partner's own test suite.

## Design methodology: driven by a real private config repo

The extension was designed against, and continuously verified on, an actual
partner cht-conf project (full source handover: XLSForms, `tasks.js`,
`targets.js`, contact-summary, `app_settings/`, its own pinned
`cht-conf@3.21.4` + `cht-conf-test-harness@3.0.15` and mocha suite) —
never against toy fixtures alone. The discipline:

- **Reconstruct, don't touch production**: read-only
  `backup-app-settings`/`backup-all-forms` (or a source handover) →
  neutralized working copy (auth/branding/integrations stripped) → uploaded
  to a version-matched throwaway instance with config-conforming dummy data
  → the symptom reproduces exactly as in production.
- **Version parity everywhere**: the deployment-pinned cht-conf converts and
  uploads (env seam `CHT_CONF_BIN`), never the agent image's global one.
- **Ground truth over ticket prose**: every ticket claim is verified against
  the config source before development (the demo ticket's own framing was
  imprecise — the pipeline still landed the right fix because verification
  binds to the converted artifact, not the prose).
- **A CI-safe stand-in**: a pruned cht-core `config/default` with one
  planted xlsx-level bug mirrors the real engagement for rehearsal.

## Per-component extension inventory

### 1. Ticket contract & routing (landed with the #134 stack)
- Frontmatter taxonomy: `layer: cht-core|cht-conf|investigate`,
  `configArtifact` (form, contact-form, task, target, contact-summary,
  app-settings, …), `artifactName`, `chtConfVersion`, `deploymentRef` —
  single-sourced constants, schema defs, TEMPLATE worked example.
- **Frontmatter wins over inference** — a `layer: cht-conf` ticket routes
  deterministically, no LLM call.

### 2. Research supervisor
- **Code context**: layer-aware DeepWiki repo targeting (cht-conf corpus);
  **canonical diff** (`canonical-diff.ts`) against a known-good baseline
  (`CANONICAL_CONF`) pinpointing artifact drift when a baseline exists —
  a research aid, never the proof (real bugs have no baseline).
- **Config-aware similarity scoring** in context analysis.
- Known gaps, scoped as follow-ups: kapa doc-search returns cht-core
  analogs for config questions (mitigation: layer-aware query shaping); a
  `--triage` entry point that grounds RAW partner feedback in the local
  config (enumerate artifacts, locate each item, verdict
  CONFIRMED/PLAUSIBLE/NOT-FOUND with verbatim quotes) before any ticket is
  authored — this discipline, run manually, turned 8 items of raw partner
  feedback into 6 config-grounded tickets, one PLAUSIBLE mechanism, and one
  correctly-rejected non-bug.

### 3. Development supervisor & code generation
- **Layer-routed write target**: `resolveDevelopmentTarget(layer)` — a
  cht-conf ticket generates and writes into the mounted config repo
  (`CHT_CONF_PATH`), cht-core stays byte-identical.
- **The XLSForm orchestrator-editor** (the centerpiece): the sandboxed
  code-gen CLI (file tools only, no Bash) emits ONE structured **fix
  descriptor** (`.cht-agent/xlsform-fix.json`: survey-sheet edits + an
  `expect` oracle for the compiled bind); a **deterministic supervisor
  node** applies it to a temp copy of the `.xlsx` (exceljs, shared-string
  safe), runs an **offline `convert-app-forms`** with the deployment-pinned
  cht-conf, and asserts the regenerated bind + whole-document canonical
  invariance (attribute-order/multi-line-tag safe comparator) before
  anything reaches human review. HC2 shows a **bind-level diff**, and on
  approval the corrected `.xlsx` AND regenerated `.xml` land in the config
  repo — source and instance stay in lockstep.
- **Retry quality**: failed applies loop with the failure + previous
  descriptor threaded back; retries **resume the same CLI session**
  (`--resume`) with an explicit workspace-rolled-back notice; descriptor
  parsing is tolerant (fences/prose/BOM salvage, type coercion) so
  mechanical LLM slop costs warnings, not iterations; the deterministic
  apply verdict **outranks** the LLM validator's score; exhaustion is a
  loud NO-FIX stop (nothing staged, non-zero exit), never a silent segue.
- Iteration budget via `DEV_MAX_ITERATIONS` env.

### 4. Test generation
- For cht-conf form tickets, test-gen is **deterministic** (no LLM): it
  emits ONE `cht-conf-test-harness` spec into the partner repo's own
  `test/forms/` (house-pattern detected from their existing specs; never
  overwrites; scenario derived from the verified fix descriptor;
  sandbox-safe Chromium launch args merged at runtime). The durable
  "fails before the fix, passes after" artifact ships WITH the partner
  repo and runs in their suite.

### 5. Test environment layer (#66 base + cht-conf extension)
- Base (#66, standalone, config-agnostic): human-gated provision +
  readiness poll (agent runs no Docker), `discoverConfig` (settings +
  form revs → contact_types/roles/forms), `prepareTestData`
  (csv-to-docs/upload-docs/create-users with seeded-doc classification),
  `applyConfig` via cht-conf buckets, CouchDB-tier reset, teardown.
- cht-conf extension on top: **deployed-artifact verification**
  (`fetchFormXml` + pure XForm bind inspection with instance-root
  agnosticism and honest missing-`relevant` mismatches), the
  **config-type boundary guard** (form/contact-form fixable from a
  deployment; tasks/targets/contact-summary demand source — the `.xlsx`
  is unrecoverable from CouchDB), `CHT_CONF_BIN` version pin,
  `app-settings-only` recovery bucket, offline-convert sandbox, and the
  **tier-2 harness runner** (repo-pinned mocha over the affected form's
  spec, headless Chromium in-container).

### 6. QA closed loop (red → fix → verify)
Order enforced: provision → discover(pre) → **reproduce RED** (abort if the
symptom is not on the deployed config — "refusing to fix a non-reproduced
symptom") → HC3 human gate for the destructive seed/apply → apply
(convert+upload, per-form filtered, pinned binary) → discover(post,
rev-change corroboration) → **verify GREEN**. Three oracle levels:
1. **Target-bind assertion** threaded from the dev phase's verified fix
   (the fix defines the oracle; a deployed bind lacking the expected
   `relevant` reads as an honest mismatch).
2. **Whole-document canonical identity**: RED must differ from the
   corrected local form ONLY at the declared target (anything else aborts
   as environment drift); GREEN must be canonically identical — closes the
   blind-spot classes a bind-subset oracle can't see (measured: a subset
   oracle covered 9 of 121 skip-logic binds on a real form).
3. **Tier-2 behavioral**: the generated harness spec under real Enketo,
   folded into the loop's success verdict (opt-in flag).

### 7. Memory / seeding pipeline extension (planned — the context gap)
Today the context-analysis agent finds 0 similar issues for config tickets:
the seeded corpus is cht-core-only. The extension plan reuses the existing
scrape→filter→distill pipeline unchanged (schema already carries
`layer`/`configArtifact`/`mechanism` from the #134 stack; TEMPLATE already
has a cht-conf worked example):
- **Upstream corpus**: medic/cht-conf issues/PRs/wiki → a
  `domains/configuration` (+ forms-and-reports config-side) corpus.
- **Partner-private corpus**: point the same pipeline at the org's OWN
  config repo history — its issues, commit messages, and prior fixes —
  so the context-analysis agent recalls "we hit this exact `relevant`
  pattern in our own config last year" (kept in the org's private
  agent-memory, never published). This turns each deployment's operational
  history into first-class research context.
- Routing already honors the corpus split (`findResolvedIssuesByDomain`
  reads per-domain issue dirs).

### 8. Environment & sandbox (unchanged posture, extended toolchain)
The hardened agent container (no Docker socket, push-blocked git, read-only
OAuth) gains the deployment toolchain as image bakes: pinned-cht-conf
support (medic-pyxform for 3.x convert, `xsltproc` for harness 3.x form
loads, `NODE_OPTIONS --openssl-legacy-provider` for webpack-4 compile under
Node 22) and headless Chromium for the harness — none of it reachable as
new tools by the code-gen sandbox.

## Evidence
Six live runs on the reconstructed partner deployment hardened the design
(every failure became a shipped fix with adversarial review); the final run:
descriptor on iteration 1 → verified apply → RED (exactly the target bind,
whole-document confirmed) → apply → GREEN (10/10 binds + canonical
identity, form rev advanced) → tier-2 harness pass → corrected `.xlsx` +
`.xml` + regression spec delivered to the config repo. Workbench gates at
close: 1587 passing / 0 failing.

## Suggested PR sequencing from here
1. #66 test-environment layer (standalone, config-agnostic — out first).
2. cht-conf extension of the layer (verification primitives, config-type
   guard, tier-2 runner, offline convert).
3. QA supervisor wiring (#64 path: qa-workflow + orchestrator + CLI flags).
4. XLSForm orchestrator-editor (descriptor contract + editor + supervisor
   node + retry/exhaustion machinery).
5. Deterministic partner-harness test-gen.
6. Memory pipeline: cht-conf upstream corpus, then partner-private corpus.

---8<--- END OF #134 COMMENT ---8<---
