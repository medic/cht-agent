---
id: cht-core-9992
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 9992
issueUrl: https://github.com/medic/cht-core/issues/9992
title: Add base64 no-wrap flag in HAProxy entrypoint to support long CouchDB credentials
lastUpdated: '2026-06-22'
summary: The base64 utility wraps output at 76 characters by default, inserting newlines that corrupted the generated HAProxy health config when CouchDB username+password were long. Adding the no-wrap flag keeps the encoded credentials on a single line.
services:
  - api
  - sentinel
techStack:
  - bash
  - haproxy
  - couchdb
  - base64
tags:
  - haproxy
  - base64
  - couchdb-credentials
  - line-wrapping
  - health-check
  - shell-script
related_workflows: []
source_pr: medic/cht-core#10267
source_sha: 9a4ff5c0956269d605f8e4620399b79707ca30c5
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - haproxy/entrypoint.sh
concepts:
  - reverse proxy / load balancing
  - HAProxy health checks
  - base64 encoding
  - credential handling
  - HTTP basic auth
related_issues: []
stale: false
---

## Problem

When the CouchDB username + password were long enough, base64-encoding them for the HAProxy health config produced multi-line output (base64 inserts a newline every 76 characters by default). The injected newlines broke the generated HAProxy configuration, failing for deployments using long CouchDB credentials.

## Root Cause

The base64 command in haproxy/entrypoint.sh was invoked without disabling line wrapping, so its default behavior of wrapping output at 76 characters split long encoded credentials across multiple lines and corrupted the HAProxy config.

## Solution

Added the base64 no-wrap flag (-w 0 / --wrap=0) to the credential-encoding call in haproxy/entrypoint.sh so the encoded value stays on a single line regardless of credential length.

## Code Patterns

When base64-encoding a value for insertion into a config file or header (e.g. HTTP basic auth), always pass `-w 0`/`--wrap=0` to suppress the default 76-character line wrapping — see haproxy/entrypoint.sh.

## Design Choices

Using base64's built-in no-wrap flag is the minimal, idiomatic fix versus post-processing the output to strip newlines (e.g. piping through `tr -d '\n'`).

## Related Files

- haproxy/entrypoint.sh

## Testing

No automated tests added; this is a shell/config fix to the HAProxy entrypoint. Reviewer (dianabarsan) approved with positive feedback.

## Related Issues

- #9992: line wrapping in HAProxy config breaks health check when CouchDB credentials are too long

## Domain Rationale

**Fit:** strong

The change is to the HAProxy proxy layer's entrypoint script (credential encoding for the CouchDB health-check config). HAProxy/proxy configuration is canonical operational-lifecycle infrastructure, not application behavior.
