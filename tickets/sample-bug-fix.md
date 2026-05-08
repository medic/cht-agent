---
title: Contact search not working properly in offline mode
type: bug
priority: high
domain: contacts
---

## Description
When users try to search for contacts while offline, the search returns no results even though contacts are already available locally. This affects CHWs working in low connectivity areas.

## Expected Behavior
Search should return locally stored contacts even when there is no internet connection.

## Acceptance Criteria
- [ ] Contacts can be searched offline
- [ ] Results match locally available data
- [ ] Search is case insensitive
- [ ] No regression in online search