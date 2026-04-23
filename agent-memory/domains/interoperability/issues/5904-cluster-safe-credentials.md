---
id: cht-core-5904
category: improvement
domain: interoperability
subDomain: credentials
issueNumber: 5904
issueUrl: https://github.com/medic/cht-core/issues/5904
title: Cluster safe credentials
lastUpdated: 2022-11-08
summary: Integration secrets (API keys, passwords for Africa's Talking, SIH outbound push, etc.) were stored in the CouchDB node configuration (medic-credentials section) which is node-local and not replicated across cluster nodes. Shipped in CHT 4.0.0 (Nov 08, 2022) as a breaking change, credentials are now stored via a new PUT /api/v1/credentials/<key> API endpoint and kept in a cluster-replicated CouchDB location (medic-vault).
services:
  - api
  - sentinel
techStack:
  - javascript
  - nodejs
  - couchdb
---

## Problem

CHT integrations that authenticate to external services (Africa's Talking SMS, SIH, outbound push targets with API key or basic auth) stored their credentials in the CouchDB node configuration under a section called `medic-credentials`. CouchDB protects this section so only admins can read it, but `local.ini` is node-local — it is not replicated across CouchDB nodes in a multi-node cluster. As CHT moved toward horizontal scalability (4.0.0 milestone), every new cluster node required manual credential configuration, and any rotation had to be applied to each node independently. The workaround was to manually set credentials on every node, which was operationally fragile.

## Root Cause

CouchDB's node configuration (`local.ini`) is intentionally not replicated — it holds machine-local settings. Using it for secrets was a pragmatic early choice that worked for single-node deployments but was not cluster-safe. There was also no structured API for setting or rotating credentials; operators wrote directly to the CouchDB node config endpoint.

## Solution

Introduced a dedicated `PUT /api/v1/credentials/<key>` API endpoint (implemented in PR #7577, merged Jul 22, 2022, shipped CHT 4.0.0). Credentials are now stored in a CouchDB document in the `medic-vault` database (or equivalent admin-only location) that replicates across cluster nodes automatically. The API endpoint accepts a plaintext credential value in the request body (`Content-Type: text/plain`) and stores it securely encrypted at rest under the given key.

Example usage:
```bash
curl -X PUT \
  -H "Content-Type: text/plain" \
  https://<user>:<pass>@<domain>/api/v1/credentials/Outbound \
  -d 'my-secret-value'
```

This was a **breaking change**: existing deployments had to migrate credentials from the CouchDB node config (`medic-credentials`) to the new API before upgrading to 4.0.0. Outbound error messages were also updated to reference `medic-vault/credential:<key>` instead of the old `medic-credentials/<key>` path.

## Code Patterns

- Use `PUT /api/v1/credentials/<key>` to write a credential (admin auth required)
- Use `GET /api/v1/credentials/<key>` to read a credential from application code (sentinel, API services) — never read directly from CouchDB node config after 4.0.0
- The credential value is AES-256-CBC encrypted with a random 16-byte IV per write, rather than stored as plaintext. The storage format in the `medic-vault` document is `<iv_hex>:<ciphertext_hex>`.
- Pattern: credentials must never appear in logs at any level (debug, info, error). The haproxy config already had a password-masking regex; ensure any new credential API path also matches that regex
- Outbound push configs reference credentials by key in `password_key`; the sentinel outbound module calls the credentials API at push time, not at startup

## Design Choices

- Chose CouchDB document storage (rather than environment variables or external secret manager) because CouchDB replication handles cluster distribution automatically and is consistent with CHT's existing architecture
- Made this a breaking change at 4.0.0 (alongside the horizontal scalability work) rather than transparently supporting both storage locations, to avoid a period of ambiguous credential sourcing
- Scheduled for 4.0.0 specifically so it would be done alongside the cluster/scalability work (@garethbowen: "this should be done alongside the horizontal scalability work")
- Admin-only access is enforced at the CouchDB layer, not in application code, so the credential document cannot be accessed by non-admin users regardless of which service is making the request
- During AT (@ngaruko, Jul 2022), debug logging was found to emit credentials in plaintext. This was fixed before merge by masking the specific debug log line

## Related Files

- api/src/controllers/credentials.js
- api/tests/mocha/controllers/credentials.spec.js

## Testing

- AT by @ngaruko (Jul 20, 2022) using the outbound-express support script: configured outbound push with `password_key`, set credentials via the new API, verified pushes succeeded and credentials appeared in the `medic-vault` database
- Verified haproxy log masking: credentials do not appear in haproxy logs when the new API path is used
- Caught and fixed during AT: debug logs were emitting the auth section (username + plaintext password) before the masking fix was applied

## Related Issues

- #5604: Integration with Africa's Talking SMS aggregator (first integration requiring the credential storage this issue improves)
- #6306: Send outbound push without delay (outbound push uses credentials fetched via this mechanism)
