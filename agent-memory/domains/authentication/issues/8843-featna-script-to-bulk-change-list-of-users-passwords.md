---
id: cht-core-8843
category: feature
domain: authentication
domainFit: strong
issueNumber: 8843
issueUrl: https://github.com/medic/cht-core/issues/8843
title: Add admin script to bulk force-reset passwords for a list of users to random values
lastUpdated: '2026-06-23'
summary: CHT admins had no efficient way to force-reset many users' passwords at once. This adds a standalone Node.js script that reads a username list and sets each user's password to a fresh random value via the CHT API, useful for credential rotation after a breach or failed bulk upload.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
tags:
  - password-reset
  - bulk-update
  - user-management
  - security
  - admin-script
  - credential-rotation
related_workflows: []
source_pr: medic/cht-core#8843
source_sha: 1365021c3986c5b4f45e2a996da8be17cf1142a7
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - scripts/bulk-password-update-export.js
  - .gitignore
concepts:
  - bulk credential rotation
  - admin operational script
  - API-driven user management
  - random password generation
  - break-glass account recovery
related_issues: []
stale: false
---

## Problem

CHT administrators had no batch mechanism to force-reset passwords for many users at once. After a security breach or a botched bulk user upload, each user's password had to be reset individually, which was tedious and error-prone at scale.

## Root Cause

Feature gap rather than a defect: no existing tooling supported bulk password rotation. The admin user-update API had to be invoked manually per user, so there was no scripted batch workflow for credential resets.

## Solution

Added scripts/bulk-password-update-export.js, a standalone Node.js CLI that parses --url/--user/--password admin credentials, reads a newline-delimited list of usernames from scripts/user-password-change.txt, generates a random password per user, and calls the CHT user-update API to apply it, logging per-user SUCCESS/ERROR (including 404 'Failed to find user'). Updated .gitignore so the sensitive input/credentials file is not committed.

## Code Patterns

CLI admin-script pattern: parse --url/--user/--password flags, read a newline-delimited username list from a local file, iterate and issue per-user password-update API calls, generate a random password per row, and emit per-row SUCCESS/ERROR with the new credential. Paired .gitignore entry to keep the sensitive username/password file out of version control.

## Design Choices

Implemented as a one-off operational script under scripts/ rather than an API endpoint or admin-UI feature, since bulk force-reset is an infrequent break-glass operation run by operators. Passwords are randomly generated and printed so admins can redistribute them. The input file is git-ignored to avoid leaking usernames/credentials. Assumes the target users already exist in the database.

## Related Files

- scripts/bulk-password-update-export.js
- .gitignore
- scripts/user-password-change.txt

## Testing

No automated tests added — the 'Tested: Unit and/or e2e' checklist item was left unchecked. Validated manually by running the script against a local instance with a sample user-password-change.txt and confirming per-user SUCCESS/ERROR output (including a 404 for a missing user).

## Related Issues

_none_

## Domain Rationale

**Fit:** strong

The script's core function is rotating user credentials (passwords), which is squarely the authentication domain; the 'Type: Security' label and per-user account focus confirm the fit. It is not infrastructure — infrastructure covers build/ship/run lifecycle, not functional credential management.
