---
id: cht-core-6383
category: bug
domain: messaging
domainFit: strong
issueNumber: 6383
issueUrl: https://github.com/medic/cht-core/issues/6383
title: Use correct SMS template context (including patient info) when generating message content in webapp and Sentinel due tasks
lastUpdated: '2026-06-23'
summary: SMS content generated for due/scheduled tasks in the webapp and Sentinel omitted patient information from its template context, so messages referencing patient fields rendered with missing data. Fixed by building the correct context (with patient data) in both the webapp's format-data-record service and Sentinel's due_tasks schedule, matching the behavior admin already had.
services:
  - webapp
  - sentinel
techStack:
  - typescript
  - javascript
  - angular
  - nodejs
tags:
  - sms
  - due-tasks
  - scheduled-messages
  - template-context
  - patient-context
  - message-generation
related_workflows:
  - message-processing
source_pr: medic/cht-core#9022
source_sha: 2e1a05ff17c9e15c8702790ff949c7028c36f343
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/transitions/src/schedule/due_tasks.js
  - webapp/src/ts/services/format-data-record.service.ts
concepts:
  - SMS message template context
  - scheduled messages / due tasks processing
  - patient context resolution for message rendering
  - message body templating
related_issues: []
stale: false
---

## Problem

When generating SMS content for due/scheduled tasks, the webapp (format-data-record service) and Sentinel (due_tasks schedule) built a template context that did not include patient information. Messages whose templates referenced patient fields therefore rendered with missing or incorrect patient data.

## Root Cause

The SMS-content generation paths in webapp and Sentinel constructed the template context without resolving/attaching the patient document, unlike the admin path which already built the context correctly. The patient context was simply absent from these two code paths.

## Solution

Updated shared-libs/transitions/src/schedule/due_tasks.js (Sentinel) and webapp/src/ts/services/format-data-record.service.ts (webapp) to assemble the correct template context including patient information before rendering SMS message bodies, aligning their behavior with the already-correct admin path.

## Code Patterns

Resolve and include the patient document/fields in the template context prior to rendering SMS message bodies (shared-libs/transitions/src/schedule/due_tasks.js, webapp/src/ts/services/format-data-record.service.ts) so message templates referencing patient fields populate correctly.

## Design Choices

Fixed the two divergent paths to match admin's correct context construction. Consolidating context generation into shared code was considered; the change prioritizes correctness across webapp and Sentinel rather than fully unifying the code.

## Related Files

- shared-libs/transitions/src/schedule/due_tasks.js
- shared-libs/transitions/test/unit/due_tasks.js
- tests/e2e/default/reports/sms-messages.wdio-spec.js
- tests/integration/sentinel/schedules/due-tasks.spec.js
- webapp/src/ts/services/format-data-record.service.ts
- webapp/tests/karma/ts/services/format-data-record.service.spec.ts

## Testing

Added/updated unit tests for the Sentinel due_tasks schedule (shared-libs/transitions/test/unit/due_tasks.js) and the webapp format-data-record service (webapp/tests/karma/ts/services/format-data-record.service.spec.ts), plus an e2e spec for SMS messages (tests/e2e/default/reports/sms-messages.wdio-spec.js) and a Sentinel integration spec for due-tasks schedules (tests/integration/sentinel/schedules/due-tasks.spec.js).

## Related Issues

- #6383: Incorrect SMS context — patient information missing when generating SMS content in webapp and Sentinel due tasks

## Domain Rationale

**Fit:** strong

The PR fixes the template context used when generating SMS message content in both the webapp and Sentinel's due_tasks schedule; SMS content/delivery anchors it in the messaging domain even though 'due tasks' (scheduled messages) are involved as a secondary concern.
