---
id: cht-core-10225
category: feature
domain: messaging
domainFit: strong
issueNumber: 10225
issueUrl: https://github.com/medic/cht-core/issues/10225
title: Add native support for Nepal's government-run centralized SMS (DoIT A2P) gateway in the messaging service
lastUpdated: '2026-07-16'
summary: CHT core could not send SMS through Nepal's Department of IT centralized A2P SMS gateway, blocking Ministry of Health projects. A new nepal-doit-sms service implements the gateway integration and is wired into messaging.js so outbound SMS can be routed through it.
services:
  - api
techStack:
  - javascript
  - nodejs
  - rest-api
  - mocha
tags:
  - sms
  - sms-gateway
  - nepal
  - doit
  - a2p
  - outbound-messaging
  - gateway-adapter
related_workflows:
  - message-processing
source_pr: medic/cht-core#10230
source_prs:
  - "medic/cht-core#10230"
  - "medic/cht-core#10243"
source_sha: 2b9065540a96ad7205a56913b7285123d6ee6ade
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/nepal-doit-sms.js
  - api/src/services/messaging.js
concepts:
  - SMS gateway integration
  - outbound message transport
  - A2P SMS delivery
  - pluggable gateway adapter
  - messaging service dispatch
related_issues: []
stale: false
---

## Problem

CHT core had no native support for the centralized SMS gateway run by the Department of IT, Nepal. Although that gateway can now send A2P (Application-to-Person) SMS via API, Ministry of Health projects using CHT could not route their outbound SMS through it.

## Root Cause

The api messaging service only supported its existing set of SMS gateway integrations; there was no adapter or code path to format and send outbound messages to the Nepal DoIT centralized gateway's A2P API.

## Solution

Added a dedicated api/src/services/nepal-doit-sms.js service that encapsulates the Nepal DoIT gateway's API integration for sending SMS, and modified api/src/services/messaging.js to dispatch outbound messages through this new gateway. Added unit test coverage for the new service. Backported to the 4.x line as a cherry-pick (PR #10243).

## Code Patterns

Gateway-adapter pattern: a self-contained service module (nepal-doit-sms.js) wraps a single gateway's outbound API, and messaging.js routes/dispatches messages to it — mirroring how other SMS gateways are integrated in the messaging service.

## Design Choices

Implemented as first-class native support inside cht-core's messaging service (per the feature request) rather than an external bridge or generic webhook, and structured as a discrete gateway service module to keep gateway-specific logic isolated and testable.

## Related Files

- api/src/services/messaging.js
- api/src/services/nepal-doit-sms.js
- api/tests/mocha/services/nepal-doit-sms.spec.js

## Testing

Added Mocha unit tests in api/tests/mocha/services/nepal-doit-sms.spec.js covering the new Nepal DoIT SMS gateway service.

## Related Issues

- #10225: Feature request to make CHT core natively support Nepal's government-run centralized SMS gateway for sending A2P SMS in Ministry of Health projects
- cht-docs#1965: Configuration/user documentation for the Nepal centralized SMS gateway

## Domain Rationale

**Fit:** strong

The PR adds native code in the API messaging service to deliver outbound SMS through a new gateway (Nepal DoIT A2P API), which is core SMS delivery and squarely the messaging domain. This is gateway-adapter implementation in application code, not an app-settings/config task, so it is not the configuration domain and the fit is strong.
