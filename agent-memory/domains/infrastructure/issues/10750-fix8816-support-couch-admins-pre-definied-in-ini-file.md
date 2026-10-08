---
id: cht-core-8816
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 8816
issueUrl: https://github.com/medic/cht-core/issues/8816
title: Fix fragile CouchDB docker-entrypoint admin check by parsing the [admins] block in cluster-credentials.ini to avoid duplicate admin blocks on restart
lastUpdated: '2026-10-08'
summary: "couchdb/docker-entrypoint.sh used a brittle multiline grep that only matched the admin user if it sat on the exact line after the [admins] header, so when another admin was listed first it silently failed and appended a second [admins] block, which issue #8816 reports invalidated the existing one. It was replaced with a section-aware check that finds the username anywhere in the [admins] block and, if it is missing, inserts it into the existing section instead of adding a new header; the secret, uuid, log-level and synced-admin writes were also moved to header-anchored inserts."
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

On CouchDB container startup the entrypoint script checks whether the configured server admin already exists in `/opt/couchdb/etc/local.d/cluster-credentials.ini` (`CLUSTER_CREDENTIALS`). Before this PR, the check in couchdb/docker-entrypoint.sh was `grep -Pzq "\[admins\]\n$COUCHDB_USER ="`, which only matched when the admin appeared on the line immediately following the [admins] header. When another admin was listed first, or spacing differed, the check silently failed and the script appended a second `[admins]` block holding the user at the bottom of the file; issue #8816 reports that this invalidates the existing section, since CouchDB apparently does not merge sections within the same file. The appended block puts the user directly after its own header, so later restarts match it and do not append again.

## Root Cause

The existence check hardcoded a positional assumption (target user must be the first line after the [admins] header) via a fixed multiline regex, with no tolerance for multiple admin entries, ordering, or surrounding whitespace, and the insertion always wrote a fresh header (`printf "\n[admins]\n%s = %s\n"`) instead of adding the user to an existing section. This made the idempotency guard order-dependent and non-robust, allowing duplicate [admins] sections to be written. Before this PR, the secret, uuid and log-level guards (`grep -Pzq "\[couch_httpd_auth\]\nsecret ="` and its siblings) and the `COUCHDB_SYNC_ADMINS_NODE` path, which appended an `[admins]` block with the hashed password whenever `grep -Pzq "$COUCHDB_USER = $COUCHDB_HASHED_PASSWORD"` missed, used the same grep-then-append pattern.

## Solution

Replaced the fragile positional regex with a section-aware check. For the default admin, couchdb/docker-entrypoint.sh appends an empty `[admins]` header only if `grep -q '^\s*\[\s*admins\s*\]\s*$'` finds none, then looks for the user with `sed -n '/^\s*\[\s*admins\s*\]\s*$/,/^\s*\[/p' "$CLUSTER_CREDENTIALS" | grep -q "^\s*${COUCHDB_USER}\s*="` — only the lines from the `[admins]` header to the next section header, in any position, with optional whitespace. When the admin is detected, the insertion is skipped, preserving config integrity across container restarts; otherwise the line built by `printf '%s = %s' "$COUCHDB_USER" "$COUCHDB_PASSWORD"`, passed as `ADMIN_CREDS_LINE`, is inserted directly after the header with `awk '/^\s*\[\s*admins\s*\]\s*$/{print; print ENVIRON["ADMIN_CREDS_LINE"]; next}1'`. `setSecret` and `setUuid` use the same header-then-key checks and insert a missing value with `sed`'s `a` command; existing secret and uuid values are still never overwritten. When `COUCHDB_LOG_LEVEL` is set, every `level =` line in the file is deleted and the new value is inserted after the `[log]` header. In the `COUCHDB_SYNC_ADMINS_NODE` path, an `awk -v user="$COUCHDB_USER"` script now always drops the user's old line from `[admins]` and inserts the freshly fetched hashed password. These edits, and the `/opt/couchdb/etc/vm.args` node-name edit that used `sed -i`, now write to a `.tmp` file, `cp` it over the original, then `rm` it.

## Code Patterns

Idempotent INI guard in shell: scope the existence check to the target section with a `sed -n '/^\s*\[\s*admins\s*\]\s*$/,/^\s*\[/p'` range piped to `grep -q`, create the header only if it is missing, and insert the key right after the header instead of appending a new section, rather than relying on a fixed positional multiline grep — see couchdb/docker-entrypoint.sh. Insert credential lines with `awk` reading `ENVIRON["ADMIN_CREDS_LINE"]` rather than interpolating the password into a `sed` script, so special characters in it are not interpreted; plain values such as the uuid go through `sed`. Rewrite the file through a `.tmp` copy and `cp` rather than `sed -i`, which replaces the file. General pattern for safe, restart-idempotent config mutation in container entrypoints; on master, PR #11126's `set_nouveau_url` follows it for the `[nouveau]` section.

## Design Choices

The existence check uses `grep` over a `sed` range rather than a full INI parser, and `awk` is used only where a credential line is inserted, because putting the password into a `sed` command broke on the special-character `COUCHDB_PASSWORD` that couchdb/tests/Makefile uses; `ENVIRON` hands the line to awk without shell or regex interpretation. The PR keeps the earlier rule that an existing secret or uuid wins over `COUCHDB_SECRET`/`COUCHDB_UUID`, while the synced admin's hashed password is always refreshed from `COUCHDB_SYNC_ADMINS_NODE`. The `.tmp` + `cp` + `rm` sequence overwrites `/opt/couchdb/etc/local.d/cluster-credentials.ini` and `/opt/couchdb/etc/vm.args` in place instead of replacing them, as `sed -i` does.

## Related Files

- couchdb/docker-entrypoint.sh

## Testing

The PR changes only couchdb/docker-entrypoint.sh and adds no tests. The existing `unit-couchdb` script (`cd couchdb/tests && make test`, part of the root `unit` script) builds the CouchDB image, starts three nodes from couchdb/tests/compose.yml with the special-character `COUCHDB_PASSWORD` from couchdb/tests/Makefile, and runs couchdb/tests/couch-cluster.spec.js, so it exercises the entrypoint's credential writes; no case covers a pre-existing `[admins]` section with several admins.

## Related Issues

- #8816: "Fragile text search can invalidate CouchDb admins on container restart" — the issue this PR fixes

## Domain Rationale

**Fit:** strong

The entire change lives in couchdb/docker-entrypoint.sh — the CouchDB container's bootstrap script, which writes the server admin, cookie secret, uuid and log level into the node's local config at startup. Although it touches `[admins]`, it is database-tier container bootstrap, not application-level authentication or roles/permissions.
