---
id: cht-core-9467
category: bug
domain: messaging
domainFit: strong
issueNumber: 9467
issueUrl: https://github.com/medic/cht-core/issues/9467
title: Better handling of RapidPro broadcast error codes to stop message retries and prevent duplication
lastUpdated: '2026-06-22'
summary: Outgoing SMS to invalid phone numbers (RapidPro 400) were retried indefinitely and valid messages (RapidPro 200 without a status) were duplicated in TextIt/RapidPro. The fix maps a 400 broadcast response to a terminal 'failed' state and a 200-without-status response to 'queued'.
services:
  - api
techStack:
  - javascript
  - nodejs
  - mocha
  - webdriverio
tags:
  - sms
  - rapidpro
  - textit
  - message-status
  - error-handling
  - retry
  - duplication
  - gateway
  - broadcast
related_workflows:
  - message-processing
source_pr: medic/cht-core#9559
source_sha: da4b50f71468b2576636e4c588c0c962c76689bc
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/rapidpro.js
concepts:
  - SMS gateway integration
  - outbound messaging state machine
  - HTTP error code to message-state mapping
  - retry/idempotency semantics
related_issues: []
stale: false
---

## Problem

Messages sent to incorrect phone numbers caused RapidPro's api/v2/broadcast endpoint to return 400, but the API did not mark them failed, so it retried the same message over and over. Separately, when api/v2/broadcast returned 200 without a status update, messages were duplicated in TextIt/RapidPro (forum report t/4047/19).

## Root Cause

The rapidpro.js service did not correctly translate broadcast HTTP response codes into message states: a 400 was not mapped to a terminal 'failed' state, so the retry loop never stopped for unrecoverable errors; and a 200 lacking an explicit status update left the message in a state that triggered re-sending and duplication.

## Solution

In api/src/services/rapidpro.js, map a 400 response from api/v2/broadcast to a 'failed' message status (terminal, no retry) and map a 200 response without a status update to 'queued', preventing duplicate broadcasts.

## Code Patterns

Translate external gateway HTTP response codes into the internal message state machine — 4xx → terminal 'failed' (halt retries on unrecoverable errors), 2xx-without-explicit-status → 'queued' (await later status update instead of re-sending). See api/src/services/rapidpro.js.

## Design Choices

Marking 400 as 'failed' stops the infinite retry loop for unrecoverable errors (e.g. malformed phone numbers) rather than re-sending pointlessly; defaulting a status-less 200 to 'queued' avoids re-broadcasting and the resulting message duplication while still allowing a later status update.

## Related Files

- api/src/services/rapidpro.js
- api/tests/mocha/services/rapidpro.spec.js
- tests/e2e/default/sms/rapidpro.wdio-spec.js

## Testing

Unit tests in api/tests/mocha/services/rapidpro.spec.js were updated to cover the new 400→failed and 200-without-status→queued behavior, and end-to-end coverage was added/updated in tests/e2e/default/sms/rapidpro.wdio-spec.js.

## Related Issues

- #9467: better handling of RapidPro error codes

## Domain Rationale

**Fit:** strong

The PR fixes how outgoing SMS message statuses are derived from RapidPro gateway broadcast responses (400→failed, 200-without-status→queued), which is core to the SMS delivery pipeline. SMS gateway integration is canonically the messaging domain — interoperability in CHT refers to health-data exchange standards (e.g. FHIR), not SMS gateways.
