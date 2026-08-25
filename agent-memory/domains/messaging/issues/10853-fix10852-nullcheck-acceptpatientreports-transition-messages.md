---
id: cht-core-10852
category: bug
domain: messaging
domainFit: strong
issueNumber: 10852
issueUrl: https://github.com/medic/cht-core/issues/10852
title: Null-check optional `messages` property in accept_patient_reports transition
lastUpdated: '2026-07-30'
summary: The accept_patient_reports transition threw a TypeError when a form configuration omitted the documented-optional `messages` property. The fix guards against an undefined `messages` array so the field can be safely absent.
services:
  - sentinel
techStack:
  - javascript
  - nodejs
  - mocha
tags:
  - transitions
  - accept_patient_reports
  - nullcheck
  - patient-reports
  - error-handling
  - optional-config
  - messages
  - sentinel
related_workflows:
  - message-processing
  - form-submission
source_pr: medic/cht-core#10853
source_sha: 8e407fc94470e6107388da5059921bd72d34f28d
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/transitions/src/transitions/accept_patient_reports.js
concepts:
  - sentinel transition pipeline
  - defensive null-checking
  - optional configuration handling
  - acknowledgement message generation
related_issues: []
stale: false
---

## Problem

Enabling the accept_patient_reports transition with a minimal form configuration (e.g. `{ form: '<name>' }`) and no `messages` property caused sentinel to crash when a matching report was created. Sentinel logs showed `TypeError: Cannot read properties of undefined (reading 'forEach')`, even though the `messages` property is documented as optional in the patient_reports app-settings reference.

## Root Cause

The transition iterated over the configured `messages` array (via `.forEach`) without verifying it was defined. Because `messages` is an optional field in the patient_reports configuration, a config that omitted it left `messages` undefined, and calling `forEach` on undefined threw a TypeError, aborting the transition.

## Solution

Added a null/guard check around the `messages` configuration in accept_patient_reports.js so the code no longer assumes the array is present — it treats a missing `messages` as having no messages to add rather than dereferencing undefined, aligning runtime behavior with the documented optionality.

## Code Patterns

Guard optional config arrays before iterating (e.g. default to an empty array `(config.messages || [])` or skip the loop when undefined) in shared-libs/transitions/src/transitions/accept_patient_reports.js — a reusable defensive pattern for any transition reading optional app-settings fields.

## Design Choices

Chose a minimal, targeted null-check that conforms code to the existing documented contract (messages is optional) rather than making the field required or changing the docs, preserving backwards compatibility with existing configurations.

## Related Files

- shared-libs/transitions/src/transitions/accept_patient_reports.js
- shared-libs/transitions/test/unit/transitions/accept_patient_reports.js

## Testing

Added/updated a unit test in shared-libs/transitions/test/unit/transitions/accept_patient_reports.js covering a configuration without the `messages` property, asserting the transition no longer throws. Reviewed and approved (LGTM) by witash.

## Related Issues

- #10852: accept_patient_reports transition throws TypeError ('Cannot read properties of undefined (reading forEach)') when the optional messages config property is missing

## Domain Rationale

**Fit:** strong

The accept_patient_reports transition exists to generate and send acknowledgement messages in response to incoming patient reports, and the bug is squarely in that outgoing-message code path (the optional `messages` config). It touches the report-processing pipeline too, but the broken functionality is message generation, so messaging is the most specific fit.
