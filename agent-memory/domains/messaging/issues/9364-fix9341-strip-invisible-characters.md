---
id: cht-core-9364
category: bug
domain: messaging
domainFit: strong
issueNumber: 9364
issueUrl: https://github.com/medic/cht-core/issues/9364
title: Strip invisible characters from SMS message content in the smsparser before parsing report fields
lastUpdated: '2026-06-23'
summary: SMS messages containing invisible/non-printing characters were parsed incorrectly by the smsparser, corrupting field values. The fix strips invisible characters from the SMS content before parsing and backfills unit tests for the previously-untested parser.
services:
  - api
techStack:
  - javascript
  - nodejs
  - mocha
tags:
  - sms
  - smsparser
  - input-sanitization
  - text-parsing
  - invisible-characters
  - unit-tests
related_workflows:
  - message-processing
  - form-submission
source_pr: medic/cht-core#9364
source_sha: 3736569f737f5b983841b63be8745e29b3e38216
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/report/smsparser.js
concepts:
  - SMS form parsing
  - input sanitization
  - message-to-report parsing
related_issues: []
stale: false
---

## Problem

SMS messages submitted with invisible or zero-width/non-printing characters were not handled by the smsparser, so those characters leaked into parsed field values and produced incorrect report data for SMS-submitted reports. The parser function additionally had no unit test coverage at all.

## Root Cause

smsparser.js did not sanitize the raw SMS text before parsing, so invisible characters embedded in the incoming message were treated as part of the field content rather than being discarded.

## Solution

Added logic in smsparser.js to strip invisible characters from the SMS message content prior to parsing field values, and added unit tests covering the parser — including a test asserting that an input containing an invisible character is parsed correctly with the character removed.

## Code Patterns

Normalize/sanitize raw inbound message text by stripping invisible (zero-width/non-printing) characters before tokenizing and parsing fields in api/src/services/report/smsparser.js.

## Design Choices

Strip invisible characters once at the parser level so every SMS-submitted report benefits, rather than sanitizing per field or downstream. Per reviewer guidance, tests were written red/green (failing first, then passing after the fix) to both prove the behavior and fill a pre-existing coverage gap in this function.

## Related Files

- api/src/services/report/smsparser.js
- api/tests/mocha/services/report/smsparser.spec.js

## Testing

Added unit tests in api/tests/mocha/services/report/smsparser.spec.js for the previously-untested smsparser function, using a red/green TDD approach (write failing test, then implement). Includes a dedicated test that copies a passing case but injects an invisible character into the input to verify it is stripped and parsing still succeeds.

## Related Issues

- #9341: SMS parser does not strip invisible characters from incoming message content

## Domain Rationale

**Fit:** strong

The change is in smsparser.js, the component that parses incoming SMS message text into structured data; handling invisible/non-printing characters in raw SMS content is squarely a message-processing concern. It borders forms-and-reports since the parser output is a report, but the bug is about sanitizing SMS message content, not form/report logic.
