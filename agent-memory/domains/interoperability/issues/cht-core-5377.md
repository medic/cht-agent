---
id: cht-core-5377
category: api
issueNumber: 5377
title: Sentinel adapter for NiFi/DHIS2
lastUpdated: 2026-04-14
summary: Created sentinel adapter to route CHT data through NiFi to DHIS2.
techStack:
  - javascript
  - nodejs
---

## Problem
Need a way to route and transform CHT data going natively to DHIS2 via standard middleware like Apache NiFi.

## Solution
Implemented a NiFi middleware adapter for data transformation and routing.

## Code Patterns
- `nifiAdapter()` middleware
- `dhis2DataValues` mapping

## Design Choices
- Applied JSONata transformations
- Maintained an error queue per endpoint

## Related Files
- sentinel/src/adapters/nifi.js
