---
id: cht-core-9874
category: feature
domain: data-sync
domainFit: strong
issueNumber: 9874
issueUrl: https://github.com/medic/cht-core/issues/9874
title: Add storage pressure indicator to webapp header and sidebar menu for offline users
lastUpdated: '2026-06-22'
summary: Offline users (especially on kiosks) had no visibility into local storage usage, making it hard to tell whether storage limits or broken purging were degrading performance. Added a storage pressure indicator in the header/sidebar menu backed by a storage-info service and NgRx state.
services:
  - webapp
techStack:
  - typescript
  - angular
  - ngrx
  - less
tags:
  - storage
  - offline
  - purging
  - kiosk
  - indicator
  - ui
  - observability
  - ngrx
related_workflows:
  - ui-extensions
  - observability
source_pr: medic/cht-core#9874
source_sha: 0fa609371df7f2057e501680546ae8564ea67e8f
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/storage-info.service.ts
  - webapp/src/ts/actions/global.ts
  - webapp/src/ts/reducers/global.ts
  - webapp/src/ts/selectors/index.ts
  - webapp/src/ts/components/header/header.component.ts
  - webapp/src/ts/components/sidebar-menu/sidebar-menu.component.ts
  - webapp/src/ts/components/base-menu/base-menu.component.ts
concepts:
  - NgRx unidirectional state flow (action -> reducer -> selector -> component)
  - browser StorageManager / storage estimate API
  - offline replication storage and purging
  - shared component composition via base-menu
  - UI observability indicator
related_issues: []
stale: false
---

## Problem

Offline users, particularly in kiosk deployments where they cannot inspect system storage, had no way to see how much device/browser storage was used or remaining. When the app was slow or data behaved unexpectedly, they could not distinguish storage exhaustion from purging that had stopped working, making troubleshooting difficult for both users and support teams.

## Root Cause

The webapp exposed no UI surface or service for the local storage estimate, so storage pressure on the offline replica was invisible to users and support staff.

## Solution

Added a storage-info.service.ts that reads storage usage/quota (browser storage estimate), wired it through the NgRx pattern (new action in actions/global.ts, handled in reducers/global.ts, exposed via selectors/index.ts) and consumed it in the header and sidebar/base-menu components to render a storage pressure indicator, styled in inbox.less. Implementation was refactored to follow the project's pre-existing state/menu pattern.

## Code Patterns

NgRx data flow for surfacing a runtime metric: dispatch/define in webapp/src/ts/actions/global.ts, persist in webapp/src/ts/reducers/global.ts, read via webapp/src/ts/selectors/index.ts, render in component (header/sidebar-menu). Service reads storage estimate in webapp/src/ts/services/storage-info.service.ts; shared menu UI lives in base-menu.component.ts.

## Design Choices

Followed the existing actions/reducers/selectors NgRx pattern rather than ad-hoc component state (reviewer praised refactoring to the pre-existing pattern), and surfaced the indicator through the shared base-menu so it appears in both the new sidebar-menu design and the older header navigation for UI/UX backward compatibility.

## Related Files

- webapp/src/css/inbox.less
- webapp/src/ts/actions/global.ts
- webapp/src/ts/components/base-menu/base-menu.component.ts
- webapp/src/ts/components/header/header.component.html
- webapp/src/ts/components/header/header.component.ts
- webapp/src/ts/components/sidebar-menu/sidebar-menu.component.html
- webapp/src/ts/components/sidebar-menu/sidebar-menu.component.ts
- webapp/src/ts/reducers/global.ts
- webapp/src/ts/selectors/index.ts
- webapp/src/ts/services/storage-info.service.ts
- webapp/tests/karma/ts/app.component.spec.ts
- webapp/tests/karma/ts/components/sidebar-menu/sidebar-menu.component.spec.ts
- webapp/tests/karma/ts/reducers/global.spec.ts
- webapp/tests/karma/ts/selectors/index.spec.ts

## Testing

Karma unit tests added/updated covering the new state and UI: reducers/global.spec.ts for the new global state, selectors/index.spec.ts for the storage-info selector, sidebar-menu.component.spec.ts for rendering the indicator, and app.component.spec.ts. Reviewer (witash) confirmed tests were added.

## Related Issues

- #9872: feature request for a storage pressure indicator to help offline/kiosk users and support teams diagnose storage and purging issues

## Domain Rationale

**Fit:** strong

The indicator surfaces usage/quota of the local offline data store (the replicated PouchDB/CouchDB data) and is explicitly built to diagnose whether purging/replication is working as expected; offline-data storage and purging are squarely data-sync concerns. It is a UI/observability feature, but its subject matter is the sync/storage subsystem, so data-sync is a principled rather than least-bad pick.
