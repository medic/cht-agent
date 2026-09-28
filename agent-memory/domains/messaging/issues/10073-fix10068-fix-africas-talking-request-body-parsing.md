---
id: cht-core-10068
category: bug
domain: messaging
domainFit: strong
issueNumber: 10068
issueUrl: https://github.com/medic/cht-core/issues/10068
title: Fix Africa's Talking SMS gateway double-parsing of the outbound send response body
lastUpdated: '2026-07-30'
summary: The Africa's Talking SMS integration JSON-parsed the response body of its own outbound send request, which `@medic/couch-request` had already parsed, so every send failed to produce a message state change. The fix removes the redundant `parseResponseBody` helper and appends a CI-only e2e case (gated on `AFRICAS_TALKING_SANDBOX_API_KEY`) to the pre-existing Africa's Talking wdio spec, exercising the Sandbox server.
services:
  - api
techStack:
  - javascript
  - nodejs
  - mocha
  - webdriverio
tags:
  - africas-talking
  - sms
  - gateway
  - request-body-parsing
  - double-parse
  - e2e-testing
related_workflows:
  - message-processing
source_pr: medic/cht-core#10073
source_prs:
  - "medic/cht-core#10073"
  - "medic/cht-core#10082"
source_sha: fb52de8606201fdbc853e3c108f878e8640b4f7f
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/africas-talking.js
concepts:
  - SMS gateway integration
  - outbound SMS send response handling
  - HTTP client response parsing
related_issues: []
stale: false
---

## Problem

Outbound SMS state updates silently failed: `sendMessage` in api/src/services/africas-talking.js passed the already-parsed response object from `request.post` into a `parseResponseBody` helper, whose `JSON.parse` threw and was swallowed, returning `undefined`. The service then logged `Unable to JSON parse response` and returned no state change, so message states were never updated after a send even when the gateway had accepted the message.

## Root Cause

The africas-talking service re-parsed the HTTP response body of its own outbound POST to the Africa's Talking API. `@medic/couch-request`'s `post` already resolves the parsed body when the response is `application/json`, so `parseResponseBody`'s `JSON.parse` threw on the object, the catch swallowed the error and returned `undefined`, and `sendMessage` logged "Unable to JSON parse response" and returned no state change. Nothing inbound, no webhook, and no Express middleware is involved anywhere in this file.

## Solution

Removed the `parseResponseBody` helper in api/src/services/africas-talking.js so the already-parsed response object from `request.post` is consumed directly. Updated — not added — the existing unit spec: its three response fixtures changed from `JSON.stringify({...})` to plain objects (6 insertions / 6 deletions, no new cases). Appended a `(CREDENTIAL_PASS_OUTGOING ? describe : describe.skip)` block to the pre-existing tests/e2e/default/sms/africas-talking.wdio-spec.js that sends through the Africa's Talking Sandbox server; .github/workflows/build.yml only exports the `AFRICAS_TALKING_SANDBOX_API_KEY` secret (which is what gates the block), and the tests/utils/index.js edit is an incidental `getDoc(id, rev = '', ...)` default with no bearing on the new e2e case.

## Code Patterns

Do not re-parse an HTTP response body the HTTP client already parsed — `@medic/couch-request`'s `post` resolves an object, so consume it directly instead of calling `JSON.parse` on it (api/src/services/africas-talking.js). The file is outbound-only; it contains no Express handler and never touches `req.body`.

## Design Choices

The new e2e test is gated to CI only (via build.yml) because it depends on the external Africa's Talking Sandbox server, keeping local/offline test runs unaffected while still validating the integration end-to-end.

This fix was backported to the 4.21 release line (PR #10082, cherry-picked from #10073).

## Related Files

- .github/workflows/build.yml
- api/src/services/africas-talking.js
- api/tests/mocha/services/africas-talking.spec.js
- tests/e2e/default/sms/africas-talking.wdio-spec.js
- tests/utils/index.js

## Testing

Updated unit-test fixtures in api/tests/mocha/services/africas-talking.spec.js (the three stringified response fixtures became plain objects; 6 insertions / 6 deletions, no new cases) and added a CI-only e2e case to tests/e2e/default/sms/africas-talking.wdio-spec.js that interacts with the Africa's Talking Sandbox server. The case is a `(CREDENTIAL_PASS_OUTGOING ? describe : describe.skip)` block keyed on `process.env.AFRICAS_TALKING_SANDBOX_API_KEY`, which .github/workflows/build.yml supplies from repository secrets; the tests/utils/index.js edit in the same commit is an incidental `getDoc(id, rev = '', ...)` default and does not support the e2e test. The fix was also confirmed by manual testing.

## Related Issues

- #10068: CHT SMS message sent via Africa's Talking stuck in "pending" state (the service re-parsed the already-parsed response body of its own send request)

## Domain Rationale

**Fit:** strong

Africa's Talking is an SMS gateway CHT uses to send and receive messages, and the bug is in the outbound send path of that messaging transport service: the service double-parsed the response body of its own POST to the gateway. The build.yml change only wires the new e2e test into CI, so the PR's substance is messaging behavior, not infrastructure or gateway setup/config.
