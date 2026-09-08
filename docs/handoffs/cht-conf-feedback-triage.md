# Deliverable C — cht-conf feedback triage: provenance + open tickets

## 1. Provenance

The tickets below derive from partner CHP feedback collected during a
recent community-unit meeting (source notes held by the engagement owner;
not reproduced here).

## 2. Ready-to-file tickets (genuinely OPEN cht-conf-layer items)

Shipped work is listed in §3 to prevent re-cutting. Frontmatter follows the
`demo-echis-pnc-ticket.md` shape; these are workbench-tooling tickets
(consider rolling them into the #134 "extend research supervisor to
cht-conf" epic instead of filing individually — Hareet's call).

### T1 — No-git snapshot/rollback fallback (gaps-plan #1(b))
```yaml
title: "Code-gen snapshot/rollback must support git-less cht-conf partner repos"
type: improvement
priority: high
domain: configuration
layer: cht-conf
```
`snapshotChtCore` (`claude-code-cli/workspace.ts:71`) throws on non-git
targets; the demo used operator `git init` as the workaround. Durable fix:
file-copy snapshot + canonical-diff verification when
`git rev-parse --is-inside-work-tree` fails.

### T2 — Pre-development reproduce (RED) gate (gaps-plan #3(a))
```yaml
title: "Add a pre-development reproduce gate for layer:cht-conf + --qa runs"
type: improvement
priority: medium
domain: configuration
layer: cht-conf
```
After HC1: `discoverConfig` + fetch the deployed form and assert the
symptom exists before any code-gen (building blocks: `fetchFormXml`,
`verifyArtifact`). Demo used the runbook's manual curl pre-check.

### T3 — Layer-aware doc-search query shaping (gaps-plan #4(a))
```yaml
title: "Doc-search: append XLSForm/cht-conf terms + artifact name when layer:cht-conf"
type: improvement
priority: low
domain: configuration
layer: cht-conf
```

### T4 — Dev-phase no-op fix warning (new, from the 4th live run)
```yaml
title: "applyXlsformFix: warn loudly at HC2 when before === after (nothing to fix)"
type: improvement
priority: medium
domain: configuration
layer: cht-conf
```
When the descriptor sets a value the workbook already carries, the apply
"verifies" a no-op and the run only fails much later at QA reproduce
("symptom did not reproduce"). Surface "target bind already carries the
expected relevant — the bug may already be fixed in this working copy" at
HC2.

### T5 — Strict CLI flag validation (new, from the 5th live run)
```yaml
title: "full/dev CLIs: reject unknown --qa-* flags instead of silently ignoring"
type: improvement
priority: low
domain: infrastructure
layer: cht-conf
```
`--qa-tier-2` (typo) was silently dropped; tier-2 never ran and nothing said
so.

### T6 — Surface real CLI errors (new, cosmetic-but-costly)
```yaml
title: "claude-cli provider: propagate stderr/result on nonzero exit (no more 'Claude CLI error: undefined')"
type: improvement
priority: low
domain: infrastructure
layer: cht-conf
```

### T9 — `--triage` parameter: config-grounded triage mode (NEW, from the Maisha re-triage)
```yaml
title: "Add --triage: Research Supervisor mode that grounds raw feedback in the local config before authoring"
type: feature
priority: medium
domain: configuration
layer: cht-conf
```
Motivation: the original Maisha triage mishandled config bugs as cht-core
tickets, and the re-triage had to be done by hand against the config. A
`--triage <feedback.md>` entry point takes RAW feedback text (not a formed
ticket), and — before claiming any knowledge of a description or fix —
first **identifies the local config**: enumerate `CHT_CONF_PATH` artifacts
(forms, tasks.js templates, contact-summary context, contact_types), locate
the artifacts each feedback item touches (grep + read, the way this
session's grounding pass worked), and only then emit per-item verdicts
(layer, configArtifact, artifactName, confidence, verbatim-quoted evidence)
plus ready-to-run ticket drafts in the demo-ticket shape. Items whose
artifacts can't be located get `layer: investigate`, never a guessed config
claim. Builds on / subsumes the parked T8 `local-config-context` node; the
HC gate shows the triage table for human confirmation before any tickets
are written.

### Backlog (explicitly deferred/parked by Hareet — file as backlog, not active)
- **T7** cht-conf corpus via the seeder pipeline (medic/cht-conf issues/PRs/
  wiki → agent-memory) — gaps-plan #4(b), "later goal".
- **T8** `local-config-context` research node (read `CHT_CONF_PATH` form
  XML/XLSX + app_settings, one reconciliation inference) — gaps-plan #5,
  "parked".

### Needs confirmation before filing
- **`tickets/demo-pnc-relevant.md`** (pregnancy_home_visit danger-signs after
  miscarriage) is a fully-formed sibling ticket — but its
  `chtConfVersion: 6.5.0` / `deploymentRef: demo/config-pnc-demo` mark it as
  the demo *fixture* scenario, not an eCHIS report. Confirm it's a real
  partner bug before filing upstream.
- **Sibling designs with their own drafts** (file in their target repos, not
  here): `designs/issue-cht-ai-tools-reconstruct-rules-skill.md`
  (medic/cht-ai-tools) and `designs/issue-cht-agent-tasks-targets-memory.md`
  (medic/cht-agent memory pipeline).

## 3. Already shipped — do NOT re-ticket

Mission 05 (P0–P7, `feat/mission-05-xlsform-orchestrator`) and follow-ups
F1–F9, all recorded with gates in
`docs/handoffs/mission-05-followup-fixes-plan.md`: canonical collateral
oracle (F1), root-agnostic binds (F2), retry feedback threading (F3),
exhaustion hard stop (F4), bindDiff QA oracle (F5), whole-document oracle
(F6), partner harness spec + `--qa-tier2` (F7), retry session-resume /
descriptor tolerance / apply-first gating / `DEV_MAX_ITERATIONS` (F8),
sandbox-safe emission + tier-2 visibility + honest score (F9), plus the
image bakes (Chromium rev-901912, medic-pyxform, xsltproc) and the compose
demo env block. Also superseded: the xml-only apply bucket (gaps-plan #2(a))
— made unnecessary by Mission 05.

## 4. Partner-facing decisions (travel with the PR — see pnc-fix-pr-package.md)

1. Optional MCH-booklet next-appointment capture on follow-up visits
   (post-fix the field is gone from follow-ups; nothing in-config consumes
   it, but downstream analytics might).
2. `has_pnc_up_to_date` is disabled (`relevant="false()"`) while its task
   rule survives — re-enable the question or retire the dead rule.
