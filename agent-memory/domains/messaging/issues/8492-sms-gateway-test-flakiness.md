---
id: cht-core-8492
category: bug
domain: messaging
subDomain: testing
issueNumber: 8492
issueUrl: https://github.com/medic/cht-core/issues/8492
title: Fix SMS gateway test flakiness
lastUpdated: 2023-08-30
summary: Fixed flaky SMS gateway e2e tests by improving the message factory and ensuring consistent message state handling in test setup.
services:
  - api
techStack:
  - javascript
  - nodejs
---

## Problem

SMS gateway e2e tests were failing intermittently due to inconsistent message state setup in test factories. The flakiness made CI unreliable and blocked merges.

Tests would sometimes pass and sometimes fail with the same code, particularly around scheduled message state transitions.

## Root Cause

The message factory in tests didn't properly initialize the `scheduled_tasks[0].state` field, causing tests to depend on race conditions and unpredictable test execution order. The test expected messages to be in `forwarded-to-gateway` state but the factory didn't consistently set this state.

## Solution

1. **Improved message factory**: Updated test factories to explicitly set message states rather than relying on defaults
2. **Fixed state initialization**: Ensured `reportWithTwoMessagesToSend.scheduled_tasks[0].state = 'forwarded-to-gateway'` is set consistently
3. **Fixed formatting**: Consolidated split lines for better readability (reviewer noted unnecessary line splits)

The fix ensures tests have deterministic message states, eliminating flakiness.

## Code Patterns

- Always explicitly set message states in test factories, don't rely on defaults
- Use consistent state strings: 'forwarded-to-gateway', 'sent', 'delivered', 'failed'
- Pattern: `tests/e2e/default/sms/gateway.wdio-spec.js` contains SMS gateway e2e tests
- Pattern: Test factories should create messages in known states for predictable test outcomes
- Avoid line splits unless lines are genuinely too long for readability

## Design Choices

Chose to fix the test factory rather than adding retry logic or increasing timeouts because:
- Root cause fix is better than masking symptoms
- Deterministic tests are more maintainable
- Retry logic hides real bugs
- Proper state setup makes tests faster and more reliable

## Related Files

- tests/e2e/default/sms/gateway.wdio-spec.js
- tests/factories/report.js (message factory)

## Testing

- Verified SMS gateway e2e tests pass consistently
- Tested message state transitions in test scenarios
- Confirmed CI reliability improved

## Related Issues

- #8414: Original issue tracking SMS gateway test flakiness
- #6995: RapidPro SMS gateway integration (related testing improvements)
