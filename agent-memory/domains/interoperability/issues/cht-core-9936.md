---
id: cht-core-9936
category: api
issueNumber: 9936
title: User-agent header for RapidPro
lastUpdated: 2026-04-14
summary: Added standard user-agent header to outbound requests for RapidPro compatibility.
techStack:
  - javascript
  - nodejs
---

## Problem
Some RapidPro integrations blocked CHT outbound pushes because they lacked a user-agent header.

## Solution
Added a configurable but default user-agent header to the outbound request structure.

## Code Patterns
- `headers: { 'User-Agent': 'CHT/4.x' }` assignments

## Design Choices
- Adherence to standard HTTP practices
- Allows external tools to identify traffic source

## Related Files
- shared-libs/outbound/index.js
