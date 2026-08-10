---
id: cht-core-8074
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 8074
issueUrl: https://github.com/medic/cht-core/issues/8074
title: Add 'descendant-of-current-contact' appearance to filter the db-object (select-contact) Enketo widget by parent contact
lastUpdated: '2026-08-09'
summary: The db-object/select-contact widget could not constrain its options to a contact's subtree. This adds a `descendant-of-current-contact` appearance that filters selectable contacts to descendants of the contact whose tab the form was opened from, using the `contacts_by_parent` CouchDB view combined with contact type.
services:
  - webapp
techStack:
  - typescript
  - javascript
  - angular
  - enketo
  - select2
  - couchdb
  - pouchdb
tags:
  - db-object-widget
  - select-contact
  - descendant-of-current-contact
  - enketo-widget
  - contact-filtering
  - contact-search
  - contacts_by_parent
  - appearance-attribute
related_workflows:
  - form-submission
  - ui-extensions
source_pr: medic/cht-core#8759
source_sha: 45478853727d40b60b78c6359fb11fc7606d4a9c
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/js/enketo/widgets/db-object-widget.js
  - shared-libs/search/src/generate-search-requests.js
  - webapp/src/ts/services/select2-search.service.ts
  - webapp/src/ts/services/search.service.ts
  - webapp/src/ts/services/contact-view-model-generator.service.ts
concepts:
  - Enketo custom widgets
  - form appearance attributes
  - contact hierarchy (parent/descendant)
  - contacts_by_parent CouchDB view
  - select2-backed contact selection
  - search-request generation
related_issues: []
stale: false
---

## Problem

When a form containing a db-object/select-contact widget was opened from a contact's tab, the widget let users search and select from all matching contacts regardless of hierarchy. There was no way to scope the selectable contacts to the descendants of the contact currently in context, making subtree-restricted contact pickers impossible to configure.

## Root Cause

The db-object widget and the underlying search-request generation (generate-search-requests.js) had no notion of a parent/descendant constraint: search requests never included a parent-scoped query, and the widget exposed no appearance to trigger such filtering. The in-context contact ID from the route was also not threaded into the widget's search path.

## Solution

Introduced a new `descendant-of-current-contact` appearance handled by the db-object widget. When present (and scoped to forms opened in the contact tab), the widget reads the current contact ID from the URL via the contacts/reports components and passes it through select2-search and search services. generate-search-requests.js was extended to build a request querying the `contacts_by_parent` CouchDB view keyed by the in-context contact ID plus the configured contact type, returning only descendants of the current contact.

## Code Patterns

Appearance-driven widget behavior — the Enketo widget inspects its `appearance` attribute to conditionally enable filtering (webapp/src/js/enketo/widgets/db-object-widget.js). Search-request construction in shared-libs/search/src/generate-search-requests.js extended to emit a `contacts_by_parent` view query keyed by the in-context contact ID + contact type. The current contact ID is sourced from the route/URL in contacts.component.ts and reports.component.ts and threaded through select2-search.service.ts and search.service.ts.

## Design Choices

Reused the existing `contacts_by_parent` CouchDB view rather than adding a new index or Nouveau search, keeping the filter cheap and consistent with existing hierarchy queries. The behavior is opt-in per field via a declarative form `appearance` attribute, so configurers enable it without code changes, and is scoped to forms opened in the contact tab. The original `with-same-parent` naming was ambiguous (sounding like a siblings-of filter); the final `descendant-of-current-contact` name was chosen to clearly convey subtree/descendant semantics.

## Related Files

- webapp/src/js/enketo/widgets/db-object-widget.js
- shared-libs/search/src/generate-search-requests.js
- webapp/src/ts/services/search.service.ts
- webapp/src/ts/services/select2-search.service.ts
- webapp/src/ts/services/contact-view-model-generator.service.ts
- webapp/src/ts/modules/contacts/contacts.component.ts
- webapp/src/ts/modules/reports/reports.component.ts

## Testing

Unit tests added/updated for search-request generation (shared-libs/search/test/generate-search-requests.js), the search service (webapp/tests/karma/ts/services/search.service.spec.ts), and the select2-search service (webapp/tests/karma/ts/services/select2-search.service.spec.ts). An end-to-end WDIO spec (tests/e2e/default/enketo/db-object-widget.wdio-spec.js) with a dedicated test form (tests/e2e/default/enketo/forms/db-object-widget.xml) and page-object helpers (tests/page-objects/default/enketo/generic-form.wdio.page.js) exercises the descendant filtering through the widget.

## Related Issues

- #8074: Add filter by parent to the db-object widget (descendant-of-current-contact appearance)

## Domain Rationale

**Fit:** strong

The change centers on an Enketo form widget (db-object / select-contact) and a declarative form `appearance` attribute (`descendant-of-current-contact`) that governs how contacts are selected inside a form — squarely forms-and-reports. It touches contact-search services, but those are the mechanism powering the form-widget capability, not the deliverable.
