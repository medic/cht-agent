---
id: cht-core-10068
category: bug
domain: messaging
domainFit: strong
issueNumber: 10068
issueUrl: https://github.com/medic/cht-core/issues/10068
title: Fix Africa's Talking SMS gateway request body double-parsing in API
lastUpdated: '2026-06-22'
summary: The Africa's Talking SMS gateway service attempted to parse an already-parsed request body, breaking inbound request handling. The redundant double-parse was removed and a CI-only e2e test against the Africa's Talking sandbox server was added.
services:
  - api
techStack:
  - javascript
  - nodejs
  - express
  - mocha
  - webdriverio
  - github-actions
tags:
  - sms
  - africas-talking
  - sms-gateway
  - request-parsing
  - webhook
  - body-parser
  - e2e-test
related_workflows:
  - message-processing
source_pr: medic/cht-core#10082
source_sha: f4e54b43fed292d0fb28b3c80ac9156ae74b0c95
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/africas-talking.js
  - api/tests/mocha/services/africas-talking.spec.js
  - tests/e2e/default/sms/africas-talking.wdio-spec.js
  - tests/utils/index.js
  - .github/workflows/build.yml
concepts:
  - SMS gateway integration
  - webhook request body parsing
  - Express body-parsing middleware
  - inbound message handling
related_issues: []
stale: false
---

## Problem

Inbound requests from the Africa's Talking SMS gateway were not processed correctly because the API service parsed the request body a second time after it had already been deserialized, causing parse failures in the SMS webhook handling path (issue #10068).

## Root Cause

In api/src/services/africas-talking.js the handler ran a parse routine on a request body that had already been parsed into an object by upstream middleware, i.e. an unnecessary double-parse of the incoming payload.

## Solution

Stopped attempting to parse the request body a second time and used the already-parsed body directly. Added a CI-only WebdriverIO e2e test that exercises the integration against the Africa's Talking sandbox server, with supporting helpers in tests/utils/index.js, updated mocha unit tests, and CI wiring in build.yml.

## Code Patterns

Do not re-parse a request body that framework/middleware has already deserialized — read req.body directly. See api/src/services/africas-talking.js.

## Design Choices

Added a CI-only e2e test hitting the real Africa's Talking sandbox endpoint (gated in .github/workflows/build.yml) to catch real wire-format regressions that mocked unit tests cannot, rather than relying solely on unit-level mocks.

## Related Files

- api/src/services/africas-talking.js
- api/tests/mocha/services/africas-talking.spec.js
- tests/e2e/default/sms/africas-talking.wdio-spec.js
- tests/utils/index.js
- .github/workflows/build.yml

## Testing

Updated mocha unit tests in api/tests/mocha/services/africas-talking.spec.js and added a CI-only WebdriverIO e2e test (tests/e2e/default/sms/africas-talking.wdio-spec.js) that interacts with the Africa's Talking sandbox server, supported by helpers in tests/utils/index.js and CI configuration in .github/workflows/build.yml.

## Related Issues

- #10068: Africa's Talking inbound request body parsing bug
- #10073: original PR that this 4.21 backport was cherry-picked from

## Domain Rationale

**Fit:** strong

The change fixes the API service that handles inbound webhook requests from the Africa's Talking SMS gateway — this is core SMS message-processing code, not a gateway setup/config change (which would belong to configuration).
