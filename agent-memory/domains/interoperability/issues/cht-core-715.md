---
id: cht-core-715
category: api
issueNumber: 715
title: Accept ODK mobile data
lastUpdated: 2026-04-14
summary: Inbound integration accepting ODK XForm submissions into CHT contact/forms hierarchy.
techStack:
  - javascript
  - nodejs
---

## Problem
CHT needed to accept inbound submissions from external ODK mobile tools.

## Solution
Implemented an inbound integration that accepts ODK XForms and parses them into the CHT hierarchy.

## Code Patterns
- `odkFormParser()` 
- `contactHierarchy` mapping definitions

## Design Choices
- XForm to CHT document conversion algorithms
- Batch processing implementation

## Related Files
- shared-libs/inbound/odk.js
