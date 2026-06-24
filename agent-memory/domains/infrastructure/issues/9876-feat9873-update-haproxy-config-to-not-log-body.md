---
id: cht-core-9873
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 9873
issueUrl: https://github.com/medic/cht-core/issues/9873
title: Update HAProxy config to stop logging request bodies
lastUpdated: '2026-06-22'
summary: HAProxy was logging request bodies only partially (capped at 65k characters and only the first chunk of a chunked body), which gave no auditing value while bloating stored and parsed logs. The HAProxy frontend config was updated to stop logging request bodies entirely.
services:
  - api
techStack:
  - haproxy
  - lua
  - couchdb
  - javascript
  - webdriverio
tags:
  - haproxy
  - logging
  - observability
  - request-body
  - audit-logs
  - proxy-config
  - log-size
related_workflows:
  - observability
source_pr: medic/cht-core#9876
source_sha: 5e70f64a83157ff39f9fe7097b48f68bdc8577ee
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - haproxy/default_frontend.cfg
  - haproxy/scripts/replace_password.lua
  - tests/e2e/default/logging/logging.wdio-spec.js
concepts:
  - reverse proxy logging
  - request body capture
  - log management
  - observability
  - sensitive-data masking
related_issues: []
stale: false
---

## Problem

HAProxy logged request bodies, but the capture was inherently incomplete — limited to 65k characters and only the first chunk of a chunked body. This partial body logging provided no benefit for auditing while increasing the size of stored and parsed logs.

## Root Cause

The HAProxy frontend configuration (default_frontend.cfg) captured request bodies into log lines. HAProxy fundamentally cannot log full bodies (65k cap, first-chunk-only for chunked transfers), so the captured data was always truncated and of no auditing value.

## Solution

Updated haproxy/default_frontend.cfg to no longer capture/log request bodies, and adjusted the replace_password.lua log-masking script accordingly. Updated the e2e logging spec to assert the new logging behavior.

## Code Patterns

HAProxy frontend log-format/capture removal in haproxy/default_frontend.cfg; Lua-based log post-processing for password masking in haproxy/scripts/replace_password.lua; e2e verification of proxy log contents in tests/e2e/default/logging/logging.wdio-spec.js.

## Design Choices

Chose to drop request-body logging entirely rather than attempt to log full bodies, since HAProxy cannot capture complete bodies and partial logs add storage/parse cost with no auditing payoff. Switching the proxy to nginx was considered as an alternative but deferred to a separate ticket.

## Related Files

- haproxy/default_frontend.cfg
- haproxy/scripts/replace_password.lua
- tests/e2e/default/logging/logging.wdio-spec.js

## Testing

Updated the WebdriverIO e2e logging spec (tests/e2e/default/logging/logging.wdio-spec.js) to verify HAProxy logs no longer include request bodies.

## Related Issues

- #9873: HAProxy logs request bodies only partially (65k char limit, first chunk of chunked bodies), providing no auditing benefit while bloating logs

## Domain Rationale

**Fit:** strong

HAProxy is the reverse proxy/load balancer in the CHT deployment stack, and changing its logging configuration is operational/deployment-lifecycle work — HAProxy is explicitly an infrastructure concern, not application behavior.
