---
id: cht-core-9413
category: improvement
domain: forms-and-reports
domainFit: strong
issueNumber: 9413
issueUrl: https://github.com/medic/cht-core/issues/9413
title: Update Enketo dynamic-url widget to use MutationObserver instead of the deprecated DOMSubtreeModified mutation event
lastUpdated: '2026-06-23'
summary: The dynamic-url Enketo widget relied on the DOMSubtreeModified mutation event, which Chrome 127 removed, breaking dynamic URL updates and causing test failures in enketo-core's pipeline. The fix replaces the mutation event listener with a MutationObserver.
services:
  - webapp
techStack:
  - javascript
  - typescript
  - enketo
  - webdriverio
  - xlsform
tags:
  - mutation-observer
  - enketo-widget
  - dynamic-url-widget
  - dom-mutation-events
  - deprecated-api
  - browser-compatibility
  - chrome-127
related_workflows:
  - ui-extensions
  - form-submission
source_pr: medic/cht-core#9414
source_sha: 3abd39b485e85bc4d24121d853dc1e575dec7efa
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/js/enketo/widgets/dynamic-url.js
concepts:
  - MutationObserver
  - DOM mutation events
  - Enketo custom widgets
  - browser API deprecation
  - macro-task queue ordering
related_issues: []
stale: false
---

## Problem

The dynamic-url widget used a DOMSubtreeModified mutation event listener to detect DOM changes and update the rendered URL. Chrome 127 removed support for mutation events, so the listener never fired (breaking dynamic URL updates) and the enketo-core pipeline, which runs CHT's tests, began failing without any code change on their side.

## Root Cause

webapp/src/js/enketo/widgets/dynamic-url.js depended on the deprecated/removed DOMSubtreeModified mutation event, an API that Chrome dropped as of version 127.

## Solution

Replaced the DOMSubtreeModified mutation-event listener with a MutationObserver that watches the relevant DOM subtree for changes and re-computes/updates the dynamic URL, keeping the change small and self-contained.

## Code Patterns

Replace deprecated synchronous DOM mutation events (DOMSubtreeModified) with a MutationObserver observing subtree/childList changes in webapp/src/js/enketo/widgets/dynamic-url.js. In e2e specs, schedule the assertion as the last action on the macro-task queue so the asynchronous MutationObserver callback has flushed before asserting.

## Design Choices

MutationObserver is the modern, supported replacement for mutation events and required minimal additional code. Because MutationObserver callbacks fire asynchronously, the e2e assertion is structured to run last on the macro-task queue to avoid flaky timing while reliably observing the update.

## Related Files

- webapp/src/js/enketo/widgets/dynamic-url.js
- webapp/tests/karma/js/enketo/widgets/dynamic-url.spec.ts
- tests/integration/cht-form/default/dynamic-url-widget.wdio-spec.js
- tests/integration/cht-form/default/forms/dynamic-url-widget.xlsx
- tests/integration/cht-form/default/forms/dynamic-url-widget.xml

## Testing

Updated the karma unit spec (dynamic-url.spec.ts) and added/updated a WebdriverIO integration spec (dynamic-url-widget.wdio-spec.js) with a dedicated test form (dynamic-url-widget.xlsx/.xml). The integration assertion is scheduled as the last macro-task so the asynchronous MutationObserver-driven update is observed deterministically.

## Related Issues

- #9413: dynamic-url widget uses the deprecated DOMSubtreeModified mutation event removed in Chrome 127, causing enketo-core pipeline test failures

## Domain Rationale

**Fit:** strong

The change fixes an Enketo form widget (dynamic-url) that renders within forms, and form widget rendering is core to the forms-and-reports domain. Although a CI/pipeline test failure surfaced the issue, the fix modifies application form-widget code rather than build/deploy tooling, so it is not infrastructure.
