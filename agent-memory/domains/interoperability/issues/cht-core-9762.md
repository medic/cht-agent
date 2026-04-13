---
id: cht-core-9762
category: api
issueNumber: 9762
title: OIDC uses outbound password pattern
lastUpdated: 2026-04-14
summary: Refactored OIDC auth to reuse the outbound password_key rotation pattern.
techStack:
  - javascript
  - nodejs
---

## Problem
OIDC login infrastructure duplicated effort and wasn't using centralized secret handling.

## Solution
Refactored the logic to reuse the outbound push `password_key` rotation pattern.

## Code Patterns
- `passwordKey` object rotation
- Redis token cache logic

## Design Choices
- Shared auth infrastructure for maintainability
- Centralized key management

## Related Files
- shared-libs/auth/oidc.js
