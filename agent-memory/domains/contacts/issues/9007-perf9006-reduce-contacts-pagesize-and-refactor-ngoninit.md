---
id: cht-core-9006
category: improvement
domain: contacts
domainFit: strong
issueNumber: 9006
issueUrl: https://github.com/medic/cht-core/issues/9006
title: Reduce contacts page_size and refactor contacts ngOnInit to async/await with unified try/catch to improve contact-list Apdex
lastUpdated: '2026-06-23'
summary: The contacts list page had a low Apdex (slow initial render). This PR reduces the contacts page_size so fewer contacts are fetched on initialization and refactors ngOnInit to async/await with a single unified try/catch for cleaner async control flow and consolidated error handling.
services:
  - webapp
techStack:
  - typescript
  - angular
  - rxjs
  - webdriverio
  - karma
tags:
  - performance
  - apdex
  - refactoring
  - contacts
  - page-size
  - infinite-scrolling
  - async-await
  - ngOnInit
  - error-handling
related_workflows:
  - observability
source_pr: medic/cht-core#9007
source_sha: 4ced6937a73b105fa2a970d729e3803afd29893a
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/contacts/contacts.component.ts
concepts:
  - pagination / page_size
  - Angular lifecycle hooks (ngOnInit)
  - async/await control flow
  - unified try/catch error handling
  - infinite scrolling
  - Apdex / perceived load performance
related_issues: []
stale: false
---

## Problem

The contact list page scored poorly on Apdex (issue #9006, 'improve-contact-list-apdex') — the initial load fetched/rendered a large page of contacts, slowing first paint, and the ngOnInit initialization used a less readable async pattern without consolidated error handling.

## Root Cause

ContactsComponent loaded too many contacts per page (large page_size) on init, increasing initial payload and render time, which degraded the contact-list Apdex; ngOnInit's async initialization also lacked a single error-handling path.

## Solution

Reduced the contacts page_size so fewer contacts are loaded on the initial page (smaller initial payload, faster first render, better Apdex) and refactored ngOnInit to use async/await with one unified try/catch block for the initialization sequence, with infinite scrolling continuing to fetch subsequent pages on demand.

## Code Patterns

Refactoring an Angular component's ngOnInit from chained promises/observables to async/await wrapped in a single try/catch for consolidated error handling (webapp/src/ts/modules/contacts/contacts.component.ts). Lowering an initial page_size to trade larger up-front fetches for more frequent on-demand pagination to improve perceived load performance.

## Design Choices

Reducing page_size trades a smaller, faster initial render (improved Apdex) against more frequent infinite-scroll fetches as the user scrolls. Choosing async/await with a single try/catch over promise/observable chaining improves readability and gives one place to handle initialization failures.

## Related Files

- webapp/src/ts/modules/contacts/contacts.component.ts
- webapp/tests/karma/ts/modules/contacts/contacts.component.spec.ts
- tests/e2e/default/contacts/infinite-scrolling.wdio-spec.js

## Testing

Updated the Karma unit spec (contacts.component.spec.ts) to cover the refactored async ngOnInit and reduced page_size, and updated the WDIO e2e infinite-scrolling spec to reflect the new page_size and continued lazy-loading behavior. The change was also verified with a manual quick test.

## Related Issues

- #9006: improve contact list Apdex / perceived load performance

## Domain Rationale

**Fit:** strong

The change is entirely within the contacts list page (contacts.component.ts, its unit spec, and the contacts infinite-scrolling e2e spec), tuning how the contact list loads and initializes. Per the infrastructure pitfall, an in-application performance/refactor change stays in its closest functional domain rather than the ops bucket.
