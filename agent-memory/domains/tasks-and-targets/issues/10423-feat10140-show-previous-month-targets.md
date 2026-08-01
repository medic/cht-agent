---
id: cht-core-10140
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 10140
issueUrl: https://github.com/medic/cht-core/issues/10140
title: Show previous month targets in the analytics tab and add a target resource to cht-datasource (local + remote) so online users can fetch aggregates
lastUpdated: '2026-08-01'
summary: CHWs could only see the current month's target indicators, which reset at the start of each month, leaving them unavailable for the monthly presentation meetings held days into the new month. This PR adds an analytics filter to view the previous month's targets/aggregates and, in the process, fixes aggregate targets returning 0 in non-English locales and not working for online users.
services:
  - api
  - webapp
techStack:
  - typescript
  - javascript
  - angular
  - couchdb
  - less
tags:
  - targets
  - target-aggregates
  - analytics
  - previous-month
  - cht-datasource
  - offline-online
related_workflows: []
source_pr: medic/cht-core#10423
source_sha: 622c625427f6b243fb20f8c95fc6442e2be591eb
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/target.ts
  - shared-libs/cht-datasource/src/local/target.ts
  - shared-libs/cht-datasource/src/remote/target.ts
  - api/src/controllers/target.js
  - webapp/src/ts/modules/analytics/analytics-target-aggregates.component.ts
  - webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
concepts:
  - target aggregates
  - target documents and reporting intervals
  - cht-datasource data access abstraction
  - local (offline/PouchDB) vs remote (online/API) data sources
  - analytics interval filtering
related_issues: []
stale: false
---

## Problem

CHWs' Analysis/analytics tab only showed the current month's target indicators, which reset at the start of each reporting interval; since presentation meetings happen between the 5th and 15th, the previous period's indicators were no longer viewable (#10140). Additionally, aggregate targets always displayed 0 when the user language was a non-English locale such as Nepali (#10525), and target aggregates did not work correctly for online users (#10354).

## Root Cause

Targets were retrieved only for the current interval and only through the local/offline data path; online users (who don't replicate target docs to a local PouchDB) had no working path to obtain aggregates (#10354). There was no UI or data path to request a prior interval's targets (#10140), and the aggregate matching/computation was locale-sensitive, yielding 0 counts under non-English languages (#10525).

## Solution

Introduced a 'target' resource in the cht-datasource shared library with both local (offline) and remote (online) implementations plus qualifier-based lookups, and added a corresponding API controller (api/src/controllers/target.js) and route so online users can fetch target aggregates from the server. Added an analytics sidebar/period filter allowing users to switch between the current and previous month and view that interval's targets and aggregates, and corrected the locale-dependent aggregate computation. Per review feedback, the document type was kept as 'target' (its actual type) rather than 'target-interval'.

## Code Patterns

New cht-datasource resource follows the established layered pattern: public entry (shared-libs/cht-datasource/src/target.ts), offline implementation (src/local/target.ts), online implementation (src/remote/target.ts), with qualifier-based identification (src/qualifier.ts) — mirroring contact/report/person/place. Server access is exposed via a thin controller + route pair (api/src/controllers/target.js, api/src/routing.js).

## Design Choices

Target docs are typed 'target' (their true type) instead of 'target-interval'. The cht-datasource abstraction was used to unify online and offline target retrieval, which is what enabled online users to fetch aggregates. A generator-based approach was used.

## Related Files

- api/src/controllers/target.js
- api/src/routing.js
- shared-libs/cht-datasource/src/target.ts
- shared-libs/cht-datasource/src/local/target.ts
- shared-libs/cht-datasource/src/remote/target.ts
- shared-libs/cht-datasource/src/qualifier.ts
- webapp/src/ts/modules/analytics/analytics-target-aggregates.component.html
- webapp/src/ts/modules/analytics/analytics-sidebar-filter.component.ts
- webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
- webapp/src/css/targets.less

## Testing

Added/updated mocha unit tests for the API target controller (api/tests/mocha/controllers/target.spec.js) and the datasource target modules (the new shared-libs/cht-datasource/test/target.spec.ts, test/local/target.spec.ts, test/remote/target.spec.ts); integration tests for the API controller and datasource (tests/integration/api/controllers/target.spec.js, tests/integration/shared-libs/cht-datasource/target.spec.js); and e2e WDIO tests for analytics/target aggregates (tests/e2e/default/targets/analytics.wdio-spec.js, target-aggregates.wdio-spec.js) with updated page objects and helper functions. Telemetry test util was also updated.

## Related Issues

- #10140: feature request to view the previous reporting period's target indicators for monthly CHW presentation meetings
- #10525: aggregate targets always show 0 when the user language is set to a non-English locale (e.g. Nepali)
- #10354: target aggregates do not work as expected for online users

## Domain Rationale

**Fit:** strong

The PR is entirely about target indicators and target aggregates — displaying a previous reporting interval's targets and fixing aggregate computation — which is canonically the tasks-and-targets domain.
