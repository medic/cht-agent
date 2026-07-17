---
id: cht-core-10459
category: feature
domain: messaging
domainFit: strong
issueNumber: 10459
issueUrl: https://github.com/medic/cht-core/issues/10459
title: Allow multiple SMS recipients to be specified and resolved in order in message-utils
lastUpdated: '2026-06-22'
summary: SMS message configurations could previously target only a single recipient. This PR lets multiple recipients be specified and resolves them in order, giving SMS deployments more flexibility.
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

Message configurations could only specify a single SMS recipient, limiting deployments that need a message delivered to more than one resolved recipient or that want ordered fallback among recipient definitions.

## Root Cause

The recipient-resolution logic in shared-libs/message-utils/src/index.js resolved only a single recipient definition per message rather than accepting and iterating over a list of recipients.

## Solution

Updated message-utils to accept multiple recipients and resolve each in the order specified, so one message configuration can target several recipients with deterministic precedence while remaining backwards compatible with single-recipient configs.

## Code Patterns

Recipient resolution iterates over a list of recipient specifications and resolves each in declared order in shared-libs/message-utils/src/index.js; message generation produces output per resolved recipient.

## Design Choices

Recipients are resolved in the order they are declared to give deployments predictable precedence/fallback behavior; the change preserves the existing single-recipient behavior for backwards compatibility.

## Related Files

- shared-libs/message-utils/src/index.js
- shared-libs/message-utils/test/index.js
- tests/integration/sentinel/schedules/schedules-recipients.spec.js

## Testing

Unit tests added/updated in shared-libs/message-utils/test/index.js for multi-recipient resolution, plus an integration test for sentinel scheduled-message recipients in tests/integration/sentinel/schedules/schedules-recipients.spec.js. Review feedback was limited to minor stylistic comments.

## Related Issues

- #10459: allow multiple sms recipients

## Domain Rationale

**Fit:** strong

The PR changes recipient-resolution logic in the shared message-utils library that builds outgoing SMS messages — core messaging behavior, not a gateway/integration setup (which would be configuration).
