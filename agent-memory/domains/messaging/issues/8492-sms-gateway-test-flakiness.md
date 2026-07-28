---
id: cht-core-8492
category: bug
domain: messaging
subDomain: testing
issueNumber: 8492
issueUrl: https://github.com/medic/cht-core/issues/8492
title: Fix SMS gateway test flakiness
lastUpdated: 2023-08-30
summary: Fixed flaky SMS gateway e2e tests by converting the sms-pregnancy report factory's shared module-level scheduled_tasks array into a function that builds fresh task objects on every call, so per-test mutations no longer leak between tests.
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

`tests/factories/cht/reports/sms-pregnancy.js` built its scheduled tasks once, at module load, into a shared `const scheduled_tasks = [...]` array. Every `pregnancy().build()` therefore received references to the same three task objects. The spec's `beforeEach` mutates them (`reportWithTwoMessagesToSend.scheduled_tasks[0].state = 'forwarded-to-gateway'` and `scheduled_tasks[0].state_history.push(...)`), so those mutations leaked into every subsequent build: `state_history` grew on each run and state from an earlier test survived into the next. The flakiness came from shared mutable fixture state across tests, not from the factory failing to set a state.

## Solution

1. **Made the factory build fresh objects per call**: replaced the module-level `const scheduled_tasks = [...]` with `const scheduledTasks = () => { return [...]; }` and changed the builder to `.attr('scheduled_tasks', scheduledTasks())`, so every `pregnancy().build()` gets its own task objects and cross-test mutation is impossible
2. **No state-initialization change**: the `reportWithTwoMessagesToSend.scheduled_tasks[0].state = 'forwarded-to-gateway'` assignment in the spec's `beforeEach` already existed; this commit only rejoined it onto a single line
3. **Fixed formatting**: Consolidated unnecessarily split lines for better readability

The fix ensures tests have deterministic message states, eliminating flakiness.

## Code Patterns

- Never share mutable fixture objects across factory builds: construct them inside a function so every `.build()` returns fresh objects, otherwise one test's mutations leak into the next
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
- tests/factories/cht/reports/sms-pregnancy.js (sms pregnancy report factory)

## Testing

- Verified SMS gateway e2e tests pass consistently
- Tested message state transitions in test scenarios
- Confirmed CI reliability improved

## Related Issues

- #8414: Original issue tracking SMS gateway test flakiness
- #6995: RapidPro SMS gateway integration (related testing improvements)
