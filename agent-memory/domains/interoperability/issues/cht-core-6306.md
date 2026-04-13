---
id: cht-core-6306
category: api
issueNumber: 6306
title: Outbound Push only sends each report once
lastUpdated: 2026-04-14
summary: Fixed duplicate outbound sends so each document is sent once per config.
techStack:
  - javascript
  - nodejs
---

## Problem
Outbound push was sending duplicate reports resulting in spamming external APIs.

## Solution
Changed outbound push logic to send each doc once per configured push instead of multiple times.

## Code Patterns
- `pushOncePerDoc` flag
- First matching config triggers push

## Design Choices
- Prevents duplicate API calls
- Backward compatibility considerations for upgrades

## Related Files
- sentinel/src/schedule/outbound.js
