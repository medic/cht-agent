---
id: cht-core-10712
category: bug
domain: contacts
domainFit: strong
issueNumber: 10712
issueUrl: https://github.com/medic/cht-core/issues/10712
title: Fix isRelevantChange using nullish coalescing (??) instead of logical OR (||), which made isRelevantContact/isRelevantReport dead code
lastUpdated: '2026-08-11'
summary: ContactChangeFilterService.isRelevantChange() chained its three checks with `??` instead of `||`; since matchContact() returns a boolean, `false ?? expr` short-circuits to false and the isRelevantContact/isRelevantReport branches were never evaluated. The operator was switched to `||` and test coverage added for the previously unreachable paths.
services:
  - webapp
techStack:
  - typescript
  - angular
  - rxjs
  - karma
tags:
  - nullish-coalescing
  - logical-or
  - dead-code
  - short-circuit-evaluation
  - change-feed
  - operator-bug
  - bug-fix
related_workflows: []
source_pr: medic/cht-core#10713
source_sha: b18edabe91b447c660bd3f133e0cc35b75e2112d
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/contact-change-filter.service.ts
  - ContactChangeFilterService.isRelevantChange
concepts:
  - change-feed filtering
  - short-circuit evaluation semantics
  - nullish coalescing vs logical OR
  - reactive contact-view refresh on DB changes
related_issues: []
stale: false
---

## Problem

isRelevantChange() combined its three relevance checks with the nullish coalescing operator (`??`) rather than logical OR (`||`). Because matchContact() always returns a boolean, when it returned false the expression `false ?? isRelevantContact(...) ?? isRelevantReport(...)` evaluated to false — `??` only falls through on null/undefined, not on false. This left isRelevantContact() and isRelevantReport() as dead, never-executed code, so changes to a related contact or a related report would not be flagged as relevant and the contact view could fail to refresh when such changes occurred.

## Root Cause

Misuse of the nullish coalescing operator: `??` short-circuits only when the left operand is null or undefined. matchContact() returns a strict boolean, so a false result was returned directly instead of falling through to the subsequent checks — defeating the intended logical-OR semantics (relevant if ANY of the three checks is true).

## Solution

Replaced `??` with `||` in isRelevantChange() so the three predicates combine with logical OR — returning true if matchContact, isRelevantContact, or isRelevantReport returns true. Added unit tests exercising the isRelevantContact and isRelevantReport branches that were previously unreachable.

## Code Patterns

Use `||`, not `??`, when OR-combining boolean predicates where falsy short-circuiting is intended: `a() ?? b()` returns a()'s value whenever it is non-nullish (including false), whereas `a() || b()` evaluates b() on any falsy a(). Pattern location: webapp/src/ts/services/contact-change-filter.service.ts (isRelevantChange, ~L82-86).

## Design Choices

Minimal, targeted operator swap (`??` → `||`) restores the originally intended logical-OR behavior without restructuring the method; paired with regression tests covering the formerly dead branches to lock in the fix.

## Related Files

- webapp/src/ts/services/contact-change-filter.service.ts
- webapp/tests/karma/ts/services/contact-change-filter.service.spec.ts

## Testing

Added/updated Karma unit tests in webapp/tests/karma/ts/services/contact-change-filter.service.spec.ts to cover the previously dead isRelevantContact and isRelevantReport code paths, verifying isRelevantChange returns true when only those checks match.

## Related Issues

- #10712: isRelevantChange uses nullish coalescing (??) instead of logical OR (||), making isRelevantContact and isRelevantReport dead code

## Domain Rationale

**Fit:** strong

The fix lives in ContactChangeFilterService, which decides whether an incoming DB change is relevant to the contact currently being viewed — squarely contact-management logic. Although it consumes the change feed, the service is contact-domain logic (matchContact / isRelevantContact / isRelevantReport) for refreshing the contact view, not replication mechanics.
