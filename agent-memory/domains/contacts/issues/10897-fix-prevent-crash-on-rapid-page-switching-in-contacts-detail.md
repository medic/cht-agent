---
id: cht-core-10878
category: bug
domain: contacts
domainFit: strong
issueNumber: 10878
issueUrl: https://github.com/medic/cht-core/issues/10878
title: Prevent null-dereference crash on ContactsContentComponent when rapidly switching pages in contacts detail
lastUpdated: '2026-06-22'
summary: Rapid page navigation cleared selectedContact to null while in-flight async callbacks still accessed its .doc property, throwing a TypeError and crashing the contacts detail page. Fixed with optional chaining and early-return guards in the component.
services:
  - webapp
techStack:
  - typescript
  - angular
  - rxjs
  - ngrx
tags:
  - race-condition
  - null-check
  - optional-chaining
  - defensive-programming
  - navigation
  - component-lifecycle
related_workflows: []
source_pr: medic/cht-core#10897
source_sha: 8448813cff0f267d2703b4c6ecbaaddfdc6019fe
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/contacts/contacts-content.component.ts
concepts:
  - race condition between navigation and async callbacks
  - ngrx selectedContact state cleared on navigation
  - defensive null-checking via optional chaining
  - early-return guards in subscription callbacks
  - observable emission lifecycle vs component state
related_issues: []
stale: false
---

## Problem

Users hit 'TypeError: Cannot read properties of null (reading 'doc')' on the Contacts Detail page when navigating between pages very quickly. It was most reproducible for users with large datasets (~5000 docs) where slow loads created a window during which rapid navigation crashed the app.

## Root Cause

A race condition: fast page switching causes the Redux/ngrx store to clear selectedContact to null, but pending asynchronous callbacks and observable emissions from XmlFormsService and other background tasks (e.g. updateFastActions) still assumed a non-null contact and accessed properties like .doc on it.

## Solution

Added optional chaining (?.) throughout ContactsContentComponent when reading selectedContact, and added early returns at the start of updateFastActions() and inside the xmlFormsService subscription callbacks so they exit gracefully when navigation has already cleared the component state.

## Code Patterns

Guard async/observable callbacks against state that navigation can clear: in webapp/src/ts/modules/contacts/contacts-content.component.ts, updateFastActions() and the xmlFormsService subscription callbacks early-return when selectedContact is null, and selectedContact is accessed with optional chaining (?.) wherever properties like .doc are read.

## Design Choices

Chose minimal defensive null-checks (optional chaining + early returns) over restructuring the subscription lifecycle (e.g. unsubscribing/cancelling pending work on navigation). This is a low-risk, targeted fix for the specific null-access crash without reworking state and subscription management.

## Related Files

- webapp/src/ts/modules/contacts/contacts-content.component.ts
- webapp/tests/karma/ts/modules/contacts/contacts-content.component.spec.ts

## Testing

Unit tests added/updated in the Karma spec (contacts-content.component.spec.ts) at reviewer dianabarsan's request, covering the cleared/null selectedContact scenarios to confirm the early returns and optional chaining prevent the crash.

## Related Issues

- #10878: TypeError 'Cannot read properties of null (reading doc)' crash on the Contacts Detail page when rapidly switching pages, surfaced by a large (~5000 doc) dataset

## Domain Rationale

**Fit:** strong

The crash and the entire fix live in ContactsContentComponent (the contacts detail page), guarding access to the selectedContact state. This is core contacts UI behavior, not a sync, forms, or config concern even though the trigger was a slow search load.
