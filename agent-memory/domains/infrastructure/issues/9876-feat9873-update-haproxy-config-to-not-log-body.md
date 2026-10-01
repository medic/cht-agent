---
id: cht-core-9873
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 9873
issueUrl: https://github.com/medic/cht-core/issues/9873
title: Update HAProxy config to stop logging request bodies
lastUpdated: '2026-10-01'
summary: HAProxy was logging request bodies only partially (capped at 65k characters and only the first chunk of a chunked body), which gave no auditing value while bloating stored and parsed logs. The HAProxy frontend config was updated to stop capturing and logging request bodies entirely, and the password-masking Lua script that scrubbed them was deleted.
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

Before this PR, HAProxy logged request bodies, but the capture was inherently incomplete — limited to 65k characters and only the first chunk of a chunked body. This partial body logging provided no benefit for auditing while increasing the size of stored and parsed logs.

## Root Cause

Before this PR, the `frontend http-in` section of haproxy/default_frontend.cfg captured the request body (`http-request capture req.body id 0 # capture.req.hdr(0)`) and wrote it into every log line through the `'%[capture.req.hdr(0),lua.replacePassword]'` field of its `log-format`, after masking passwords with the `replacePassword` converter from haproxy/scripts/replace_password.lua. The issue notes that HAProxy cannot log full bodies (65k cap, first-chunk-only for chunked transfers), so the captured data was always truncated and of no auditing value.

## Solution

Updated haproxy/default_frontend.cfg to no longer capture or log request bodies: removed the `http-request capture req.body id 0` line, dropped the body field from the `log-format` string (each HAProxy log line now has one comma-separated field fewer), and removed the `lua-load-per-thread /usr/local/etc/haproxy/replace_password.lua` line from the `global` section. The `declare capture request len 400000` line that sized the body slot was left in place. haproxy/scripts/replace_password.lua, whose only job was masking `password` values and Basic-auth credentials in logged bodies, was deleted. The WebdriverIO e2e logging spec was updated to assert that the logs no longer contain passwords at all.

## Code Patterns

HAProxy frontend log-format/capture removal in haproxy/default_frontend.cfg: when a captured field is dropped from `log-format`, remove the `http-request capture` that fills it and any Lua converter that only served that field (here haproxy/scripts/replace_password.lua, deleted), and update the e2e checks of proxy log contents in tests/e2e/default/logging/logging.wdio-spec.js. The remaining haproxy/scripts/parse_basic.lua and haproxy/scripts/parse_cookie.lua loads, which feed the `x-medic-user` header, are unaffected.

## Design Choices

Chose to drop request-body logging entirely rather than attempt to log full bodies, since HAProxy cannot capture complete bodies and partial logs add storage/parse cost with no auditing payoff. Removing the body also removes the need to mask passwords in it. The issue lists switching the proxy to nginx as the alternative considered, noting it might be done anyway in another ticket.

## Related Files

- haproxy/default_frontend.cfg
- haproxy/scripts/replace_password.lua (deleted)
- tests/e2e/default/logging/logging.wdio-spec.js

## Testing

Updated the WebdriverIO e2e logging spec (tests/e2e/default/logging/logging.wdio-spec.js): `should mask password on login` became `should not log bodies` and `should mask password on replication request` became `should not log bodies on replication request`, both now asserting that the log line collected with `utils.collectHaproxyLogs(/POST,\/_session/)` does not contain `password`; the `should mask password basic auth header` case, which checked `{"Authorization":"Basic ***"}` masking in a logged `/_replicator` body, was removed.

## Related Issues

- #9873: "Remove body logging from Haproxy" — the issue this PR closes

## Domain Rationale

**Fit:** strong

HAProxy is the reverse proxy/load balancer in the CHT deployment stack; the PR changes only its config, deletes one of its Lua scripts, and updates the e2e spec that reads its logs — operational logging configuration, not application behavior.
