---
title: "Child PNC follow-up tasks accumulate as duplicates (reported up to ten instances)"
type: bug
priority: high
domain: tasks-and-targets
layer: cht-conf
configArtifact: task
artifactName: newborn-immunization-followup
chtConfVersion: "3.21.4"
deploymentRef: "/workspace/cht-conf-project"
---

## Description

CHPs report that creating a follow-up task for a child under the PNC module
duplicates the task multiple times — up to ten instances for one child. The
duplicate tasks pile up instead of resolving when the follow-up visit is
submitted.

## Technical Context

- The newborn immunization follow-up task (`tasks.js:1341-1370`) is
  report-based (`appliesTo: 'reports'` on `postnatal_care_service_newborn`),
  so one task is emitted per qualifying report — and the newborn home-visit
  form is designed to be submitted repeatedly.
- Its `resolvedIf` (`tasks.js:1368`) is broken twice over:
  1. it resolves against a **misspelled form id** —
     `posnatal_care_service_newborn` (missing the second "t") — which can
     never match a real submission of `postnatal_care_service_newborn`;
  2. it omits the `sourceID` (6th) argument to
     `isFormArraySubmittedInWindow`, so there is no per-source dedup
     (`nools-extras.js:27-34` only dedups when `sourceID` is passed).
- The mother-side template shows the correct pattern: `tasks.js:207-215`
  passes `report._id` as `sourceID` and resolves against the correctly
  spelled form.

## Requirements

- Correct the resolver form id at `tasks.js:1368`
  (`posnatal_` → `postnatal_`).
- Pass `report._id` as the `sourceID` argument in the newborn report-based
  task templates so each task resolves against its own source report,
  mirroring the mother template (`tasks.js:207-215`).

## Acceptance Criteria

- Submitting the newborn PNC follow-up form resolves the task that prompted
  it; repeated newborn PNC reports for the same child no longer accumulate
  unresolved duplicate tasks.
- The mother-side PNC follow-up series behaves exactly as before (no
  regression).
- Task emission for genuinely distinct follow-up needs (different children,
  new qualifying reports after resolution) is unchanged.

## Constraints

- Surgical: only the newborn report-based templates' `resolvedIf` calls
  change; no schedule/event changes.
- Note for QA: the reported "up to ten" multiplier is a runtime property
  (per-report emission × unresolved accumulation) — reproduction needs an
  instance with multiple newborn PNC reports for one child; the config-level
  proof is the typo + missing sourceID above. The partner repo's own
  `test/tasks/` suite is the regression surface.
