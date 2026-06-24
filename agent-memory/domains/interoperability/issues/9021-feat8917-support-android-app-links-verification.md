---
id: cht-core-9021
category: feature
domain: interoperability
domainFit: strong
issueNumber: 9021
issueUrl: https://github.com/medic/cht-core/issues/9021
title: Serve Android App Links verification file at /.well-known/assetlinks.json from the assetlinks property in app_settings.json
lastUpdated: '2026-06-23'
summary: CHT partners had no built-in way to enable Android App Links verification, which requires serving a Digital Asset Links file declaring the authorized app. This PR adds an API route that serves the configurable `assetlinks` property from app_settings.json at /.well-known/assetlinks.json so Android can verify the app-to-domain association.
services:
  - api
techStack:
  - javascript
  - nodejs
  - express
  - couchdb
tags:
  - android-app-links
  - well-known
  - assetlinks
  - digital-asset-links
  - deep-linking
  - app-settings
  - public-endpoint
related_workflows: []
source_pr: medic/cht-core#9021
source_sha: 43e22156ebb6c3988521e36882b136e19959f018
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/well-known.js
  - api/src/routing.js
concepts:
  - Android App Links
  - Digital Asset Links protocol
  - well-known URI (RFC 8615)
  - deep linking
  - app_settings-driven endpoint
  - unauthenticated public route
related_issues: []
stale: false
---

## Problem

There was no native way for CHT instances to enable Android App Links verification. To let links open directly in the cht-android app (deep linking) instead of the browser, the web domain must serve a /.well-known/assetlinks.json Digital Asset Links file declaring the authorized app. Without API support, partners would need custom server configuration or external tooling to host this file.

## Root Cause

Not a bug — a missing feature. The CHT API exposed no /.well-known/assetlinks.json route and had no mechanism to source asset-links content from existing configuration.

## Solution

Added a `well-known` controller (api/src/controllers/well-known.js) and registered a route in api/src/routing.js that reads the `assetlinks` property from app_settings.json and serves it at /.well-known/assetlinks.json. Partners simply set the `assetlinks` value in app settings and the API serves it automatically, requiring no cht-conf changes or separate static hosting.

## Code Patterns

Expose a configurable value from app_settings.json via a dedicated public route under /.well-known/. See api/src/controllers/well-known.js (reads the assetlinks setting) and the route registration in api/src/routing.js, which must be placed ahead of authentication middleware because well-known endpoints have to be reachable without auth.

## Design Choices

Sourced the asset-links content from app_settings.json rather than a separate file or a cht-conf packaging step; per reviewer garethbowen this avoids extra cht-conf development and keeps configuration in one place. A follow-up was suggested (jkuester) to extend cht-conf's compile-app-settings action to package `assetLinks`.

## Related Files

- api/src/controllers/well-known.js
- api/src/routing.js
- api/tests/mocha/controllers/well-known.spec.js
- tests/integration/api/controllers/well-known.spec.js
- tests/integration/api/routing.spec.js

## Testing

Added unit tests in api/tests/mocha/controllers/well-known.spec.js and integration tests in tests/integration/api/controllers/well-known.spec.js plus routing coverage in tests/integration/api/routing.spec.js; reviewer lorerod specifically praised the test coverage.

## Related Issues

- #8917: Support Android app links verification (serve assetlinks.json so Android can verify the app-to-domain association for deep linking)

## Domain Rationale

**Fit:** strong

The PR implements the Android Digital Asset Links standard (serving /.well-known/assetlinks.json per RFC 8615) to verify the trust relationship between the CHT web domain and the Android app — an outward-facing, standards-based cross-system integration. Configuration is the runner-up since the data is supplied via app_settings.json, but that is only the input mechanism; the feature's essence is web↔Android platform interoperability, not internal app config (and it is platform interop rather than the health-data interop the domain canonically centers on).
