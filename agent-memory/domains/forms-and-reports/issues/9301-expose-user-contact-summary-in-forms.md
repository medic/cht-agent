---
id: cht-core-9301
category: feature
domain: forms-and-reports
subDomain: enketo
issueNumber: 9301
issueUrl: https://github.com/medic/cht-core/issues/9301
title: Expose user's contact summary when filling out forms
lastUpdated: 2025-06-16
summary: Made the logged-in user's contact summary data available inside Enketo forms via an XPath instance, enabling forms to reference the user's own summary fields (e.g. stock levels) during data entry.
services:
  - webapp
techStack:
  - typescript
  - angular
---

## Problem

Deployments using stock monitoring stored inventory data in a CHW's contact summary. When the CHW filled out a form to administer medication, the form had no way to check whether the item was in stock because only the patient's contact summary was accessible, not the user's own summary.

## Root Cause

The Enketo form rendering pipeline only injected the subject contact's summary into the form context. There was no mechanism to also inject the current user's contact summary data.

## Solution

Added the logged-in user's contact summary as a separate XPath instance (`contact-summary-user`) available in forms. Forms can now reference user-level data via `instance('contact-summary-user')/context/<variable>`. PR #9824 implemented this across the form service, XML forms context utils, and contact summary service.

## Code Patterns

- When forms need data beyond the subject contact, expose it via named XPath instances rather than custom variables
- The user's contact summary is loaded once per form session and cached, not re-fetched per question
- Pattern: `instance('contact-summary-user')/context/<field>` for accessing user-level summary fields in XForms
- File: `webapp/src/ts/services/xml-forms-context-utils.service.ts` manages context injection into forms
- File: `webapp/src/ts/services/user-contact-summary.service.ts` fetches the user's own contact summary

## Design Choices

- Used a separate named instance (`contact-summary-user`) rather than merging into the existing `contact-summary` instance, to avoid ambiguity between subject and user data
- Only loads the user summary when a form actually references it, to avoid unnecessary computation

## Related Files

- webapp/src/ts/services/xml-forms-context-utils.service.ts
- webapp/src/ts/services/user-contact-summary.service.ts
- webapp/src/ts/services/contact-summary.service.ts
- webapp/src/ts/services/enketo.service.ts
- webapp/src/ts/services/form.service.ts

## Testing

- Unit tests for the user contact summary service
- Unit tests verifying the XML forms context utils inject the user summary instance
- E2E tests filling forms that reference user-level contact summary fields

## Related Issues

- #9269: Expose the user's target documents into the contact summary
