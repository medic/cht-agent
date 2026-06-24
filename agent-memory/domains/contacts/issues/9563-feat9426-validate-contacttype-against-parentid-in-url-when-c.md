---
id: cht-core-9426
category: improvement
domain: contacts
domainFit: strong
issueNumber: 9426
issueUrl: https://github.com/medic/cht-core/issues/9426
title: Validate contact_type against parent_id in URL when creating a contact to enforce the configured hierarchy
lastUpdated: '2026-06-22'
summary: Users could create a contact under a non-direct parent (e.g. a clinic directly under a district_hospital) by editing the parent_id in the URL, bypassing the configured hierarchy. This PR adds validation in the Contact Edit component so the contact_type being created must be a valid direct child of the parent referenced by parent_id.
services:
  - webapp
techStack:
  - typescript
  - angular
  - karma
tags:
  - contact-creation
  - contact-hierarchy
  - contact-type
  - validation
  - parent-child
  - url-validation
related_workflows:
  - contact-creation
source_pr: medic/cht-core#9563
source_sha: 24f78fd17704a16a86fd1dc4708eb217ad68d547
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/contacts/contacts-edit.component.ts
concepts:
  - contact type hierarchy validation
  - parent-child contact relationship
  - URL parameter (parent_id) validation
  - contactTypeService usage
related_issues: []
stale: false
---

## Problem

It was possible to create a contact under a parent that is not its direct parent according to the configured hierarchy by manually changing the parent_id in the URL — for example creating a clinic directly under a district_hospital when a clinic's direct parent should be a health_center. This allowed invalid contact hierarchies to be persisted.

## Root Cause

The Contact Edit component (contacts-edit.component.ts) did not check that the contact_type being created was a valid direct child of the parent identified by parent_id in the URL. The hierarchy is declared in app_settings but was only enforced through UI navigation, so editing the URL directly bypassed it.

## Solution

Updated the Contact Edit component to look up the parent contact (from parent_id in the URL) and validate, using contactTypeService functions, that the contact_type being created is a direct child of that parent's type; creation is blocked otherwise. Per review feedback, the person contact-type check was also handled explicitly.

## Code Patterns

Explicitly calling contactTypeService functions to resolve and validate parent/child contact-type relationships in webapp/src/ts/modules/contacts/contacts-edit.component.ts instead of relying on implicit checks, making the hierarchy validation readable and predictable for future maintainers.

## Design Choices

Reviewer (jkuester) noted that explicit use of contactTypeService functions makes the validation behavior less surprising to future readers, which was preferred over implicit/derived checks. Validation is enforced at the component level by reading the URL parameter rather than depending solely on UI navigation paths.

## Related Files

- webapp/src/ts/modules/contacts/contacts-edit.component.ts
- webapp/tests/karma/ts/modules/contacts/contacts-edit.component.spec.ts

## Testing

Karma unit tests added/updated in webapp/tests/karma/ts/modules/contacts/contacts-edit.component.spec.ts covering valid and invalid parent/contact_type combinations. Reviewer also manually tested locally ('tested this all locally and worked great'), and the PR includes screen recordings demonstrating that creating a direct-child contact type succeeds while a non-direct-child fails.

## Related Issues

- #9426: It's possible to create a contact under a non-direct parent by changing the parent_id in the URL, bypassing the configured hierarchy

## Domain Rationale

**Fit:** strong

The change lives entirely in the contacts edit component and enforces the parent/child contact-type relationship during contact creation — this is core contact management behavior. Although the hierarchy itself is defined in configuration, this PR only reads/enforces that config rather than changing it, so contacts is the correct, strong fit.
