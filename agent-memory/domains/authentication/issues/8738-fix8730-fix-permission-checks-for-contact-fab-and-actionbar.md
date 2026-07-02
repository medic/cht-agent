---
id: cht-core-8738
category: bug
domain: authentication
domainFit: strong
issueNumber: 8738
issueUrl: https://github.com/medic/cht-core/issues/8738
title: Fix permission checks for contact FAB and actionbar by adding a separate con_create_people check
lastUpdated: '2026-06-23'
summary: The contact page floating action button (FAB) and actionbar did not perform a dedicated `con_create_people` permission check, so the create-person action was not correctly gated. The fix adds separate `con_create_people` checks in both the FAB service and the actionbar template.
services:
  - webapp
techStack:
  - typescript
  - angular
  - html
  - webdriverio
  - karma
tags:
  - permissions
  - con_create_people
  - authorization
  - fab
  - actionbar
  - contacts
  - ui-gating
related_workflows:
  - contact-creation
source_pr: medic/cht-core#8738
source_sha: 91c9349205324af36106749fe6d60042dbceb8f0
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/fast-action-button.service.ts
  - webapp/src/ts/components/actionbar/actionbar.component.html
concepts:
  - permission-based UI gating
  - authorization
  - fast action button
  - actionbar
  - role-based access control
related_issues: []
stale: false
---

## Problem

On the contact page, the floating action button (FAB) and actionbar exposed the create-person action without a separate `con_create_people` permission check, so visibility of contact/people-creation actions was not correctly restricted to users who actually hold that permission.

## Root Cause

The fast-action-button service and the actionbar template lacked a dedicated `con_create_people` permission check; the create-person action's visibility was not independently gated by that permission.

## Solution

Added separate `con_create_people` permission checks in `fast-action-button.service.ts` (FAB) and `actionbar.component.html` (actionbar) so the create-person action is only shown to users granted that permission.

## Code Patterns

Permission-gated UI: evaluate the `con_create_people` permission in fast-action-button.service.ts to decide whether to expose the create-person fast action, and use the same permission to conditionally render the action in actionbar.component.html.

## Design Choices

Used a distinct `con_create_people` check rather than reusing or conflating an existing contact permission, giving granular control over who can create people from a contact page independent of other contact actions.

## Related Files

- webapp/src/ts/services/fast-action-button.service.ts
- webapp/src/ts/components/actionbar/actionbar.component.html
- webapp/tests/karma/ts/services/fast-action-button.service.spec.ts
- tests/e2e/default/contacts/fab-actionbar.wdio-spec.js
- tests/page-objects/default/common/common.wdio.page.js
- api/package-lock.json

## Testing

Added/updated Karma unit tests in fast-action-button.service.spec.ts to cover the new permission check, plus e2e coverage in fab-actionbar.wdio-spec.js with supporting page-object updates in common.wdio.page.js. Reviewer (Benmuiruri) approved and noted a leftover console.log in the test.

## Related Issues

- #8730: contact FAB and actionbar permission checks for con_create_people not correctly gating the create-person action

## Domain Rationale

**Fit:** strong

The PR's substance is permission/authorization gating — adding a distinct `con_create_people` check before exposing the create-person action. Per the classification rules, roles/permissions belong to authentication even when the affected surface is the contacts UI.
