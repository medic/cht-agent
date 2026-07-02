---
id: cht-core-8676
category: improvement
domain: contacts
domainFit: strong
issueNumber: 8676
issueUrl: https://github.com/medic/cht-core/issues/8676
title: Add telemetry events to contact forms in the contacts-edit component
lastUpdated: '2026-06-23'
summary: Contact form interactions in the contacts-edit component were not instrumented, leaving no telemetry data on contact form load/save behavior. This PR adds telemetry events to record that data, with unit tests updated to cover the new instrumentation.
services:
  - webapp
techStack:
  - typescript
  - angular
  - karma
tags:
  - telemetry
  - observability
  - contact-forms
  - instrumentation
  - chore
related_workflows:
  - observability
  - contact-creation
source_pr: medic/cht-core#8676
source_sha: c34e12bab600b3e8cb3c8d8624cc6e2c0e799803
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/contacts/contacts-edit.component.ts
concepts:
  - telemetry instrumentation
  - observability
  - performance monitoring
  - Angular component lifecycle instrumentation
related_issues: []
stale: false
---

## Problem

The contacts-edit component (used to create and edit contacts) recorded no telemetry, so there was no data on contact form lifecycle events such as form load/render and save timings. This made it hard to monitor and optimize contact form performance and usage.

## Root Cause

No telemetry/instrumentation hooks existed in contacts-edit.component.ts; telemetry events were simply never recorded for the contact form lifecycle.

## Solution

Added telemetry events to contacts-edit.component.ts to record telemetry data for contact form interactions (e.g. form render and save), wiring the change through the CHT telemetry service, and updated the corresponding Karma unit tests to assert the events are recorded.

## Code Patterns

Inject the telemetry service into an Angular component and record events at form lifecycle points (load/render, save) to capture performance/usage metrics — pattern applied in webapp/src/ts/modules/contacts/contacts-edit.component.ts and asserted in webapp/tests/karma/ts/modules/contacts/contacts-edit.component.spec.ts.

## Design Choices

Telemetry was recorded directly within the component at form lifecycle points and validated with unit tests only. Reviewers (garethbowen) raised whether end-to-end testing of the full stack was warranted, and the team (tatilepizs) discussed standardizing a rule that webapp file changes should always add tests; the PR was approved on unit-test coverage with e2e left as optional follow-up.

## Related Files

- webapp/src/ts/modules/contacts/contacts-edit.component.ts
- webapp/tests/karma/ts/modules/contacts/contacts-edit.component.spec.ts

## Testing

Added/updated Karma unit tests in contacts-edit.component.spec.ts to verify the new telemetry events are recorded. Reviewers discussed but did not require end-to-end testing for this instrumentation change; approved with unit-test coverage.

## Related Issues

- #8433: add telemetry events to contact forms

## Domain Rationale

**Fit:** strong

The entire diff instruments the contacts-edit component (webapp/src/ts/modules/contacts/contacts-edit.component.ts) with telemetry for contact form interactions, living wholly within the contacts module; the cross-cutting observability nature is captured in relatedWorkflows rather than reassigning the domain.
