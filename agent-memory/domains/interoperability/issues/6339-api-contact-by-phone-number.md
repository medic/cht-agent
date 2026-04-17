---
id: cht-core-6339
category: feature
domain: interoperability
subDomain: api
issueNumber: 6339
issueUrl: https://github.com/medic/cht-core/issues/6339
title: Provide an API endpoint for fetching a contact by phone number
lastUpdated: 2020-06-25
summary: For RapidPro integration, when an inbound SMS arrives the mediator needs to look up the sender's contact record using only their phone number. The two-step process (CouchDB view + hydration API) was fragile and chatty. PR #6434 added a single hardcoded API endpoint GET /api/v1/contacts-by-phone that normalizes the phone, finds the patient document, and returns a fully hydrated contact in one call.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
---

## Problem

In a bidirectional RapidPro integration, CHT receives incoming SMS flows and needs to route them to the correct patient record. The sender's phone number is the only identifier available at that point. The previous approach required:
1. Querying the CouchDB `contacts_by_phone` view with the normalized phone number
2. Taking the returned document ID and calling the separately-documented hydration API to get ancestor hierarchy details

This two-step process was brittle because the internal CouchDB view name is not a public API and could change in any CHT release. The integration code would silently break after a CHT upgrade that reorganized views.

## Root Cause

CHT had no public, versioned API endpoint for "find contact by phone". The internal CouchDB views were the only mechanism, but views are implementation details not guaranteed to be stable across releases.

## Solution

Added `GET /api/v1/contacts-by-phone?phone=<url_encoded_number>` (PR #6434, merged Jun 25, 2020):
1. The phone parameter must be URL-encoded — `+` must be encoded as `%2B` otherwise it is decoded as a space, producing an invalid phone number and a 400 response
2. The endpoint normalizes the input using CHT's standard phone normalization so formatted variants (`+14165550000`, `+1 (416) 555-0000`, `+1-416-555-0000`) all resolve to the same contact
3. Queries the CouchDB view internally to find the patient document
4. Hydrates the result, resolving the full ancestor hierarchy (facility → district → national)
5. Returns the hydrated contact document as JSON

External integrations get everything they need in one request instead of two.

## Code Patterns

- The endpoint is `GET /api/v1/contacts-by-phone?phone=<url_encoded>` — the `phone` query parameter must be URL-encoded; sending a raw `+` without encoding causes CHT to receive a space character, which fails phone normalization with a 400
- Phone normalization uses the same `phoneNumber` shared-lib function used throughout the codebase; normalization rules come from `app_settings.json` country code config
- The hydration step calls the same service used by the existing hydration API endpoint, so hierarchy resolution is consistent
- Pattern: new external-facing API endpoints are versioned (`/api/v1/`) to allow future breaking changes without affecting existing integrations
- Pattern: always test phone number URL encoding in integration tests — it is a common caller mistake and produces a confusing error if not caught

## Design Choices

- Added as a separate endpoint rather than extending the existing contacts API with a `?phone=` filter for clarity and discoverability
- Hydration is always included in the response because the primary use case (RapidPro flows) always needs hierarchy details; an optional `?hydrate=false` flag was considered but not implemented in v1
- Phone normalization is mandatory; unnormalized numbers return a 400 if the number is invalid rather than silently returning zero results

## Related Files

- api/src/controllers/
- api/src/services/contacts.js
- shared-libs/phone-number/

## Testing

- Integration tests with various phone formats: raw `+254700123456`, formatted `+254 700 123456`, URL-encoded `%2B254700123456` all returning the same contact
- Test that a raw unencoded `+` (received as space) returns 400 with a clear error
- Test that a phone number not present in the system returns 404

## Related Issues

- #6306: Send outbound push without delay (complementary outbound integration)
- #5904: Cluster safe credentials (security of credentials used in integrations)
