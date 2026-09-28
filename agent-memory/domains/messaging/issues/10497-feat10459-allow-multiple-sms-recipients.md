---
id: cht-core-10459
category: feature
domain: messaging
domainFit: strong
issueNumber: 10459
issueUrl: https://github.com/medic/cht-core/issues/10459
title: Allow multiple SMS recipients to be specified and resolved in order in message-utils
lastUpdated: '2026-07-30'
summary: SMS message configurations could previously name only a single recipient definition. This PR lets an array of recipient definitions be specified and uses the first one that resolves to a phone number, giving deployments an ordered fallback chain. It does not deliver the message to multiple recipients.
services:
  - sentinel
  - api
techStack:
  - javascript
  - nodejs
  - mocha
tags:
  - sms
  - recipients
  - message-utils
  - scheduled-messages
  - messaging
related_workflows:
  - message-processing
source_pr: medic/cht-core#10497
source_sha: 174c06815b1f2205ccc74c2296ffd98cf00011d1
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/message-utils/src/index.js
concepts:
  - recipient resolution
  - sms message generation
  - scheduled messages
related_issues: []
stale: false
---

## Problem

Message configurations could only specify a single SMS recipient definition, so there was no way to declare an ordered fallback chain (try `contact_no_phone`, then `reporting_unit`, then a literal number) for when the preferred recipient does not resolve.

## Root Cause

The recipient-resolution logic in shared-libs/message-utils/src/index.js resolved only a single recipient definition per message rather than accepting and iterating over a list of recipients.

## Solution

Updated message-utils so `recipient` may be a string or an array. `normalizeRecipient` coerces it to a trimmed string array and `resolveMany` walks that array returning the FIRST entry that resolves to a phone number — this is ordered fallback, not fan-out: `generate` still returns a single `[ result ]` with one `to`. If none resolve, `getRecipient` falls back to the sender (when `default_to_sender` is on) or to `recipient[0]`. Single-recipient configs behave exactly as before.

## Code Patterns

Recipient resolution iterates a list of recipient specifications in declared order in shared-libs/message-utils/src/index.js and short-circuits on the first one that resolves (`resolveMany` returns as soon as `resolveRecipient` yields a phone); if none resolve, `getRecipient` falls back to the sender or to `recipient[0]`. Message generation still produces exactly one message object with a single `to`.

## Design Choices

Recipients are resolved in the order they are declared to give deployments predictable precedence/fallback behavior; the change preserves the existing single-recipient behavior for backwards compatibility.

## Related Files

- shared-libs/message-utils/src/index.js
- shared-libs/message-utils/test/index.js
- tests/integration/sentinel/schedules/schedules-recipients.spec.js

## Testing

Unit tests added/updated in shared-libs/message-utils/test/index.js for multi-recipient resolution, plus an integration test for sentinel scheduled-message recipients in tests/integration/sentinel/schedules/schedules-recipients.spec.js.

## Related Issues

- #10459: allow multiple sms recipients

## Domain Rationale

**Fit:** strong

The PR changes recipient-resolution logic in the shared message-utils library that builds outgoing SMS messages — core messaging behavior, not a gateway/integration setup (which would be configuration).
