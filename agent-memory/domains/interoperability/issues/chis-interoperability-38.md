---
id: chis-interoperability-38
category: sync
issueNumber: 38
title: DIYM 409 conflict via outbound
lastUpdated: 2026-04-14
summary: Fixed document update conflicts during DIYM outbound push by adding retry loops.
techStack:
  - javascript
  - nodejs
---

## Problem
Frequent Document update conflict (409) errors were occurring via outbound pushes to the DIYM app.

## Solution
Added retry logic with conflict resolution handling.

## Code Patterns
- `conflictRetry(3)` function
- `_rev` selection logic

## Design Choices
- Utilized exponential backoff
- Opted for 'Latest _rev wins' strategy

## Related Files
- src/mediators/diym.js
