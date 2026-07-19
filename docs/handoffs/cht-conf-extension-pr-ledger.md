# cht-conf extension — small-PR ledger (living doc)

Tracks every small PR to carve out for the eventual cht-conf-extension PR
train, across (a) the already-shipped Mission-05 stack awaiting carve-out
(`demo-branch-flow.md` "future small PRs"), and (b) the
all-config-artifacts phases (`all-config-artifacts-pipeline-plan.md`)
being implemented on stacked local branches in the 2026-07-18 run.
Commits are local-only (Co-Authored-By; never pushed) — Hareet pushes and
opens PRs manually when ready.

Suggested landing order follows `134-cht-conf-extension-spec.md`
§"Suggested PR sequencing": #66 base layer → cht-conf layer extension →
QA wiring → orchestrator → test-gen → memory pipeline.

## A. Mission-05 stack carve-outs (code exists on `feat/mission-05-xlsform-orchestrator`; needs splitting)

| # | PR | Contents | Status |
|---|---|---|---|
| A1 | mission-05 core | P1–P7: xlsform-editor, descriptor schema, offline convert runner, applyXlsformFix node, HC2 bind-diff, CLI wiring | code shipped on branch; carve-out pending |
| A2 | F1+F2 | canonical collateral oracle + root-agnostic bind extraction | same |
| A3 | F3+F8 | retry feedback threading; session-resume, descriptor tolerance, apply-first gating, `DEV_MAX_ITERATIONS` | same |
| A4 | F4 | exhaustion hard stop (loud NO-FIX) | same |
| A5 | F5+F6 | bindDiff-driven QA oracle; whole-document oracle | same |
| A6 | F7+F9 | partner harness spec gen + `--qa-tier2`; sandbox-safe emission, tier-2 visibility, honest score | same |
| A7 | infra | Dockerfile Chromium/pyxform/xsltproc bakes, compose demo env block, runbook/DEMO-STEPS docs | same |
| A8 | G2 mirror | `feat/dev-target-layer-routing` (layer-routed write target) | branch to create |
| A9 | G1 mirror | `feat/qa-orchestration` (qa-workflow + orchestrator + CLI flags; G3 `feat/qa-form-verify` already exists off #66) | branch to create |

## B. All-config-artifacts phases (this run, stacked local branches)

| # | PR / branch | Contents | Status |
|---|---|---|---|
| B1 | `feat/all-artifacts-p1p2-bind-oracle` | **P1** contact-form parity in the XLSForm orchestrator (routing gate, `form-paths` resolver, contact-forms offline convert bucket, prompts, deterministic-test-gen guard for contact forms) + **P2** generalized bind oracle (`expect.attrs` incl. absence, editor `clear` + calculate-type guardrail, inspector `extractBindAttr`/attrs-aware `verifyFormBinds`, schema + tolerant-parse update) + review hardening (resolver-driven HC2/summary display, unchanged-relevant spec-gen skip) | **LANDED** `8d52006` (2026-07-18) — 1630 tests |
| B2 | `feat/all-artifacts-p3-contact-form-qa` | **P3** QA closed loop for contact-form: `VerifyArtifactType` union, `deriveVerifyOptions`/guards, `deployedFormId` mapping (`e_household-create` → `contact:e_household:create`), `contact-forms` apply bucket, F6 oracle path, formVersions rev-key fix; live-smoked against the running 4.21.1 (M7 RED honest) | **LANDED** `607ce63` (2026-07-18) — 1646 tests |
| B3 | `feat/all-artifacts-p4-compiled-settings-oracle` | **P4** compiled-settings byte-oracle for task/target/contact-summary/app-settings: COMPILE verb (`NODE_OPTIONS=--openssl-legacy-provider`, sandbox node_modules symlink), `compiled-settings` util + comparator (compiled-keys-only scope, permissions rule — from the normalization spike), `app-settings` apply bucket mapping, settings-doc rev corroboration. Deferred within P4: git-baseline drift guard (RED = differs-from-corrected suffices for reproduce) | in progress (2026-07-18 run) |
| B4 | `feat/all-artifacts-p5-tier2-testgen` | **P5** tier-2 spec selection per artifact (`qaSpecs` frontmatter), contact-form fill-based generated spec, house-pattern LLM test-gen for JS artifacts | NOT this run (demo-optional) — do after demo |
| B5 | (docs, rolling) | P6: fixtures land with B1–B3; runbook updates (`maisha-demo-runbook.md` manual steps collapse to `--qa`); cht-conf version-pin note (installed 3.21.5 vs frontmatter 3.21.4) | rolling |

## C. Deferred / backlog (tracked, deliberately not in the train yet)

- T1 no-git snapshot fallback; T2 pre-dev reproduce gate; T3 doc-search
  query shaping; T4 no-op-fix HC2 warning; T5 strict CLI flag validation;
  T6 CLI error propagation; T9 `--triage` mode (all in
  `cht-conf-feedback-triage.md` §2).
- Memory pipeline: cht-conf upstream corpus (T7), partner-private corpus,
  local-config context node (T8).
- `canonical-diff.ts` artifact-path generalization (research aid only).
- Multi-form fix descriptors (M7's three-form scope — three single-form
  runs instead, by design).

## Run log

- **2026-07-18**: step-0 baseline commits on
  `feat/mission-05-xlsform-orchestrator` (hygiene sweep; Maisha docs +
  tickets + this ledger). B1–B3 implemented this run — statuses updated
  in place as they land.
