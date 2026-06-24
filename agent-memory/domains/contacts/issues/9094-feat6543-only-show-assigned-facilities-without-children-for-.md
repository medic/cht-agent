---
id: cht-core-9094
category: feature
domain: contacts
domainFit: strong
issueNumber: 9094
issueUrl: https://github.com/medic/cht-core/issues/9094
title: Show only assigned facilities without children in the contact list for users with multiple facility_ids
lastUpdated: '2026-06-23'
summary: 'With support for users assigned to multiple facilities (facility_id as an array), the contact list had no sensible way to render multiple homeplaces. The PR branches the contacts UI on facility count: multi-facility users see only their assigned homeplaces (children surfaced via a ''places'' card in the detail view, with sort and highlight hidden), while single-facility users keep the existing homeplace-plus-children behavior.'
services:
  - webapp
techStack:
  - typescript
  - angular
  - ngrx
tags:
  - contacts-list
  - facilities
  - homeplace
  - multiple-facilities
  - facility-id
  - ui
related_workflows: []
source_pr: medic/cht-core#9094
source_sha: 4fdcb59b5a4d888a3825ee736d23beaba5401678
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/contacts/contacts.component.ts
  - webapp/src/ts/modules/contacts/contacts-content.component.ts
  - webapp/src/ts/effects/contacts.effects.ts
  - webapp/src/ts/modules/contacts/contacts.component.html
concepts:
  - contact list rendering
  - homeplace display
  - single vs multiple facility_id user assignment
  - conditional UI rendering based on user context
  - ngrx effects-driven state for contacts
related_issues: []
stale: false
---

## Problem

When users began to be assigned to multiple facilities (facility_id stored as an array), the contacts list UI had no way to display multiple homeplaces cleanly. Rendering all children of every assigned facility cluttered the left-hand contact list, and affordances built for the single-facility case (sort option, light-grey homeplace highlighting) did not fit the multi-facility scenario.

## Root Cause

The contacts list/content components and contacts effects assumed a single facility/homeplace and unconditionally rendered the homeplace's children, the sort control, and the highlighted background, with no branching on how many facilities the user was assigned to.

## Solution

Added conditional logic keyed on whether the user has one or multiple facility_ids. For multiple facilities: render only the assigned homeplaces (no children) in the left-hand list, surface the child places through a 'places' card in the contact detail view, hide the sort option, and skip the light-grey homeplace background. For a single facility: preserve existing behavior (homeplace plus children, sort option, highlighted background, no places card). Changes span contacts.component.ts, contacts-content.component.ts, contacts.effects.ts, and contacts.component.html.

## Code Patterns

Branch UI behavior on the user's facility_id array length (single vs multiple) in webapp/src/ts/modules/contacts/contacts.component.ts and contacts-content.component.ts; conditional template rendering of sort control, homeplace background, and 'places' card in webapp/src/ts/modules/contacts/contacts.component.html; homeplace loading handled in webapp/src/ts/effects/contacts.effects.ts.

## Design Choices

Reviewer (dianabarsan) questioned whether facility_id should be normalized to always be an array at the API level for consistency rather than handling both scalar and array shapes in the webapp. The author confirmed the API would only create users with array facility_id fields going forward, so the webapp works against a single data type while the display differences (children, sort, highlight, places card) are decided in the webapp based on facility count.

## Related Files

- webapp/src/ts/effects/contacts.effects.ts
- webapp/src/ts/modules/contacts/contacts-content.component.ts
- webapp/src/ts/modules/contacts/contacts.component.html
- webapp/src/ts/modules/contacts/contacts.component.ts
- webapp/tests/karma/ts/effects/contacts.effects.spec.ts
- webapp/tests/karma/ts/modules/contacts/contacts-content.component.spec.ts
- webapp/tests/karma/ts/modules/contacts/contacts.component.spec.ts

## Testing

Updated Karma unit specs for contacts.effects, contacts-content.component, and contacts.component to cover single vs multiple facility_id behavior. Additionally verified manually/functionally in a local environment by reviewers (ralfudx and Benmuiruri).

## Related Issues

- #6543: support and contact-list display for users assigned to multiple facilities (multiple facility_ids)

## Domain Rationale

**Fit:** strong

The PR exclusively modifies the webapp contacts module (contacts list/content components, contacts effects, and the contacts template) to change how a user's assigned facilities are displayed. It is a contact-list presentation change, not an access-control change, so the permissions pitfall (authentication) does not apply.
