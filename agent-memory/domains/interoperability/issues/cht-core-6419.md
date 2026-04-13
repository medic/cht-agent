---
id: cht-core-6419
category: api
issueNumber: 6419
title: Allow multiple outbound pushes per doc
lastUpdated: 2026-04-14
summary: Enhanced outbound to support multiple targets per document with configurable push rules.
techStack:
  - javascript
  - nodejs
---

## Problem
The system previously only allowed a single outbound push configuration per document.

## Solution
Support multiple targets per document with independent configuration and execution loops.

## Code Patterns
- `multiplePushConfigs` array
- `outbound.forEach(config => push(config))` loop structure

## Design Choices
- Independent push configs
- Per-target error handling

## Related Files
- sentinel/src/schedule/outbound.js
