---
id: cht-core-10068
category: bug
domain: messaging
domainFit: strong
issueNumber: 10068
issueUrl: https://github.com/medic/cht-core/issues/10068
title: Fix Africa's Talking SMS gateway double-parsing of the inbound request body
lastUpdated: '2026-06-22'
summary: The Africa's Talking SMS integration attempted to JSON-parse a request body that had already been parsed, breaking inbound message handling. The fix stops the redundant double-parse and adds a CI-only e2e test that exercises the Africa's Talking Sandbox server.
services:
  - api
techStack:
  - javascript
  - nodejs
  - express
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
source_sha: fb52de8606201fdbc853e3c108f878e8640b4f7f
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/africas-talking.js
concepts:
  - SMS gateway integration
  - inbound webhook request parsing
  - Express body parsing
related_issues: []
stale: false
---

## Problem

The Africa's Talking integration failed because it tried to parse a request/response body that was already parsed, causing a double-parse error when processing requests from the Africa's Talking gateway.

## Root Cause

The africas-talking service re-parsed the incoming request body even though it had already been parsed upstream (by Express middleware), so the second parse operated on a non-string/already-parsed value and failed.

## Solution

Removed the redundant parsing step in api/src/services/africas-talking.js so the already-parsed body is consumed directly. Added unit coverage and a CI-only e2e test (tests/e2e/default/sms/africas-talking.wdio-spec.js) that interacts with the Africa's Talking Sandbox server, with supporting changes in tests/utils/index.js and .github/workflows/build.yml to run it in CI.

## Code Patterns

Do not re-parse request bodies that have already been parsed by upstream middleware — consume req.body directly rather than calling JSON.parse on it again (api/src/services/africas-talking.js).

## Design Choices

The new e2e test is gated to CI only (via build.yml) because it depends on the external Africa's Talking Sandbox server, keeping local/offline test runs unaffected while still validating the integration end-to-end.

## Related Files

- .github/workflows/build.yml
- api/src/services/africas-talking.js
- api/tests/mocha/services/africas-talking.spec.js
- tests/e2e/default/sms/africas-talking.wdio-spec.js
- tests/utils/index.js

## Testing

Updated unit tests in api/tests/mocha/services/africas-talking.spec.js and added a CI-only e2e test in tests/e2e/default/sms/africas-talking.wdio-spec.js that interacts with the Africa's Talking Sandbox server; tests/utils/index.js and .github/workflows/build.yml were updated to support running the e2e test in CI. Reviewer confirmed it works after manual testing.

## Related Issues

- #10068: Africa's Talking integration tries to parse an already-parsed request body

## Domain Rationale

**Fit:** strong

Africa's Talking is an SMS gateway CHT uses to send and receive messages, and the bug is in the inbound request-parsing code of that messaging transport service. The build.yml change only wires the new e2e test into CI, so the PR's substance is messaging behavior, not infrastructure or gateway setup/config.
