---
id: cht-core-9936
category: feature
domain: interoperability
subDomain: outbound-push
issueNumber: 9936
issueUrl: https://github.com/medic/cht-core/issues/9936
title: Add user-agent header to outgoing requests
lastUpdated: 2025-05-06
summary: A policy change in TextIt (RapidPro) began blocking HTTP requests that lacked a User-Agent header. CHT's outbound push requests did not include this header, causing integrations to fail. The fix centralized User-Agent header generation in the shared couch-request library so it applies to all outgoing CHT requests automatically.
services:
  - sentinel
techStack:
  - javascript
  - nodejs
---

## Problem

A recent change in TextIt (a hosted RapidPro service widely used by CHT deployments for SMS messaging workflows) started blocking HTTP requests without a `User-Agent` header. CHT's outbound push module did not set a `User-Agent` header on its HTTP calls, so all outbound pushes to TextIt/RapidPro endpoints began failing. This affected deployments using RapidPro-style outbound configs for triggering messaging workflows. The issue was reported on the CHT community forum before being formally filed.

## Root Cause

The `shared-libs/outbound/src/outbound.js` had added a `User-Agent` header only for outbound requests in a prior commit (`9bcc58a`). However, RapidPro requests made through other CHT code paths went through the shared `couch-request` library, which had no `User-Agent` header. Because the header was only set in one specific code path (outbound), requests from other integration paths were still missing it. The real fix was to centralize User-Agent generation in `couch-request` so every outgoing HTTP request gets the header.

## Solution

Added a `getUserAgent` function to `shared-libs/couch-request/src/couch-request.js` that dynamically generates a User-Agent string using the CHT version, OS platform, and architecture (e.g. `CommunityHealthToolkit/4.x linux x64`). The `setRequestOptions` function was updated to include this header on every request if a User-Agent is not already set by the caller.

The existing `getUserAgent` code and `CHT_AGENT` constant were simultaneously **removed** from `shared-libs/outbound/src/outbound.js`, as this responsibility was now centralized in `couch-request`.

A circular dependency existed between `couch-request` and `server-info` (because `server-info` called `couch-request` to read the version from CouchDB, and `couch-request` was now calling `server-info` for the User-Agent). This was resolved by adding lazy loading (requiring `couch-request` inside the function body) inside `getDeployInfo` in `shared-libs/server-info/src/index.js`.

## Code Patterns

- `getUserAgent` is defined in `shared-libs/couch-request/src/couch-request.js` and called inside `setRequestOptions` before every HTTP request
- The header is only set if the caller has not already set their own `User-Agent` — custom headers are never overridden
- Format: `CommunityHealthToolkit/<version> <platform> <arch>` where version, platform and arch are read at runtime
- The lazy load pattern in `getDeployInfo` (`require('./couch-request')` inside the function body rather than at the top) was used to break the circular dependency — this is an intentional, documented exception; `getDeployInfo` caches its result so the `require` only executes once
- Pattern: always centralize cross-cutting HTTP headers (User-Agent, auth) in the lowest-level request library, not in individual consumers

## Design Choices

- Moved User-Agent to `couch-request` (not just the outbound lib) so ALL outgoing CHT HTTP requests carry the header, making the fix future-proof
- Made the version dynamic from `@medic/server-info` rather than hardcoded, so the header stays accurate across CHT upgrades
- Chose lazy loading to resolve the circular dependency rather than removing the version from the User-Agent, so that external services get useful version information
- Per-request `headers` config can still override the default User-Agent for deployments with specific requirements

## Related Files

- shared-libs/couch-request/src/couch-request.js
- shared-libs/couch-request/test/couch-request.js
- shared-libs/outbound/src/outbound.js
- shared-libs/server-info/src/index.js
- shared-libs/server-info/test/index.spec.js

## Testing

- Unit tests added in `shared-libs/couch-request/test/couch-request.js` verifying that the User-Agent header is automatically added to requests and that an existing User-Agent header is not overridden
- Tests in `shared-libs/outbound/test/outbound.spec.js` updated to remove User-Agent from expected headers (since outbound now delegates this to `couch-request`)

## Related Issues

- #6306: Send outbound push without delay
- #6001: Alert when outbound pushes are repeatedly failing
