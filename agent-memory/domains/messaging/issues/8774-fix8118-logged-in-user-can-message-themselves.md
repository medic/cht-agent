---
id: cht-core-8118
category: bug
domain: messaging
domainFit: strong
issueNumber: 8118
issueUrl: https://github.com/medic/cht-core/issues/8118
title: Prevent the logged-in user from messaging themselves via the fast action button
lastUpdated: '2026-06-23'
summary: The fast action button exposed a send-message action that let a logged-in user select themselves as the recipient. The fix excludes the current user from the send-message fast action so self-messaging is no longer possible.
services:
  - webapp
techStack:
  - typescript
  - angular
  - karma
tags:
  - fast-action-button
  - messaging
  - self-message
  - message-recipient
  - webapp
  - bug-fix
related_workflows:
  - message-processing
source_pr: medic/cht-core#8774
source_sha: 3e126356afba2c75e68a5c70dab2eb8bf60e65c5
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/fast-action-button.service.ts
concepts:
  - fast action button
  - message recipient validation
  - logged-in user context
related_issues: []
stale: false
---

## Problem

A logged-in user could send a message to themselves (issue #8118). The fast action button presented the send-message action with the current user treated as a valid recipient, producing nonsensical self-messages.

## Root Cause

The fast-action-button.service did not compare the candidate message recipient against the currently logged-in user when assembling fast actions, so the user's own contact was treated as a legitimate send-message target.

## Solution

Updated fast-action-button.service.ts to check the logged-in user's identity and suppress the send-message fast action when the target contact is the current user, preventing self-messaging. Behavior is covered by updated unit tests.

## Code Patterns

Guard a context-sensitive fast action by comparing the target contact's `_id` against the logged-in user's linked **`contact_id`** (not the user's own id), resolved asynchronously through a newly injected `UserSettingsService` — `const user: any = await this.userSettingsService.get(); return user?.contact_id === sendTo?._id;` — and AND-ing the negated result into the send-message action's existing async `canDisplay()` next to the phone and permission checks, in webapp/src/ts/services/fast-action-button.service.ts.

## Design Choices

The exclusion check is placed in the fast-action-button.service (where the action list is built) rather than downstream in the message composition flow, centralizing recipient eligibility at the point actions are assembled.

## Related Files

- webapp/src/ts/services/fast-action-button.service.ts
- webapp/tests/karma/ts/services/fast-action-button.service.spec.ts

## Testing

Karma unit tests in fast-action-button.service.spec.ts were added/updated to assert that the send-message fast action is not offered for the logged-in user.

## Related Issues

- #8118: logged in user can message themselves

## Domain Rationale

**Fit:** strong

The bug is fundamentally about messaging behavior — who is a valid message recipient — fixed by excluding the logged-in user from the send-message fast action. Although the change lives in a UI service, the defect and its resolution are squarely about message-recipient correctness, so messaging is a strong, specific fit (not authentication, since no session/permission logic is involved).
