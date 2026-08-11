---
id: cht-core-10878
category: bug
domain: contacts
domainFit: strong
issueNumber: 10878
issueUrl: https://github.com/medic/cht-core/issues/10878
title: Prevent null-dereference crash on ContactsContentComponent when navigating away from contacts detail before it finishes loading
lastUpdated: '2026-08-11'
summary: Navigating away cleared selectedContact to null while in-flight async callbacks still accessed its .doc property, throwing a TypeError and crashing the contacts detail page. Fixed with optional chaining and early-return guards in the component.
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

Users hit 'TypeError: Cannot read properties of null (reading 'doc')' on the Contacts Detail page when switching pages while the page was still loading. Reported once by a user with 5176 docs whose app was busy indexing search views after a reports search; the reporter noted the page switching was manual and not especially fast, so the slow load — not the speed of navigation — is what widened the window.

## Root Cause

A race condition: switching pages causes the Redux/ngrx store to clear selectedContact to null, but pending asynchronous callbacks and observable emissions from XmlFormsService and other background tasks (e.g. updateFastActions) still assumed a non-null contact and accessed properties like .doc on it.

## Solution

Added optional chaining (?.) at several selectedContact reads in ContactsContentComponent, and added early returns at the start of updateFastActions() and inside the xmlFormsService subscription callbacks — which were extracted into updateContactTypes() and updateReportForms() — so they exit gracefully when navigation has already cleared the component state.

## Code Patterns

Guard async/observable callbacks against state that navigation can clear: in webapp/src/ts/modules/contacts/contacts-content.component.ts, updateFastActions() and the extracted xmlFormsService callbacks updateContactTypes()/updateReportForms() early-return when selectedContact (or selectedContact.doc) is null, and selectedContact is read with optional chaining (?.) at the guard sites; the .doc reads that follow a guard stay direct.

## Design Choices

Chose minimal defensive null-checks (optional chaining + early returns) over changing the subscription lifecycle itself (e.g. unsubscribing or cancelling pending work on navigation). The two callbacks were lifted into named methods to hold those guards, but they are still subscribed and torn down exactly as before. This is a low-risk, targeted fix for the specific null-access crash without reworking state and subscription management.

## Related Files

- webapp/src/ts/modules/contacts/contacts-content.component.ts
- webapp/tests/karma/ts/modules/contacts/contacts-content.component.spec.ts

## Testing

Unit tests added/updated in the Karma spec (contacts-content.component.spec.ts), covering the cleared/null selectedContact scenarios to confirm the early returns and optional chaining prevent the crash.

## Related Issues

- #10878: titled "Switching pages too quickly can throw errors in the contacts detail page" — the report itself describes manual, unhurried navigation during a slow load; a TypeError 'Cannot read properties of null (reading doc)' seen once while the app was indexing search views for a 5176-doc user

## Domain Rationale

**Fit:** strong

The crash and the entire fix live in ContactsContentComponent (the contacts detail page), guarding access to the selectedContact state. This is core contacts UI behavior, not a sync, forms, or config concern even though the trigger was a slow search load.
