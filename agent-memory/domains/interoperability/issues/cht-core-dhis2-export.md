---
id: cht-core-dhis2-export
category: api
issueNumber: 390
title: DHIS2 dataValues via OpenHIM
lastUpdated: 2026-04-14
summary: Configured production DHIS2 dataValues export through OpenHIM mediators.
techStack:
  - javascript
  - nodejs
---

## Problem
Need a scalable way to export calculated data values to DHIS2 tracking instances.

## Solution
Implemented batch dataValues aggregations exported securely via OpenHIM mediators.

## Code Patterns
- `dataValues` metric aggregation
- `openhim` channel JSON configuration mapping

## Design Choices
- Nightly delta exports to save bandwidth
- OpenHIM validation channels for security

## Related Files
- sentinel/src/schedule/dhis2.js
