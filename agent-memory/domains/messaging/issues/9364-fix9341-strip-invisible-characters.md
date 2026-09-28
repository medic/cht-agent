---
id: cht-core-9341
category: bug
domain: messaging
domainFit: strong
issueNumber: 9341
issueUrl: https://github.com/medic/cht-core/issues/9341
title: Strip invisible characters inside standardiseDigits so digit-normalised SMS fields (Bikram Sambat dates, phone numbers) are sanitised too
lastUpdated: '2026-07-30'
summary: smsparser.js already stripped zero-width characters in its `integer`/`string`/`date`/`bsDate`/`boolean`/`month` field parsers, but the shared `standardiseDigits` helper used by the `bsYear`/`bsMonth`/`bsDay` and `phone_number` parsers (and by the Muvuku aggregate-BS-date assembly) did not, so those field values kept their invisible characters. The one-line fix wraps `standardiseDigits`' output in the existing `stripInvisibleCharacters`, and four `parseField` cases were appended to the already ~1670-line smsparser spec.
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

SMS reports whose Bikram Sambat date fields (`bsYear`/`bsMonth`/`bsDay`) contained zero-width characters were parsed incorrectly, because those field parsers only ran `standardiseDigits`, which did not strip invisible characters the way the other field parsers already did. `smsparser.parseField` had no direct unit coverage before this change (the only pre-existing BS-date tests exercised `smsparser.parse` on compact-textforms fixtures), although api/tests/mocha/services/report/smsparser.spec.js itself was already ~1670 lines of existing tests.

## Root Cause

smsparser.js already had a `stripInvisibleCharacters` helper (defined at line 51) and already applied it in the `integer`, `string`, `date`, `bsDate`, `boolean` and `month` field parsers. It was NOT applied on the `standardiseDigits` path — the only normalisation performed by the `bsYear`, `bsMonth`, `bsDay` and `phone_number` field parsers, and by the Muvuku aggregate-BS-date assembly. Any zero-width character in those field values therefore survived into the parsed report (independently of whether the digits were Devanagari or ASCII).

## Solution

Wrapped the output of the existing per-field helper `standardiseDigits` in the already-present `stripInvisibleCharacters` (a single line in api/src/services/report/smsparser.js), so the parsers that only went through digit standardisation — `bsYear`, `bsMonth`, `bsDay`, `phone_number`, and the Muvuku aggregate-BS-date assembly — now also drop zero-width characters. Four mocha cases were appended to the existing smsparser spec: three Devanagari-digit `smsparser.parseField` cases for bsYear/bsMonth/bsDay, plus one that injects a zero-width space (`'२​०८०'`) and asserts it still parses to `'2080'`. The raw SMS message text itself is unchanged by this fix.

## Code Patterns

When a per-field parser applies its own normalisation helper, make that helper the sanitisation point too: `standardiseDigits(original)` now returns `stripInvisibleCharacters(original.toString().replace(/[०-९]/g, digitReplacer))`, so every field parser that normalises digits gets zero-width stripping for free (api/src/services/report/smsparser.js). This is post-tokenisation, per-field-value sanitisation, not raw-message preprocessing.

## Design Choices

Kept the file's existing per-field-parser sanitisation design rather than stripping once at the message level: the strip was pushed into the shared `standardiseDigits` helper so the digit-normalising parsers (`bsYear`, `bsMonth`, `bsDay`, `phone_number`) inherit the behaviour that `integer`/`string`/`date`/`bsDate`/`boolean`/`month` already had from their own `stripInvisibleCharacters` calls.

## Related Files

- api/src/services/report/smsparser.js
- api/tests/mocha/services/report/smsparser.spec.js

## Testing

Appended four mocha cases to the existing api/tests/mocha/services/report/smsparser.spec.js (which already held ~1670 lines of tests): three assert `smsparser.parseField` standardises Devanagari digits for the `bsYear`, `bsMonth` and `bsDay` field types, and a fourth copies the bsYear case with a zero-width space injected (`'२​०८०'`) and asserts it still yields `'2080'`.

## Related Issues

- #9341: SMS parser does not strip invisible characters from incoming message content

## Domain Rationale

**Fit:** strong

The change is in smsparser.js, the component that parses incoming SMS message text into structured data; stripping invisible/non-printing characters out of the field values it tokenises from an SMS is squarely a message-processing concern. It borders forms-and-reports since the parser output is a report, but the bug is about sanitizing values parsed from SMS content, not form/report logic.
