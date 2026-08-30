---
id: cht-core-10062
category: bug
domain: authentication
domainFit: strong
issueNumber: 10062
issueUrl: https://github.com/medic/cht-core/issues/10062
title: Fix race condition in admin user edit modal that broke Facility and Associated contact field population for SSO users
lastUpdated: '2026-06-22'
summary: The edit user modal in the admin app intermittently failed to populate the Facility and Associated contact fields, reproducibly for SSO-enabled users, due to a race condition in the edit-user controller. The fix corrects the ordering of the asynchronous model population so the fields render reliably.
services:
  - admin
techStack:
  - javascript
  - angularjs
  - webdriverio
tags:
  - sso
  - user-management
  - race-condition
  - edit-user-modal
  - admin-app
  - facility
  - associated-contact
related_workflows:
  - user-registration
source_pr: medic/cht-core#10153
source_sha: cc8758d1dbb3665a933b55a921d5d24e075e2a75
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - admin/src/js/controllers/edit-user.js
concepts:
  - race condition
  - asynchronous data loading
  - modal form model population
  - SSO user management
  - data binding ordering
related_issues:
  - cht-core-9735
stale: false
---

## Problem

When opening the edit user modal in the admin app, the Facility and Associated contact fields sometimes failed to be populated/rendered. The issue was intermittent (reproducible but not on every attempt) and surfaced for SSO-enabled users on CHT v4.20.0, as reported on the community forum and shown in the linked screenshot.

## Root Cause

A race condition in the edit-user.js controller: the user edit model/form fields were being populated before the asynchronous data required for the Facility and Associated contact fields had finished loading, so the bindings could be left empty. The SSO user code path made the timing window more likely to be hit.

## Solution

Reworked the edit-user controller so the Facility and Associated contact fields are populated only after their backing asynchronous data has resolved, eliminating the race so the modal renders the fields reliably for SSO and non-SSO users alike.

## Code Patterns

Ensure async data dependencies are awaited/resolved before assigning them into a form/view model (admin/src/js/controllers/edit-user.js) rather than populating model fields optimistically; guard modal field binding against not-yet-loaded async results to avoid timing-dependent empty fields.

## Design Choices

Fixed the ordering of asynchronous model population in the controller rather than masking the symptom in the view, so the modal behaves deterministically regardless of how quickly the underlying lookups resolve. Added e2e coverage (rather than only a unit fix) to lock in the user-visible behavior given the intermittent nature of the bug.

## Related Files

- tests/e2e/default/users/user.wdio-spec.js
- tests/page-objects/default/users/user.wdio.page.js

## Testing

Added new e2e test cases in tests/e2e/default/users/user.wdio-spec.js covering the edit user modal field population, with supporting selectors/methods added to the user.wdio.page.js page object. The fix was also verified manually in a local environment.

## Related Issues

- #10062: Unable to edit place for SSO-enabled user on CHT v4.20.0 — edit user modal intermittently fails to populate Facility and Associated contact fields

## Domain Rationale

**Fit:** strong

The PR fixes the admin app's user edit modal and the bug manifests specifically for SSO-enabled users; user account management and SSO are squarely the authentication domain. The Facility/Associated-contact fields are properties of the user account, not standalone contact records.
