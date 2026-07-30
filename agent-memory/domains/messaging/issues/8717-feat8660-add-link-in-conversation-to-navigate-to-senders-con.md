---
id: cht-core-8660
category: feature
domain: messaging
domainFit: weak
issueNumber: 8660
issueUrl: https://github.com/medic/cht-core/issues/8660
title: Add link in SMS conversation to navigate to the sender's contact page
lastUpdated: '2026-07-30'
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

Added a link in sender.component.html that routes to the sender's contact page when the sender resolves to a known contact, with accompanying unit and e2e coverage. The routing itself is declarative — a `[routerLink]` on the anchor — so sender.component.ts only gained the two accessors the template needs to decide whether to render a link and where to point it.

## Code Patterns

Conditional `<a class="name" *ngIf="!sentBy && getId() && getName(); else noLinkLabel" [routerLink]="[ '/contacts', getId() ]">` in the Angular template — navigation is the declarative `routerLink` directive, not a navigation method: `sender.component.ts` injects no `Router` and gained only two data accessors, `getName()` (`doc?.name || contact?.name || (!form && name) || from || sent_by || doc?.from`) and `getId()` (`this.message.contact?._id || this.message.doc?._id`). An `<ng-template #noLinkLabel>` renders a plain `<span class="name">` when there is no id. E2e page-object extension in messages.wdio.page.js (`navigateFromConversationToContact`, which waits for and clicks `a.name` inside the message header) exposes the sender link for the wdio spec.

## Design Choices

Implemented as an in-component link kept close to the existing sender display rather than a separate widget; e2e coverage was scoped to the happy path per the PR description.

## Related Files

- webapp/src/ts/components/sender/sender.component.ts
- webapp/src/ts/components/sender/sender.component.html
- webapp/tests/karma/ts/components/sender.component.spec.ts
- tests/e2e/default/sms/messages-sender-data.wdio-spec.js
- tests/page-objects/default/sms/messages.wdio.page.js

## Testing

Added two karma unit tests to sender.component.spec.ts ('should render sender as a link when message has a contact with id' and '... when message has a doc with id'), along with `RouterModule.forRoot([])` in the TestBed and `div .name` -> `div span.name` selector updates. The e2e file is not new: tests/e2e/default/sms/messages-breadcrumbs.wdio-spec.js was renamed (git -M reports R079; without rename detection, D + A) to tests/e2e/default/sms/messages-sender-data.wdio-spec.js, keeping its two existing breadcrumb tests and gaining one happy-path case, 'should display conversation with link and navigate to contact'. A supporting page-object method `navigateFromConversationToContact` was added to messages.wdio.page.js; the change was also verified manually.

## Related Issues

- #8660: add link in conversation to navigate to sender's contact page

## Domain Rationale

**Fit:** weak

The change lives entirely in the webapp conversation UI (sender.component.ts/html): it adds navigation from a message's sender to the contact page. Messaging is the least-bad home because the sender component belongs to the messages view, but this is UI navigation (related workflow: ui-extensions) rather than message-pipeline work, so the fit is weak.
