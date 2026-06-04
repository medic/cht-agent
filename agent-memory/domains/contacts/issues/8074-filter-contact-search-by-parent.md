---
id: cht-core-8074
category: feature
domain: contacts
subDomain: search
issueNumber: 8074
issueUrl: https://github.com/medic/cht-core/issues/8074
title: Support filtering contact search by descendants of current contact
lastUpdated: 2026-03-16
summary: Added a descendant-of-current-contact appearance keyword for form fields that scopes contact search to only contacts under the currently viewed place, using the existing contacts_by_parent CouchDB view.
services:
  - webapp
  - shared-libs
techStack:
  - typescript
  - angular
  - couchdb
---

## Problem

The `db-object` widget (and later `select-contact`) only supported searching contacts by document type, not by parent. In deployments with common or duplicate names, users had to scroll through entire lists of a given contact type with no way to narrow the scope to the relevant place. This made building relational forms (e.g., selecting a child's mother from the same household) cumbersome.

## Root Cause

The `Select2SearchService` was completely stateless with respect to the current contact context. It built search filters from only contact types and freetext. There was no mechanism to pass a parent/ancestor constraint, and `generate-search-requests.js` had no code path for a `parent` filter when querying CouchDB.

## Solution

PR #8759 added a `descendant-of-current-contact` appearance keyword. When present on a form field, the contact search is scoped to descendants of the contact currently open in the contacts tab. The implementation spans five layers:
1. **Widget detection:** `db-object-widget.js` reads the `or-appearance-descendant-of-current-contact` CSS class and passes `filterByParent: true` to `Select2Search.init()`
2. **Contact ID resolution:** `select2-search.service.ts` added `getContactId()` that traverses `ActivatedRoute` to extract `parent_id` or `id` from the URL
3. **Filter type safety:** New `Filter` interface in `search.service.ts` with a `parent?: string` field
4. **CouchDB query generation:** New `getContactsByParentRequest()` in `generate-search-requests.js` builds compound keys `[parentId, type]` for the `contacts_by_parent` view
5. **Set intersection:** Parent-filtered results intersect with other search constraints (freetext, type) via existing `search:getIntersection` mechanism

## Code Patterns

- Form appearance: `select-contact type-person descendant-of-current-contact` in XLSForm appearance column
- The `contacts_by_parent` view is an existing CouchDB view — no schema changes needed
- Contact ID is resolved from the Angular router state, not from DOM or URL string parsing
- File: `shared-libs/search/src/generate-search-requests.js` — `getContactsByParentRequest()` builds compound keys
- File: `webapp/src/ts/services/select2-search.service.ts` — `getContactId()` resolves current contact from route, sets `filters.parent`
- File: `webapp/src/ts/services/search.service.ts` — `Filter` interface with `parent` field
- File: `webapp/src/js/enketo/widgets/db-object-widget.js` — reads appearance class and passes `filterByParent` flag

## Design Choices

- Feature is URL-driven — only works from the contacts tab where the URL contains the parent contact ID
- Reuses existing `contacts_by_parent` CouchDB view rather than creating a new index
- Parent filter participates in set intersection with other constraints, meaning freetext search within a parent's descendants works correctly
- The `parent_id` route param covers new-contact creation; `id` covers existing-contact view — both are checked

## Related Files

- shared-libs/search/src/generate-search-requests.js
- webapp/src/js/enketo/widgets/db-object-widget.js
- webapp/src/ts/services/select2-search.service.ts
- webapp/src/ts/services/search.service.ts
- webapp/src/ts/modules/contacts/contacts.component.ts
- webapp/src/ts/modules/reports/reports.component.ts
- webapp/src/ts/services/contact-view-model-generator.service.ts

## Testing

- Unit tests for `generate-search-requests.js` covering parent filter with and without types
- Unit tests for `select2-search.service.ts` verifying contact ID resolution from route
- E2E test with two-area hierarchy verifying that `descendant-of-current-contact` scopes search correctly

## Related Issues

- #9915: Replace db-object appearance with select-contact (modernization of the widget that uses this feature)
