---
title: PNC follow-up prompts after miscarriage
type: bug
priority: high
domain: forms-and-reports
layer: cht-conf
configArtifact: form
artifactName: pnc_followup
chtConfVersion: 3.21.0
deploymentRef: medic/standard
---

## Description

The PNC follow-up form keeps prompting for the next visit date after a miscarriage is recorded.

## Technical Context

- `forms/app/pnc_followup.xlsx`

## Requirements

- Suppress the next-visit-date question when the outcome is a miscarriage

## Acceptance Criteria

1. No next-visit prompt appears for a miscarriage outcome
