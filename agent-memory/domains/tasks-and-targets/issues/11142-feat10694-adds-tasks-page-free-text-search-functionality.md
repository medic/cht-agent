---
id: cht-core-10694
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 10694
issueUrl: https://github.com/medic/cht-core/issues/10694
title: Add free text search to the Tasks page to filter tasks by contact name, lineage, or title via a client-side NgRx selector
lastUpdated: '2026-07-31'
summary: The Tasks page had no free text search, so users could not quickly narrow their task list. This enables the previously-disabled freetext search input and reactively filters the already-loaded task list client-side via a memoized NgRx selector matching contact name, lineage, and task title.
services:
  - webapp
techStack:
  - typescript
  - angular
  - ngrx
  - webdriverio
  - karma
tags:
  - free-text-search
  - task-filtering
  - ngrx-selectors
  - sidebar-filter
  - client-side-filtering
  - global-filters-state
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#11142
source_sha: 20098db389458e36fc1cd38e448288505378ae11
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/tasks/tasks.component.ts
  - webapp/src/ts/modules/tasks/tasks-sidebar-filter.component.ts
  - webapp/src/ts/modules/tasks/tasks.component.html
  - webapp/src/ts/reducers/global.ts
  - webapp/src/ts/selectors/index.ts
concepts:
  - memoized NgRx selectors
  - global filters state
  - client-side reactive filtering
  - shared search bar / sidebar filter component reuse
  - in-memory list filtering without backend round-trip
related_issues: []
stale: false
---

## Problem

Following CHT 5.1.0's addition of task filtering by due date, form, and place, the Tasks page still offered no free text search. The shared search bar's freetext input was disabled on this page, so users could not filter their task list by contact name, lineage, or task title.

## Root Cause

The freetext search input in the shared search bar was explicitly disabled for the Tasks page and there was no selector/state wiring to filter the loaded task list against a text query, so the capability simply did not exist on this page.

## Solution

Enabled the freetext input on the Tasks page. Typed queries are written into the global filters state by the shared `FreetextFilterComponent` (`applyFilter()` calls `globalActions.setFilter({ search: this.inputText })`); reducers/global.ts only gains a `search?: string` field on the `TasksFilters` interface. The memoized NgRx selector `getFilteredTasksList` (selectors/index.ts) then reactively re-filters the already-loaded task list by matching the query against contact name, lineage, and task title — with no extra query round-trip or page reload.

## Code Patterns

Memoized NgRx selector `getFilteredTasksList` in webapp/src/ts/selectors/index.ts reads `filters.search` from global filters state and filters the in-memory task list in two passes over `[task.contact.name, ...task.lineage, task.title]` — a diacritic-insensitive substring pass (`normalizeText` lowercases, NFD-decomposes and strips U+0300-U+036F), then, for queries of at least 3 characters, a Fuse.js fuzzy pass (`threshold: 0.2, ignoreLocation: true, minMatchCharLength: 3`) over the remaining candidates, which is why the PR adds the `fuse.js` ^7.3.0 dependency to webapp/package.json; tasks-sidebar-filter.component.ts passes `'search'` as the skip key to `clearFilters()` so a sidebar filter reset preserves the freetext query (the query itself is written to state by the shared freetext-filter component inside the search bar); the shared search bar component and global filter infrastructure are reused across the Reports and Tasks pages.

## Design Choices

Filtering is done client-side over the already-loaded task list via a memoized selector rather than issuing a backend search query, avoiding extra round-trips and page reloads since the task list is computed client-side by the rules engine anyway. Existing global filters state and the shared search bar component (already used by Reports) were reused instead of building bespoke search for tasks.

## Related Files

- webapp/src/ts/modules/tasks/tasks.component.ts
- webapp/src/ts/modules/tasks/tasks.component.html
- webapp/src/ts/modules/tasks/tasks-sidebar-filter.component.ts
- webapp/src/ts/reducers/global.ts
- webapp/src/ts/selectors/index.ts
- webapp/package.json
- webapp/package-lock.json
- tests/e2e/default/tasks/tasks-search.wdio-spec.js
- tests/page-objects/default/tasks/tasks.wdio.page.js
- tests/page-objects/default/reports/reports.wdio.page.js
- webapp/tests/karma/ts/modules/tasks/tasks-sidebar-filter.component.spec.ts
- webapp/tests/karma/ts/modules/tasks/tasks.component.spec.ts
- webapp/tests/karma/ts/selectors/index.spec.ts

## Testing

Added a new e2e spec (tests/e2e/default/tasks/tasks-search.wdio-spec.js) and updated the tasks and reports page objects to support the search interactions. Added/updated Karma unit tests for the tasks sidebar filter component, the tasks component, and the memoized selector (index.spec.ts) to cover writing the query to state and filtering the task list.

## Related Issues

- #10694: Feature request to implement free text search on the Tasks page (covering at least contact names in the task lineage), extending the 5.1.0 task filtering by due date/form/place

## Domain Rationale

**Fit:** strong

The PR's primary purpose is adding free text search to filter the user's task list on the Tasks page; although it searches by contact name/lineage, the feature is task-list filtering, which squarely belongs to tasks-and-targets.
