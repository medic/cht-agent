---
id: cht-core-8660
category: feature
domain: messaging
domainFit: strong
issueNumber: 8660
issueUrl: https://github.com/medic/cht-core/issues/8660
title: Add link in SMS conversation to navigate to the sender's contact page
lastUpdated: '2026-06-23'
summary: The SMS conversation view displayed the sender's identity but offered no way to jump to their contact record. This adds a clickable link in the sender component that navigates to the sender's contact page.
services:
  - webapp
techStack:
  - typescript
  - angular
  - html
  - webdriverio
  - karma
tags:
  - sms
  - messages
  - conversation
  - sender
  - navigation
  - contact-link
  - ui
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#8717
source_sha: fec14102eb8c1a8022ad54050d202672738f899e
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/components/sender/sender.component.ts
  - webapp/src/ts/components/sender/sender.component.html
concepts:
  - component-based UI
  - client-side routing/navigation
  - messaging conversation view
  - cross-domain navigation (message to contact)
related_issues: []
stale: false
---

## Problem

In the SMS messages conversation, the sender component showed the sender's name/phone but provided no direct affordance to open that sender's contact page, forcing users to manually search for the contact to view their record.

## Root Cause

The sender component only rendered sender display data and lacked a navigation link/route binding to the associated contact document.

## Solution

Added a link in sender.component.html plus supporting navigation logic in sender.component.ts to route to the sender's contact page when the sender resolves to a known contact, with accompanying unit and e2e coverage.

## Code Patterns

Conditional navigation link in an Angular component template bound to a router-navigation method in the component class (sender.component.html + sender.component.ts); e2e page-object extension in messages.wdio.page.js exposing the sender link for the wdio spec.

## Design Choices

Implemented as an in-component link kept close to the existing sender display rather than a separate widget; e2e coverage was scoped to the happy path per the PR description.

## Related Files

- webapp/src/ts/components/sender/sender.component.ts
- webapp/src/ts/components/sender/sender.component.html
- webapp/tests/karma/ts/components/sender.component.spec.ts
- tests/e2e/default/sms/messages-sender-data.wdio-spec.js
- tests/page-objects/default/sms/messages.wdio.page.js

## Testing

Added a karma unit test (sender.component.spec.ts), a happy-path e2e wdio spec (messages-sender-data.wdio-spec.js), and a supporting page-object method (messages.wdio.page.js); reviewer tatilepizs also manually tested and ran the e2e test successfully.

## Related Issues

- #8660: add link in conversation to navigate to sender's contact page

## Domain Rationale

**Fit:** strong

The change lives entirely in the SMS conversation's sender component (sender.component.ts/html) and its message-view tests, enhancing the messaging conversation UI; it merely links out to a contact page, so the modified code is squarely in the messaging domain rather than contacts.
