---
id: cht-core-10305
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 10305
issueUrl: https://github.com/medic/cht-core/issues/10305
title: Stop enforcing CouchDB's failed-authentication lockout (chttpd_auth_lockout mode = warn) in couchdb/10-docker-default.ini
lastUpdated: '2026-10-01'
summary: 'To protect against a DoS attack (details in a private issue), this PR sets CouchDB''s failed-authentication lockout to `mode = warn` in the CouchDB Docker default config (`couchdb/10-docker-default.ini`), so repeated authentication failures are logged instead of locking the user and client IP out with 403s; the PR calls this disabling CouchDB''s rate limiter.'
services:
  - api
  - sentinel
  - webapp
techStack:
  - couchdb
  - docker
  - ini
tags:
  - couchdb
  - rate-limiter
  - docker
  - auth-lockout
  - security
related_workflows: []
source_pr: medic/cht-core#10512
source_sha: 5f59e9f836009c2e6e58b67a59ac4c967935ae9b
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - couchdb/10-docker-default.ini
concepts:
  - rate limiting
  - failed-authentication lockout
  - CouchDB server configuration
  - Docker default configuration
related_issues: []
stale: false
---

## Problem

Issue #10305 ("Protect against DoS attack", labelled Type: Security) keeps its details in a private issue (medic-projects#8243). The CouchDB image CHT builds on (`couchdb:3.5.0` at this PR) enforces CouchDB's failed-authentication lockout by default: the `[chttpd_auth_lockout]` mode defaults to enforce, so once 5 failed authentication attempts (the default threshold) for the same user and client IP happen within the default 5-minute lockout window, CouchDB rejects further attempts with a 403 for the rest of that window (CouchDB configuration docs).

## Root Cause

Before this PR, `couchdb/10-docker-default.ini` had no `[chttpd_auth_lockout]` section, so CHT's CouchDB ran with CouchDB's default lockout mode, enforce.

## Solution

The existing `couchdb/10-docker-default.ini` gained a `[chttpd_auth_lockout]` section with `mode = warn`; `couchdb/Dockerfile` copies that file into `/opt/couchdb/etc/default.d/`. In `warn` mode CouchDB only logs a warning when repeated authentication failures occur for a user and client IP, instead of rejecting requests with a 403, so the lockout is no longer enforced. The PR description calls this disabling CouchDB's rate limiter. Single-file, config-only change applied at the Docker-image default layer.

## Code Patterns

CHT tunes its bundled CouchDB by editing `couchdb/10-docker-default.ini`, which `couchdb/Dockerfile` bakes into the CouchDB Docker image; override an upstream CouchDB default (here, the failed-authentication lockout mode) by setting the corresponding key in that default config rather than via per-deployment overrides.

## Design Choices

Applied at the shared Docker-default config layer so every deployment running the CouchDB image built from `couchdb/Dockerfile` inherits the setting. `warn` rather than `off` keeps CouchDB tracking repeated authentication failures per user and client IP and logging a warning, while no longer rejecting requests; the PR sets no other lockout options, so the threshold and lockout window stay at CouchDB's defaults.

## Related Files

- couchdb/10-docker-default.ini

## Testing

Config-only change; the PR adds no automated tests.

## Related Issues

- None directly referenced.

## Domain Rationale

**Fit:** strong

The change is a CouchDB Docker default config file (`couchdb/10-docker-default.ini`) that sets how the database server handles repeated authentication failures — i.e., how the deployed system runs — which squarely fits the infrastructure (Docker/deploy lifecycle) domain. It is a CouchDB server setting baked into the image; no CHT login, session or app-settings code changed, even though the setting concerns authentication.
