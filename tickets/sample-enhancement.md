---
title: Improve contact search performance
type: enhancement
priority: medium
domain: contacts
---

## Description
Contact search becomes noticeably slow when there are many contacts in the system, especially in large deployments with thousands of records. This affects usability for health workers in the field.

## Expected Behavior
Search results should load quickly even with large datasets.

## Acceptance Criteria
- [ ] Search results load within acceptable time (example: under 1 second)
- [ ] No loss of accuracy in results
- [ ] No regression in offline search behavior