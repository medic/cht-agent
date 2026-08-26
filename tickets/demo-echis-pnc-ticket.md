---
title: "Postnatal care keeps prompting for the next PNC visit date after a miscarriage"
type: bug
priority: high
domain: forms-and-reports
layer: cht-conf
configArtifact: form
artifactName: postnatal_care_service
chtConfVersion: "3.21.4"
deploymentRef: "/workspace/cht-conf-project"
---

## Description

The Postnatal care (PNC) module has a skip-logic error: when the pregnancy
outcome is recorded as a **miscarriage**, the form still prompts for the **next
PNC visit date**. Once the pregnancy has ended in a miscarriage, scheduling a
next PNC visit is clinically irrelevant and must be skipped — the same way it is
skipped for the other pregnancy-ended outcomes.

## Technical Context

- Form: `forms/app/postnatal_care_service.xml` (source: `forms/app/postnatal_care_service.xlsx`).
- The next-PNC-visit-date question's `relevant` no longer excludes the
  miscarriage outcome. Gate it on the field that records the PNC/pregnancy
  outcome so the miscarriage case is excluded (mirror the sibling questions that
  already skip for a pregnancy-ended outcome).

## Requirements

- The next-PNC-visit-date question must NOT be shown when the outcome is miscarriage.
- Fix the `relevant` in the xlsx `survey` sheet, then regenerate the XML with
  `cht convert-app-forms` so the shipped `.xml` matches the source.

## Acceptance Criteria

- Recording a miscarriage no longer prompts for the next PNC visit date.
- A non-miscarriage outcome still prompts for the next PNC visit date (no regression).
- Sibling questions/groups in the form are unchanged.

## Constraints

- Keep the change surgical: only the next-PNC-visit-date `relevant` changes.
