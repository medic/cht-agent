---
id: cht-core-6419
category: improvement
domain: interoperability
subDomain: outbound-push
issueNumber: 6419
issueUrl: https://github.com/medic/cht-core/issues/6419
title: Allow configuring outbound to send the same record multiple times
lastUpdated: 2020-07-08
summary: In CHT 3.9.0 the outbound push system was changed to only send each document once per configured push target. This broke sync-style integrations such as keeping a contact in sync with an external EMR. The fix (merged Jul 8, 2020 via PR #6469) implemented internal hashing of the REST output so a document is re-sent only when its mapped payload changes, requiring no additional configurer-facing options.
services:
  - sentinel
techStack:
  - javascript
  - nodejs
---

## Problem

Prior to CHT 3.9.0, every time a document changed and passed the `relevant_to` function, outbound push would queue a send (at most once every 5 minutes, with the latest data). In 3.9.0, an optimisation changed the logic so that pushes fire immediately when possible. To avoid sending on every single sentinel write, the simplest safeguard was added: each configured outbound target only sends once per document (tracked in the info doc). This was correct for one-time-notification workflows (e.g. "notify RapidPro when a patient report is created"), but broke sync-style use cases. If a contact's phone number changed in CHT after the first push, that change would never be pushed to an external EMR.

## Root Cause

The 3.9.0 change added a `hasPushed` flag per `(document, outbound-config-key)` pair in the CouchDB info doc. Once set, the outbound scheduler unconditionally skipped re-sending that document for that config key. The design assumed send-once was universally correct, which was not true for sync-style integrations.

## Solution

The chosen solution (option 2 from the issue discussion, selected after discussion with @mhawila) was **internal hashing of the REST output**: the resolved outbound payload is hashed and the hash is stored in the info doc alongside the `hasPushed` flag. On each subsequent scheduler run, the current payload is hashed and compared against the stored hash. If the hash differs, the document is re-sent and the new hash is stored. If the hash is the same, the send is skipped. This requires no new configurer-facing configuration — the behavior is automatic for all outbound configs, shipped in PR #6469.

## Code Patterns

- The hash of the resolved REST payload is stored in the info doc under the outbound config key, alongside the existing sent-state tracking
- On each scheduler run, the outbound push module (`shared-libs/outbound/src/outbound.js` or `sentinel/src/schedule/outbound.js`) resolves the mapping to get the current payload, hashes it (e.g. using `JSON.stringify` + a hash function), and compares to the stored hash
- If the hashes differ (payload changed since last send), the push is attempted and the new hash is saved on success
- If the hashes match (no meaningful change), the send is skipped — this handles the case where sentinel re-processes a doc without the user changing anything relevant
- Pattern: only hash the **resolved output** (what is actually sent to the external service), not the raw CHT document — this ensures that changes to unmapped fields do not trigger unnecessary pushes

## Design Choices

- Chose hashing (option 2) over `sync: true` flag (option 1) because `sync: true` would re-send on every sentinel write regardless of whether the external-facing data actually changed, leading to unnecessary API calls
- Chose hashing over `uniqueness: [...]` fields (option 3) because it requires zero extra configuration and is transparent to configurers; the trade-off is that non-deterministic mappings (e.g. including a timestamp in the payload) will cause continuous re-sends, which is documented as a known limitation
- No new top-level config key was added; the behavior change is backward-compatible because the hash check replaces the simple `hasPushed` boolean

## Related Files

- shared-libs/outbound/src/outbound.js
- sentinel/src/schedule/outbound.js
- sentinel/tests/unit/schedule/outbound.spec.js

## Testing

- Unit tests verify that a document whose resolved payload hash differs from the stored hash triggers a re-send
- Unit tests verify that a document whose resolved payload has not changed does not trigger a re-send
- Tests for documents with non-deterministic payloads confirm that a new hash is stored on each send

## Related Issues

- #6306: Send outbound push without delay (introduced the 3.9.0 once-per-doc behavior that this issue revisits)
- #6024: The outbound error response logging is needlessly verbose (raised during AT of this PR)
