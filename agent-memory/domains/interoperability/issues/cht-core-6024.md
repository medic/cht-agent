---
id: cht-core-6024
category: api
issueNumber: 6024
title: Fix verbose outbound error logs
lastUpdated: 2026-04-14
summary: Improved logging verbosity to stop outbound errors from spamming syslogs.
techStack:
  - javascript
  - nodejs
---

## Problem
Outbound error logging was too verbose, making it hard to find actual system failures.

## Solution
Added log level control and structured logging for external API errors.

## Code Patterns
- `log.level('error')` toggles
- Structured JSON logging formatting

## Design Choices
- Configurable verbosity limits
- Keep stack traces out of INFO level

## Related Files
- sentinel/src/schedule/outbound.js
