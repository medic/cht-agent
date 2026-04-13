---
id: cht-core-6001
category: api
issueNumber: 6001
title: Alert repeated outbound failures
lastUpdated: 2026-04-14
summary: Added monitoring alerts when outbound pushes repeatedly fail.
techStack:
  - javascript
  - nodejs
---

## Problem
Administrators were unaware when external servers were completely offline causing outbound failures.

## Solution
Added alerts to track and notify when outbound pushes cross failure thresholds.

## Code Patterns
- Failure threshold counter
- Sentinel alert triggers

## Design Choices
- Configurable failure thresholds per target
- Backoff mechanisms

## Related Files
- sentinel/src/schedule/outbound.js
