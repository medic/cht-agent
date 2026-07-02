---
id: cht-core-9264
category: bug
domain: contacts
domainFit: strong
issueNumber: 9264
issueUrl: https://github.com/medic/cht-core/issues/9264
title: Fix telemetry granularity for the contact details page so the load event records the specific contact type
lastUpdated: '2026-06-23'
summary: The contact details page recorded a generic `contact_detail:contact:load` telemetry event instead of one reflecting the contact's actual type. The fix derives the telemetry key from the contact's `contact_type`/`type` (with a default fallback) so loads are recorded at the correct granularity, e.g. `contact_detail:clinic:load`.
services:
  - webapp
techStack:
  - typescript
  - angular
  - ngrx
  - rxjs
  - karma
tags:
  - telemetry
  - contacts
  - contact-details
  - observability
  - bugfix
  - ngrx-effects
related_workflows:
  - observability
source_pr: medic/cht-core#9276
source_sha: 87d4809941b677c243b793e2a1f38687e8d7aa39
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/effects/contacts.effects.ts
concepts:
  - telemetry
  - ngrx-effects
  - contact-type-resolution
  - observability
related_issues: []
stale: false
---

## Problem

On the contact details page the load telemetry event was always recorded with the generic key `contact_detail:contact:load` regardless of the contact's actual type, losing the granularity needed to distinguish loads of different contact types (clinic, health_center, person, etc.). A reviewer logged in as a CHW confirmed master produced `contact_detail:contact:load` where the specific `contact_detail:clinic:load` was expected.

## Root Cause

In contacts.effects.ts the telemetry key construction did not correctly derive the contact's specific type from the contact document's `contact_type`/`type` fields, so it fell through to a default/generic `contact` segment instead of the configured contact type.

## Solution

Updated the contact load effect to build the telemetry key from the contact's `contact_type` (falling back to `type`, then to a default) so the emitted event reflects the specific contact type (e.g. `contact_detail:clinic:load`). Unit tests were added/updated to cover the default value and both the `contact_type` and `type` resolution paths.

## Code Patterns

Derive telemetry granularity from the loaded document's `contact_type`/`type` with an explicit default fallback when constructing telemetry keys inside an NgRx effect (webapp/src/ts/effects/contacts.effects.ts).

## Design Choices

Resolve the type segment by preferring `contact_type`, then `type`, then a generic default — keeping the telemetry key meaningful when type metadata is present while still emitting an event when it is absent, rather than dropping the event or hard-coding a type.

## Related Files

- webapp/src/ts/effects/contacts.effects.ts
- webapp/tests/karma/ts/effects/contacts.effects.spec.ts

## Testing

Updated Karma unit tests in contacts.effects.spec.ts to verify the telemetry key for the default value, `contact_type`, and `type`. Manually verified by a reviewer: as a CHW, master emitted `contact_detail:contact:load` while this branch emitted the correct `contact_detail:clinic:load`.

## Related Issues

- #9264: telemetry granularity for contact details page — load event did not reflect the specific contact type

## Domain Rationale

**Fit:** strong

The change lives entirely in the contacts feature (contacts.effects.ts) and fixes how the contact details page resolves a contact's specific type (e.g. clinic) when building its load-telemetry key; telemetry/observability is the cross-cutting workflow, but the code and the contact-type resolution logic are squarely contact-detail concerns, and per the rules telemetry code is not infrastructure.
