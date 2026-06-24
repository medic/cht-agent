---
id: cht-core-9854
category: bug
domain: interoperability
domainFit: strong
issueNumber: 9854
issueUrl: https://github.com/medic/cht-core/issues/9854
title: Fix duplicate outbound push caused by uncaught CouchDB conflict when writing the sentinel info doc for multiple pushes on the same document
lastUpdated: '2026-06-22'
summary: When multiple outbound pushes were configured against the same document, the second push hit an uncaught CouchDB 409 conflict while writing the shared sentinel info doc, causing an unnecessary task:outbound and a duplicate push. The fix keeps the info-doc revision current across sequential pushes so the second write no longer conflicts.
services:
  - sentinel
techStack:
  - javascript
  - couchdb
  - pouchdb
tags:
  - outbound-push
  - info-doc
  - document-conflict
  - transitions
  - idempotency
  - duplicate-push
related_workflows: []
source_pr: medic/cht-core#9855
source_sha: 6fbe14c0dedb1b2630c264182c8a873653139ed2
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/infodoc/src/infodoc.js
  - shared-libs/transitions/src/transitions/mark_for_outbound.js
concepts:
  - outbound push
  - info documents
  - CouchDB document update conflict
  - revision management
  - idempotency
  - sentinel transitions
related_issues: []
stale: false
---

## Problem

When more than one outbound push is configured against the same document (e.g. obp1 and obp2) without a cron configuration, the second push fails. Looping over the outbound keys, push-1 successfully writes the per-report sentinel info doc, but when push-2 attempts to `put` the same info doc it hits an uncaught CouchDB 409 'Document update conflict' (docId: <id>-info). The unhandled error caused an unnecessary task:outbound to be created, which led to push-2 being pushed again — a duplicate outbound push.

## Root Cause

In the mark_for_outbound sentinel transition, the loop over configured outbound keys writes to the same per-report info doc repeatedly. After push-1 saved the info doc, the in-memory info doc reference (and its `_rev`) reused by push-2 was stale, so push-2's write conflicted (409). Because the conflict was unhandled, the transition did not record push-2's completion and re-queued a duplicate task:outbound.

## Solution

Updated mark_for_outbound.js and the infodoc shared library so the info doc's revision/state is kept current across sequential outbound pushes within the same transition run, preventing the 409 conflict on the second and later writes. This stops the spurious task:outbound creation and the resulting duplicate push.

## Code Patterns

When writing the same CouchDB document multiple times within a loop, refresh/track the latest `_rev` returned from each save and reuse it for the next write so subsequent updates don't conflict — shared-libs/transitions/src/transitions/mark_for_outbound.js, shared-libs/infodoc/src/infodoc.js.

## Design Choices

Fix the conflict at its source by maintaining current info-doc revision state between sequential pushes rather than merely catching/retrying the 409, preserving correct task:outbound bookkeeping and eliminating the duplicate push instead of masking the symptom.

## Related Files

- shared-libs/infodoc/src/infodoc.js
- shared-libs/transitions/src/transitions/mark_for_outbound.js
- shared-libs/transitions/test/unit/transitions/mark_for_outbound.js
- tests/integration/sentinel/transitions/mark-for-outbound.spec.js

## Testing

Updated unit tests in shared-libs/transitions/test/unit/transitions/mark_for_outbound.js and added an integration test in tests/integration/sentinel/transitions/mark-for-outbound.spec.js covering the scenario of multiple outbound pushes running against the same document and asserting no info-doc conflict or duplicate push.

## Related Issues

- #9854: Second of multiple outbound pushes configured (without cron) against the same document fails / produces a duplicate push due to an info-doc update conflict

## Domain Rationale

**Fit:** strong

Outbound push (the mark_for_outbound transition) is CHT's mechanism for pushing report/document data to external third-party web services, which is the canonical interoperability concern. The bug lives squarely in that outbound push flow, so interoperability is a strong fit even though the proximate symptom is a CouchDB info-doc conflict.
