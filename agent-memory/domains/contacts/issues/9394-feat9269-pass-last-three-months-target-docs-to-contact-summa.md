---
id: cht-core-9269
category: feature
domain: contacts
domainFit: strong
issueNumber: 9269
issueUrl: https://github.com/medic/cht-core/issues/9269
title: Expose an analytics.getTargetDocs() cht-datasource API and pass the logged-in user's last three months of target docs into the contact summary
lastUpdated: '2026-08-11'
summary: Contact summaries only received the contact's current-month target doc, and nothing on the datasource API the webapp hands to config scripts exposed target data. This PR adds an `analytics.getTargetDocs()` entry to that surface — declared as an empty-array stub by `CHTDatasourceService` and overwritten with the real function by `contact-summary.service.ts` before the generator runs — and passes the latest three months of target docs into the contact-summary context — the logged-in user's own docs when viewing one of that user's facilities.
services:
  - webapp
techStack:
  - typescript
  - angular
  - ngrx
  - rxjs
  - cht-datasource
tags:
  - contact-summary
  - target-docs
  - analytics-datasource
  - cht-datasource
  - target-aggregates
  - calendar-interval
  - ngrx
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#9394
source_sha: bbe5dedd5ad345178b592c5a96d70e8314c172a0
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/cht-datasource.service.ts
  - webapp/src/ts/services/contact-summary.service.ts
  - webapp/src/ts/services/target-aggregates.service.ts
  - webapp/src/ts/services/calendar-interval.service.ts
  - webapp/src/ts/modules/contacts/contacts-content.component.ts
  - webapp/src/ts/modules/analytics/analytics-target-aggregates.component.ts
concepts:
  - contact summary context
  - cht-datasource API namespace
  - target documents / target aggregates
  - monthly calendar reporting interval
  - NgRx state (actions/reducers/selectors/effects)
related_issues: []
stale: false
---

## Problem

Contact summaries already received the contact's current-month target doc as the 6th positional argument (`targetDoc`), but there was no way to reach earlier months and nothing exposed target data on the API `CHTDatasourceService` builds for config scripts. Configurators could therefore not surface recent target progress (e.g. a CHW's last-three-months target performance) on a contact's profile.

## Root Cause

This is a capability gap rather than a bug: the object `CHTDatasourceService` exposes to config scripts had no analytics namespace, and before this PR `contacts.effects.ts` called `getCurrentTargetDoc()` on `TargetAggregatesService` and forwarded exactly one doc — the contact's current-month target doc — into contact-summary.service.ts as the optional `targetDoc` parameter. Earlier months were never fetched.

## Solution

cht-datasource.service.ts declares `analytics.getTargetDocs` as an empty-array stub; contact-summary.service.ts overwrites it with `() => targetDocs` just before invoking the generator, so the config script is the consumer. The docs themselves are fetched in contacts.effects.ts via `TargetAggregatesService.getTargetDocs()`, which walks back `MAX_TARGET_MONTHS = 3` intervals using calendar-interval.service.ts. When the contact is one of the logged-in user's own facilities, the logged-in user's target docs are passed instead of the contact's. Target-doc state continues to flow through the pre-existing contacts NgRx slice (`receiveSelectedContactTargetDoc`); this PR changed the global slice to carry `userFacilityIds` (pluralised) and a new `userContactId`, which contacts.effects.ts needs to decide whose target docs to load.

## Code Patterns

Extend the cht-datasource API with a new namespace entry (analytics.getTargetDocs()) in webapp/src/ts/services/cht-datasource.service.ts as a stub, then have contact-summary.service.ts assign the real closure onto it before running the config's generator function — keeps config-facing inputs on a stable API rather than ad-hoc props. Use calendar-interval.service.ts to derive monthly reporting windows. Load the data in contacts.effects.ts and keep it in the contacts NgRx slice; the global slice carries the `userFacilityIds`/`userContactId` that the effect needs.

## Design Choices

Bounded to the last three months of target docs to limit payload size and match the monthly cadence of target aggregates. Delivered through the cht-datasource analytics namespace for a stable, typed contract to contact-summary configs. The logged-in user's own target docs are only passed when the viewed contact is one of that user's facilities, scoping the data to relevant self/facility views.

## Related Files

- webapp/src/ts/services/cht-datasource.service.ts
- webapp/src/ts/services/contact-summary.service.ts
- webapp/src/ts/services/target-aggregates.service.ts
- webapp/src/ts/services/calendar-interval.service.ts
- webapp/src/ts/services/contact-types.service.ts
- webapp/src/ts/services/user-settings.service.ts
- webapp/src/ts/modules/contacts/contacts-content.component.ts
- webapp/src/ts/modules/contacts/contacts-report.component.ts
- webapp/src/ts/modules/contacts/contacts.component.ts
- webapp/src/ts/effects/contacts.effects.ts
- webapp/src/ts/actions/global.ts
- webapp/src/ts/reducers/global.ts
- webapp/src/ts/selectors/index.ts
- webapp/src/ts/modules/analytics/analytics-target-aggregates.component.ts
- webapp/src/ts/modules/analytics/analytics-target-aggregates-detail.component.ts

## Testing

Updated/added Karma unit specs across the touched layer: cht-datasource.service.spec.ts, contact-summary.service.spec.ts, target-aggregates.service.spec.ts, contact-types.service.spec.ts, contacts.component.spec.ts, contacts-content.component.spec.ts, contacts-report.component.spec.ts, contacts.effects.spec.ts, reducers/global.spec.ts, selectors/index.spec.ts, app.component.spec.ts. Added/updated WDIO e2e for target aggregates and contact-summary target aggregates: tests/e2e/default/targets/target-aggregates.wdio-spec.js, tests/e2e/default/targets/config/contact-summary-target-aggregates.js, tests/e2e/default/targets/utils/aggregates-helper-functions.js.

## Related Issues

- #9269: pass last three months target docs to contact summary

## Domain Rationale

**Fit:** strong

The deliverable enhances the contact summary — a core contacts-domain feature — with the keystone change in contact-summary.service.ts and most integration work in the contacts module (contacts.component, contacts-content, contacts-report, contacts.effects). It overlaps tasks-and-targets because the data plumbed in is target docs via a new analytics datasource (target-aggregates.service, analytics components); tags/relatedWorkflows capture that tasks-and-targets dimension.
