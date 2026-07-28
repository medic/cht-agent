---
id: cht-core-10846
category: feature
domain: messaging
domainFit: strong
issueNumber: 10846
issueUrl: https://github.com/medic/cht-core/issues/10846
title: Add local_phone Mustache helper to message-utils to strip country code from phone numbers in outgoing SMS
lastUpdated: '2026-06-22'
summary: SMS reminders rendered facility phone numbers in full international format (+977…), which local clients found confusing. Added a local_phone Mustache helper that strips the default_country_code prefix at render time without altering stored contact data.
services:
  - sentinel
  - api
techStack:
  - javascript
  - mustache
  - nodejs
tags:
  - sms
  - phone-number
  - mustache
  - country-code
  - message-utils
  - templating
related_workflows:
  - message-processing
source_pr: medic/cht-core#10868
source_sha: fbddf9e63054b9f833bb4a20dd89c74a08baca31
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/message-utils/src/index.js
concepts:
  - Mustache templating
  - SMS message rendering
  - phone number formatting
  - app_settings configuration lookup
  - backward-compatible template helpers
related_issues: []
stale: false
---

## Problem

SMS reminder messages (ANC, Immunization, Nutrition) embedded health-facility phone numbers in full international format including the country-code prefix (e.g., +977XXXXXXXXXX). Clients in Nepal, accustomed to the standard 10-digit local format, found the prefix confusing.

## Root Cause

message-utils offered no way to render phone numbers in local format within SMS templates; the only alternative was mutating stored contact data. No Mustache helper existed to strip the country code at render time.

## Solution

Added a local_phone Mustache section helper in shared-libs/message-utils/src/index.js. It reads default_country_code from app_settings and, when the rendered phone number starts with +{country_code}, strips that prefix; otherwise it returns the number unchanged. Templates that do not use the helper are completely unaffected.

## Code Patterns

Mustache lambda/section helper that post-processes its rendered inner content (e.g. Contact {{#local_phone}}{{facility_phone}}{{/local_phone}}); config lookup of default_country_code from app_settings inside the helper, with a safe pass-through fallback when the prefix does not match — in shared-libs/message-utils/src/index.js.

## Design Choices

Implemented as a render-time Mustache helper rather than mutating stored contact phone numbers, keeping the change non-destructive and fully backward compatible. Numbers that do not match the +{country_code} prefix pass through unchanged, avoiding corruption of already-local or differently-formatted numbers.

## Related Files

- shared-libs/message-utils/src/index.js
- shared-libs/message-utils/test/index.js

## Testing

Unit tests added/extended in shared-libs/message-utils/test/index.js. Cases cover default_country_code supplied as a numeric value and whitespace around context variables in templates.

## Related Issues

- #10846: SMS reminders show facility phone numbers with a confusing country-code prefix; request to display them in local format
- medic/cht-docs#2191: documentation for the new local_phone helper

## Domain Rationale

**Fit:** strong

The PR adds a Mustache helper in message-utils that controls how phone numbers are rendered in outgoing SMS message content — squarely SMS message composition, the core of the messaging domain. It reads `default_country_code` from app_settings, but the work is message rendering rather than gateway or integration setup.
