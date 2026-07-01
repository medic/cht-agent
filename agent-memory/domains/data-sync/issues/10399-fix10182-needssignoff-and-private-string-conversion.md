---
id: cht-core-10183
category: bug
domain: data-sync
domainFit: strong
issueNumber: 10183
issueUrl: https://github.com/medic/cht-core/issues/10183
title: Handle string vs boolean values for needs_signoff and private flags across replication index, authorization, and purging
lastUpdated: '2026-06-22'
summary: The replication-key index and authorization logic assumed needs_signoff and private were always booleans, but reports/docs can produce them as strings, causing incorrect replication decisions. The fix normalizes these values consistently across the Nouveau index, API authorization, and sentinel purging.
services:
  - api
  - sentinel
techStack:
  - javascript
  - couchdb
  - nouveau
tags:
  - replication
  - needs_signoff
  - private
  - type-coercion
  - string-conversion
  - authorization
  - purging
  - replication-key
related_workflows:
  - nouveau-search
source_pr: medic/cht-core#10399
source_sha: 3d0ba18b2b3a8a76d7d033c9488bf87d130e1f17
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/authorization.js
  - ddocs/medic-db/medic/nouveau/docs_by_replication_key/index.js
  - sentinel/src/lib/purging.js
concepts:
  - replication authorization
  - replication keys
  - offline replication
  - type coercion (string-to-boolean)
  - document purging
  - Nouveau replication-key index
related_issues: []
stale: false
---

## Problem

The implementation assumed the report/doc values for needs_signoff and private were always booleans, but they can be produced as strings (e.g. "true"/"false") from form submissions or configuration. This caused these flags to be mis-evaluated during replication authorization, in the docs_by_replication_key Nouveau index, and during purging, so affected documents could replicate to the wrong users (or fail to replicate) and be purged incorrectly.

## Root Cause

Strict boolean checks (e.g. comparing against true / relying on boolean truthiness) against needs_signoff and private values that are not guaranteed to be booleans — a string value such as "true" did not satisfy the boolean comparison, so the replication-key emission, authorization, and purge logic took the wrong branch.

## Solution

Normalize the needs_signoff and private values to handle both string and boolean representations and apply the same coercion consistently in all three code paths: the docs_by_replication_key Nouveau index, the API authorization replication service, and sentinel purging.

## Code Patterns

Defensively coerce a possibly-string flag to a canonical boolean before comparison, and apply the identical normalization everywhere the field is read (ddocs/medic-db/medic/nouveau/docs_by_replication_key/index.js, api/src/services/authorization.js, sentinel/src/lib/purging.js) so replication and purge decisions stay aligned.

## Design Choices

Handle string values defensively at read time rather than enforcing a boolean at write time, preserving backward compatibility with existing data and configurations that may already store string values for needs_signoff/private.

## Related Files

- api/src/services/authorization.js
- ddocs/medic-db/medic/nouveau/docs_by_replication_key/index.js
- sentinel/src/lib/purging.js
- tests/integration/api/controllers/replication.spec.js

## Testing

Added/updated the integration test tests/integration/api/controllers/replication.spec.js to cover replication behavior when needs_signoff/private are provided as strings as well as booleans.

## Related Issues

- #10182: report/doc value for needs_signoff and private may be a string rather than a boolean, breaking replication-key evaluation

## Domain Rationale

**Fit:** strong

The change fixes how the docs_by_replication_key Nouveau index, the API replication authorization service, and sentinel purging interpret the needs_signoff/private flags — all core machinery that decides which documents replicate to which offline users, which is squarely data-sync.
