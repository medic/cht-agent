---
id: cht-core-10750
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 10750
issueUrl: https://github.com/medic/cht-core/issues/10750
title: Fix fragile CouchDB docker-entrypoint admin check by parsing the [admins] block in cluster-credentials.ini to avoid duplicate admin blocks on restart
lastUpdated: '2026-06-22'
summary: The CouchDB docker-entrypoint.sh used a brittle multiline grep that only matched the admin user if it sat on the exact line after the [admins] header, so with multiple admins it silently failed and appended a duplicate [admins] block that corrupted config across restarts. It was replaced with an INI-section-aware check that finds the username anywhere in the active [admins] block and skips the duplicate insertion.
services:
  - api
techStack:
  - bash
  - shell
  - couchdb
  - docker
  - awk
tags:
  - couchdb
  - docker-entrypoint
  - ini-parsing
  - idempotency
  - admin-credentials
  - container-bootstrap
  - shell-script
related_workflows: []
source_pr: medic/cht-core#10750
source_sha: 680d6ef684d355880b8251914a4c2b0af650147a
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - couchdb/docker-entrypoint.sh
concepts:
  - idempotent container bootstrap
  - CouchDB server-admin provisioning
  - INI section/block parsing
  - container restart safety
related_issues: []
stale: false
---

## Problem

On CouchDB container startup the entrypoint script checks whether the configured server admin already exists in cluster-credentials.ini. The check used `grep -Pzq "\[admins\]\n$COUCHDB_USER ="`, which only matched when the admin appeared on the line immediately following the [admins] header. When multiple admins existed, the user was not listed first, or spacing varied, the check silently failed, so on each restart the script appended another [admins] block — producing a duplicate/corrupted server configuration.

## Root Cause

The existence check hardcoded a positional assumption (target user must be the first line after the [admins] header) via a fixed multiline regex, with no tolerance for multiple admin entries, ordering, or surrounding whitespace. This made the idempotency guard order-dependent and non-robust, allowing duplicate [admins] sections to be written.

## Solution

Replaced the fragile positional regex with an INI-block-aware check that scans only within the active [admins] section and matches the username key regardless of its position or spacing. When the admin is detected, the duplicate insertion is skipped, preserving config integrity across container restarts. An initial awk INI parser was simplified during review to a leaner shell approach while keeping the multi-admin robustness.

## Code Patterns

Idempotent INI guard in shell: scope the existence check to the target section ([admins]) and match the key independent of line position/whitespace rather than relying on a fixed positional multiline grep — see couchdb/docker-entrypoint.sh. General pattern for safe, restart-idempotent config mutation in container entrypoints.

## Design Choices

Reviewer (jkuester) confirmed the awk INI parser worked and was a clever handling of multi-phase output, but pushed to avoid full awk parsing in favor of a simpler check. The final approach trades the heavier parser for a leaner, more readable solution that still tolerates multiple admins and arbitrary ordering/whitespace.

## Related Files

- couchdb/docker-entrypoint.sh

## Testing

No automated tests were added (the 'Tested: Unit and/or e2e' checklist item was left unchecked). Verification was manual: the reviewer confirmed the functionality works, including the multi-admin edge case, before the simplification and again after ('LGTM!').

## Related Issues

- #8816: CouchDB docker-entrypoint should support Couch admins pre-defined in the .ini file; the fragile admin check appended a duplicate [admins] block and corrupted config on restart

## Domain Rationale

**Fit:** strong

The entire change lives in couchdb/docker-entrypoint.sh — a Docker container bootstrap script that provisions CouchDB server-admin credentials at startup. Per the guidance, Docker/CouchDB deploy-lifecycle tooling belongs to infrastructure; although it touches 'admins', it is database-tier container bootstrap, not application-level authentication or roles/permissions.
