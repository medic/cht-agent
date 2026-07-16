---
id: cht-core-9269
category: feature
domain: contacts
domainFit: strong
issueNumber: 9269
issueUrl: https://github.com/medic/cht-core/issues/9269
title: Expose an analytics.targetDocs() cht-datasource API and pass the logged-in user's last three months of target docs into the contact summary
lastUpdated: '2026-06-23'
summary: Contact summaries had no access to target/analytics data. This PR adds an `analytics.targetDocs()` namespace to the webapp CHTDatasourceAPI and passes the latest three months of the logged-in user's target docs into the contact-summary context when viewing one of the user's own facilities.
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

Contact-summary scripts had no way to access a contact's or the logged-in user's target/analytics data, so configurators could not surface recent target progress (e.g. a CHW's last-three-months target performance) on a contact's profile.

## Root Cause

This is a capability gap rather than a bug: the CHTDatasourceAPI exposed to webapp had no analytics namespace, and contact-summary.service.ts built the summary context from only the contact, reports and lineage — target docs were never fetched or forwarded.

## Solution

Added an `analytics` namespace with `targetDocs()` to cht-datasource.service.ts that returns the latest three months of target docs, computing the window via calendar-interval.service.ts and retrieving docs through target-aggregates.service.ts. Wired contact-summary.service.ts to pass those target docs into the contact-summary context, and when the contact is one of the logged-in user's own facilities, the logged-in user's target docs are passed. Target-doc state is threaded through NgRx (global actions/reducers/selectors and contacts.effects.ts).

## Code Patterns

Extend the cht-datasource API with a new typed namespace (analytics.targetDocs()) in webapp/src/ts/services/cht-datasource.service.ts, then consume it from contact-summary.service.ts to enrich the summary context — keeps config-facing inputs on a stable API rather than ad-hoc props. Use calendar-interval.service.ts to derive monthly reporting windows. Thread the new data through NgRx global actions/reducers/selectors and contacts.effects.ts.

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

The deliverable enhances the contact summary — a core contacts-domain feature — with the keystone change in contact-summary.service.ts and most integration work in the contacts module (contacts.component, contacts-content, contacts-report, contacts.effects). It overlaps tasks-and-targets because the data plumbed in is target docs via a new analytics datasource (target-aggregates.service, analytics components); tags/relatedWorkflows capture that dimension so a reviewer could re-bin to tasks-and-targets if they weight the payload over the feature destination.
