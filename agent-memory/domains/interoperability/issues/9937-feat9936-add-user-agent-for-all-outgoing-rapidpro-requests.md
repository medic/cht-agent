---
id: cht-core-9936
category: feature
domain: interoperability
domainFit: strong
issueNumber: 9936
issueUrl: https://github.com/medic/cht-core/issues/9936
title: Add a dynamically-generated user-agent header to all outgoing couch-request HTTP requests and centralize it (fixes RapidPro blocking requests without one)
lastUpdated: '2026-06-22'
summary: RapidPro/TextIt began blocking HTTP requests that lack a user-agent header, breaking CHT's outbound integration. This PR centralizes a dynamically-built user-agent (CHT version, platform, architecture) in the shared couch-request library so it is applied to all outgoing requests, and removes the now-redundant per-call implementation from the outbound library.
services:
  - api
  - sentinel
techStack:
  - javascript
  - nodejs
  - http
tags:
  - user-agent
  - http-headers
  - rapidpro
  - outbound
  - couch-request
  - external-integration
related_workflows: []
source_pr: medic/cht-core#9937
source_sha: 9b4546714d87a413b02e33c0e6e5f726da44f7af
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/couch-request/src/couch-request.js
  - shared-libs/environment/src/index.js
  - shared-libs/outbound/src/outbound.js
concepts:
  - HTTP user-agent header
  - centralized request configuration in a shared HTTP library
  - non-overriding header defaults
  - outbound integration / webhook push to external systems
  - code deduplication (single source of truth / DRY)
related_issues: []
stale: false
---

## Problem

A recent change in TextIt (and potentially all RapidPro instances) started rejecting/blocking HTTP requests that do not include a user-agent header. CHT's requests to RapidPro lacked this header, so its outbound integration with RapidPro was failing.

## Root Cause

The user-agent header was only set per-call in specific code paths (the outbound library's sendPayload, added recently) rather than centrally for every outgoing request made through the shared couch-request HTTP library. As a result, RapidPro-bound requests routed through couch-request had no user-agent header and were blocked.

## Solution

Introduced a getUserAgent function in couch-request that builds a user-agent string from the CHT version (via @medic/environment) plus platform and architecture (via Node's os module). Updated setRequestOptions to inject the user-agent header only when one is not already set, made setRequestOptions async to accommodate the version lookup, and awaited it in the request function. Removed the duplicate getUserAgent function and CHT_AGENT constant from the outbound library and stopped setting the header in sendPayload, delegating that responsibility to couch-request. Supporting changes were made in the environment library to expose version data.

## Code Patterns

Centralize cross-cutting HTTP request configuration (e.g. user-agent) in the shared couch-request library's setRequestOptions instead of duplicating it per caller (shared-libs/couch-request/src/couch-request.js). Use a non-overriding default — only set the header when the caller has not already provided one. Build the agent string from @medic/environment (version) and Node's os module (platform/arch). When a request-configuration helper must perform an async lookup, make it async and await it at the call site rather than reading version data synchronously.

## Design Choices

Centralizing the header in couch-request (shared by all server-side requests) was chosen over the narrower alternative noted in the issue of adding user-agent only to RapidPro requests — this fixes the immediate RapidPro breakage and prevents recurrence for any current or future external integration. The header is applied non-destructively so an explicitly provided user-agent is preserved. Removing the duplicate implementation from outbound keeps a single source of truth.

## Related Files

- shared-libs/couch-request/src/couch-request.js
- shared-libs/couch-request/test/couch-request.js
- shared-libs/environment/src/index.js
- shared-libs/environment/test/index.spec.js
- shared-libs/outbound/src/outbound.js
- shared-libs/outbound/test/outbound.spec.js

## Testing

Added unit tests in couch-request that mock the os module and @medic/environment to simulate platform/version data, verifying the user-agent header is automatically added and that an existing user-agent header is not overridden. Updated the environment library tests and the outbound tests to reflect the removed user-agent code. CI showed some flaky test failures that passed on re-run.

## Related Issues

- #9936: RapidPro/TextIt blocks requests lacking a user-agent header; add a user-agent header to RapidPro (and all outgoing) requests

## Domain Rationale

**Fit:** strong

The PR exists to fix CHT's outbound integration requests to an external third-party system (RapidPro/TextIt) being blocked, and it modifies the outbound push library that is CHT's external-system integration layer — identifying CHT to external services is a core interoperability concern. The fit is strong on purpose/motivation even though the implementation centralizes the header in the shared couch-request HTTP library (which also serves internal requests).
