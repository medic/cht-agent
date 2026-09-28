---
id: cht-core-10473
category: feature
domain: messaging
domainFit: strong
issueNumber: 10473
issueUrl: https://github.com/medic/cht-core/issues/10473
title: Add `default_to_sender` app setting to control whether messages fall back to the original sender when no other recipient resolves
lastUpdated: '2026-07-30'
summary: CHT always fell back to sending an outgoing message to the original sender when a configured recipient could not be resolved. This adds an `sms.default_to_sender` app setting (default true) so administrators can disable that fallback; when disabled the message is instead addressed to the unresolved recipient string, and messages with no configured recipient still go to the sender.
services:
  - sentinel
  - api
techStack:
  - javascript
  - nodejs
tags:
  - sms
  - message-routing
  - recipient-resolution
  - app-settings
  - default_to_sender
  - backwards-compatible
related_workflows:
  - message-processing
source_pr: medic/cht-core#10477
source_sha: fbb0a18aeb748f76b07399cfbb47e6b299cf24c8
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/message-utils/src/index.js
concepts:
  - message recipient resolution
  - sender fallback behavior
  - configurable app settings
  - SMS message routing
related_issues: []
stale: false
---

## Problem

When CHT generated an outgoing message but could not resolve a specific recipient, message-utils unconditionally defaulted to sending the message back to the original sender. There was no way for an administrator to opt out, so messages were delivered to senders even when that was undesirable.

## Root Cause

The recipient resolution logic in shared-libs/message-utils/src/index.js hard-coded a fallback to the original sender (`from`) when no other recipient could be determined, with no configuration hook to disable it.

## Solution

Introduced an `sms.default_to_sender` app setting, read in `getPhone` as `getRecipient(context, recipient, config?.sms?.default_to_sender ?? true)`. The final line of `getRecipient` changed from `return phone || from || recipient;` to `return phone || (defaultToSender && from) || recipient;`, so when the setting is false and a configured recipient cannot be resolved the message is still generated but addressed to the raw recipient string (the integration test asserts `to: 'patient.message_phone'`). The setting does not apply when no recipient is configured at all: the untouched `if (!recipient) { return from; }` guard still returns the sender unconditionally. The `?? true` default preserves the prior send-to-sender behaviour. The PR also refactored `getRecipient`'s if/else chain into a `resolveRecipient` resolver table plus a new `resolveAncestor(context, levels)` helper.

## Code Patterns

Gate an existing implicit default behavior behind an app-settings flag while defaulting that flag to the legacy behavior, keeping the change backwards compatible. See the sender-fallback branch in recipient resolution within shared-libs/message-utils/src/index.js.

## Design Choices

Implemented as an opt-out app setting that defaults to the current behavior (fall back to sender) rather than changing the default outright, so existing configurations and data continue to behave exactly as before unless an admin explicitly disables the fallback.

## Related Files

- shared-libs/message-utils/src/index.js
- shared-libs/message-utils/test/index.js
- tests/integration/transitions/sms-workflows.spec.js

## Testing

Added/updated unit tests in shared-libs/message-utils/test/index.js covering both the enabled and disabled states of default_to_sender, and updated the integration test tests/integration/transitions/sms-workflows.spec.js to exercise SMS transition workflows with the new setting.

## Related Issues

- #10473: allow user to configure whether to send message to sender or not

## Domain Rationale

**Fit:** strong

The change modifies recipient/sender resolution logic in the message-utils shared library — core SMS/message delivery behavior — and is exercised via the SMS workflow transition tests; the new app setting is merely the toggle, so the substantive domain is messaging rather than configuration.
