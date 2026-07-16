---
id: cht-core-9229
category: bug
domain: contacts
domainFit: strong
issueNumber: 9229
issueUrl: https://github.com/medic/cht-core/issues/9229
title: Remove stale old-action-bar logic that blocked editing of home places in the contacts detail view
lastUpdated: '2026-06-23'
summary: Leftover logic from the deprecated action bar in the contacts content component prevented users from editing their home place. The fix removes/corrects that logic so the edit action is available for home places again.
services:
  - webapp
techStack:
  - typescript
  - angular
tags:
  - action-bar
  - home-place
  - contact-editing
  - ui
  - deprecated-code-cleanup
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#9230
source_sha: 9f900220a34754b1eb62a73e6ccbf6b4a3d30c14
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/contacts/contacts-content.component.ts
concepts:
  - deprecated action bar UI component
  - home place / user facility
  - contact edit action gating
  - Angular component state
related_issues: []
stale: false
---

## Problem

Users could not edit their home place (the place assigned to them in the hierarchy). The old action bar code path special-cased home places and suppressed/disabled the edit action, blocking the edit workflow from the contact detail view.

## Root Cause

Residual logic tied to the deprecated action bar in contacts-content.component.ts continued to gate the edit affordance for the user's home place (e.g. a flag controlling edit availability never being set, or being forced off, for the home-place case) after the action bar itself was being phased out.

## Solution

Adjusted contacts-content.component.ts to drop/correct the obsolete action-bar conditional so the edit action is exposed for home places like any other editable place.

## Code Patterns

When deprecating a shared UI element (the action bar), audit each module's component for leftover conditionals that referenced it; stale edit/visibility gating in component state (e.g. canEdit/showEdit-style flags set during action-bar setup) is the typical regression site — webapp/src/ts/modules/contacts/contacts-content.component.ts.

## Design Choices

Removed the stale action-bar logic directly in the contacts component rather than re-introducing the old action bar, aligning with the broader effort to retire the action bar from the webapp.

## Related Files

- webapp/src/ts/modules/contacts/contacts-content.component.ts

## Testing

No tests are indicated as added in the PR (code-review checklist boxes left unchecked); the change is a single-file component fix and was approved on review ("Good catch").

## Related Issues

- #9229: old action bar prevents editing home places

## Domain Rationale

**Fit:** strong

The fix is in the contacts module (contacts-content.component.ts) and restores the ability to edit a user's home place — a place/contact in the hierarchy — which is squarely contact/place management, not permissions or configuration.
