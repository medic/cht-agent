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

When generating SMS content for due/scheduled tasks, the webapp (format-data-record service) and Sentinel (due_tasks schedule) added the patient/place to the template context only when a shortcode id was present on the report's `fields`. Reports that had been hydrated with `doc.patient`/`doc.place` but carried no `fields.patient_id`/`fields.place_id` got a context with no patient (Sentinel: an entirely `undefined` context), so templates referencing patient fields rendered with missing data.

## Root Cause

Both paths already attached `patient: doc.patient` and `place: doc.place` — but only when a shortcode id was present on the doc's `fields`. In shared-libs/transitions/src/schedule/due_tasks.js, `getTemplateContext` short-circuited with `return Promise.resolve();` (an **undefined** context) whenever neither `doc.fields.patient_id` nor `doc.fields.place_id` was set, even though the doc had already been hydrated with `doc.patient`/`doc.place`. In webapp/src/ts/services/format-data-record.service.ts, `context.patient` was gated on `if (patientId)` where `patientId = doc.patient_id || doc.fields?.patient_id`, so a hydrated `doc.patient` whose shortcode lived only at `doc.patient.patient_id` never reached the context. The fix moves `patient`/`place` out of the conditional (Sentinel), re-gates on `if (doc.patient)` / `if (doc.place)` (webapp), and falls back to `doc.patient?.patient_id` / `doc.place?.place_id` when looking up registrations.

## Solution

Updated shared-libs/transitions/src/schedule/due_tasks.js (Sentinel) and webapp/src/ts/services/format-data-record.service.ts (webapp) to assemble the correct template context including patient information before rendering SMS message bodies, aligning their behavior with the already-correct admin path.

## Code Patterns

Key the template context off the *already-hydrated* doc (`patient: doc.patient`, `place: doc.place`, built unconditionally) rather than off the presence of a shortcode id, and treat the shortcode as a fallback used only for registration lookups (`doc.fields?.patient_id || doc.patient?.patient_id`, likewise for place) — shared-libs/transitions/src/schedule/due_tasks.js and webapp/src/ts/services/format-data-record.service.ts, whose gates became `if (doc.patient)` / `if (doc.place)`.

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
