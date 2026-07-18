# Deliverable C — cht-conf feedback triage: provenance + open tickets

## 1. Provenance — CORRECTED (Hareet supplied the source, 2026-07-16)

The origin is **Maisha Meds meeting notes** from a Community Unit
revitalization meeting (five new CHPs recruited; under-5 medical outreach
camp), where CHPs raised **eight concerns** about the eCHIS platform. That
document was never persisted into these repos — the earlier archaeology
correctly found no trace of it — and the only written survivor of the
original triage is its item 5 (the PNC miscarriage skip-logic), which became
the **cht-conf worked example** in the #134 layer-taxonomy TEMPLATE (memory
`project_cht_conf_research_extension.md`: "TEMPLATE.md got
layer/configArtifact/mechanism + … a cht-conf worked example (PNC
miscarriage)") and then `demo-echis-pnc-ticket.md`.

The historical chain, as Hareet recalls it and the record corroborates at
both ends: the items were **first mishandled as cht-core tickets** → that
mistake motivated **creating the cht-conf layer** (#134: frontmatter
routing, config artifacts, canonical diff) → items were re-triaged conf vs
not → item 5 was authored into the demo ticket and driven through the full
closed loop against the reconstructed eCHIS deployment
(`moh-kenya/config-echis-2.0`, custom 4.21.1 fork).

The full eight-item triage below is the 2026-07-16 **re-analysis** (the
original was lost), grounded in the actual eCHIS config we now know well.

## 1a. The eight Maisha Meds items — re-triaged

| # | Feedback (abridged) | Layer verdict | Rationale |
|---|---|---|---|
| M1 | System unresponsive/slow; CHPs abandon households mid-collection | **investigate** (perf; likely split) | Could be cht-core webapp/rules-engine, device class, server infra — OR config-induced (expensive `tasks.js`/contact-summary evaluated per contact). Needs profiling before a layer is assigned; the config's task/contact-summary complexity is a first-class suspect. |
| M2 | CHA has no dashboard to monitor CHP tasks; manual spreadsheet | **split**: cht-conf (partial, now) + cht-core (feature) | CHT config already supports supervisor **aggregate targets** for CHA-type roles — a config change delivers visibility quickly. A true task-management dashboard is a cht-core/product feature request upstream. |
| M3 | Creating a child PNC follow-up task duplicates it up to ×10 | **cht-conf** (app-settings/tasks) | Classic per-report task-emission shape. We have direct evidence the config's PNC family re-emits event series per qualifying report (`postnatal_care_yields_postnatal_care` re-anchors off every report); the newborn variant plausibly multiplies tasks across reports when `resolvedIf` windows don't dedupe. High-value, likely surgical. |
| M4 | Fully-immunized children flagged for defaulter tracing | **cht-conf** (app-settings: tasks/contact-summary) | Schedule-completeness logic bug in the immunization defaulter rules — config code, not platform. |
| M5 | PNC miscarriage skip-logic — keeps prompting next PNC visit date | **cht-conf (form) — FIXED** | The demo ticket. Fixed at the `.xlsx` source, three-tier verified; PR package ready (`pnc-fix-pr-package.md`). |
| M6 | Child records only to age 5; age doesn't auto-update | **cht-conf** (forms + contact_types), verify | CHT derives age from `date_of_birth` — a non-updating age almost always means the registration form captured a static age integer instead of DOB, and the under-5 cutoff lives in form-context `ageInYears(contact) <= 5` expressions. Both are config. Verify in the config before ticketing as core. |
| M7 | Child registration asks contradictory questions (orphan after both parents captured) | **cht-conf** (form) | `relevant`-expression bug in the household/child registration form — the same class as M5, and the best candidate for the **next full agent-loop run**. |
| M8 | "Level of Education" field validation/functionality errors | **cht-conf** (form) | Constraint/choices-list bug in a registration form. |

Scorecard: **6 of 8 land in the cht-conf layer** (M3–M8, with M6 to verify),
one is an investigation (M1), one splits config-now/core-later (M2) — which
is the empirical justification for having built the cht-conf layer at all.

## 1b. GROUNDED tickets (config-verified 2026-07-16 — full ticket files in `tickets/`)

Every claim below was verified against the actual config (verbatim binds +
file:line) before ticket authoring — the discipline the T9 `--triage` mode
will automate. Grounding verdicts:

| Item | Verdict | Ticket file |
|---|---|---|
| M3 | PLAUSIBLE (10× count is runtime) — but grounding found a **confirmed resolution defect**: resolver form-id typo `posnatal_…` at `tasks.js:1368` + missing `sourceID` dedup, vs the correct mother-side pattern | `tickets/maisha-m3-newborn-pnc-task-duplication.md` |
| M4 | **CONFIRMED-IN-CONFIG** — `!==` length comparison across divergent counting functions (`contact-summary.templated.js:175`, `tasks.js:1329`); correct coverage predicate already exists at `:458-460`; bonus: dead predicate at `tasks.js:1007` | `tickets/maisha-m4-immunization-defaulter-false-positive.md` |
| M6 | **NOT-FOUND — misunderstanding.** DOB is captured (`f_client-create.xml:19261-19266`), age derives live (`contact-summary.templated.js:160-161`), and the age-5 boundary is the automatic u5→over-5 assessment handoff, not a record cap. **No ticket** — respond to the partner explaining the assessment-form switch; only residue is the stale `age_in_years` snapshot on docs (cosmetic). |
| M7 | **CONFIRMED-IN-CONFIG** — `is_orphan` gated only on age (`e_household-create.xml:21441`, `f_client-create.xml:19317`), ignoring captured `father_alive`/`mother_alive` (:21329-21330) / caregiver selections | `tickets/maisha-m7-orphan-question-relevant.md` |
| M8 | **CONFIRMED-IN-CONFIG** — choice-filter expression mis-mapped into the `calculate` of a required select (`f_client-create.xml:19310`; same defect on occupation :19313; clean reference at `e_household-create.xml:21444`) | `tickets/maisha-m8-education-field-calculate.md` |

Pipeline note: M7/M8 are **contact forms** — the Mission-05 apply/verify
machinery currently targets `forms/app/` app forms; a small contact-form
extension (artifact paths + `contact-forms` QA bucket + verify oracle) is
the prerequisite to run them through the full closed loop. M3/M4 are
JS-artifact fixes (tasks/contact-summary): the dev phase edits them as
plain text (no xlsx trap), and the partner suite's `test/tasks/` +
`test/contact-summary.spec.js` are the regression oracle — the QA
deployed-artifact oracle only covers forms today.

### Superseded inline drafts (kept for history — the ticket files above are canonical)

**M3 — duplicated PNC child follow-up tasks**
```yaml
title: "Child PNC follow-up task is duplicated up to 10 times"
type: bug
priority: high
domain: tasks-and-targets
layer: cht-conf
configArtifact: app-settings
artifactName: tasks-newborn-pnc-follow-up
chtConfVersion: "3.21.4"
deploymentRef: "/workspace/cht-conf-project"
```
Reported: creating a follow-up task for a child under the PNC module
duplicates the task (up to ten instances). Suspect: per-report event
re-emission in the PNC task templates without cross-report resolution.

**M4 — immunization defaulter false positives**
```yaml
title: "Fully-immunized children incorrectly flagged for defaulter tracing"
type: bug
priority: high
domain: tasks-and-targets
layer: cht-conf
configArtifact: app-settings
artifactName: tasks-immunization-defaulter
chtConfVersion: "3.21.4"
deploymentRef: "/workspace/cht-conf-project"
```

**M6 — static child age / under-5 cutoff** *(verify in config first)*
```yaml
title: "Child age does not update over time and records cut off at age 5"
type: bug
priority: medium
domain: contacts
layer: cht-conf
configArtifact: form
artifactName: child-registration
chtConfVersion: "3.21.4"
deploymentRef: "/workspace/cht-conf-project"
```

**M7 — contradictory orphan question** *(recommended next agent-loop run)*
```yaml
title: "Child registration asks orphan status after both parents' details are captured"
type: bug
priority: medium
domain: forms-and-reports
layer: cht-conf
configArtifact: form
artifactName: <household/child registration form — identify in config>
chtConfVersion: "3.21.4"
deploymentRef: "/workspace/cht-conf-project"
```

**M8 — Level of Education validation**
```yaml
title: "'Level of Education' field has validation/functionality errors blocking accurate entry"
type: bug
priority: medium
domain: forms-and-reports
layer: cht-conf
configArtifact: form
artifactName: <registration form carrying the education field>
chtConfVersion: "3.21.4"
deploymentRef: "/workspace/cht-conf-project"
```

**M1 — performance investigation** (`layer: investigate` — routes to the
investigation path, not config dev) and **M2 — CHA visibility** (two
artifacts: a cht-conf aggregate-targets ticket + an upstream cht-core
feature request) — draft on request once M1's profiling scope and M2's
target split are agreed.

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
