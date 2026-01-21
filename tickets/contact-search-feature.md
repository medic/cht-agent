---
title: Add contact search functionality to webapp
type: feature
priority: high
domain: contacts
---

# Description

Users need the ability to search for contacts by name, phone number, or other attributes directly from the webapp interface. The search should work offline and sync results when connectivity is restored.

This feature has been requested by multiple deployment partners who manage large contact databases and need quick access to specific contacts during field work.

## User Stories

1. As a CHW, I want to quickly find a patient's contact card so I can update their information during a home visit
2. As a supervisor, I want to search for health facilities in my area so I can plan my oversight visits
3. As a program manager, I want to find specific community members to review their health records

## Technical Context

**Components:**
- `webapp/modules/contacts`
- `shared-libs/search`
- `api/controllers/search`

**Existing References:**
- contact-page
- contact-list

## Requirements

- Search by name, phone, and custom attributes
- Offline-first functionality
- Search results displayed in real-time
- Integration with existing contact hierarchy
- Responsive UI for mobile devices

## Acceptance Criteria

- User can search contacts by typing in search box
- Search works without internet connection
- Results update as user types (debounced)
- Search respects user permissions and hierarchy
- Search performance < 500ms for 10k contacts

## Constraints

- Must work offline
- Compatible with CHT 4.x
- Maintain backward compatibility
- Support for existing contact types

## Technical Considerations

- The search index should be built using PouchDB's search capabilities
- Consider using Lunr.js or similar for full-text search
- Implement proper debouncing (300-500ms) to avoid performance issues
- Search should respect the existing user hierarchy and permissions

## References

**Similar Implementations:**
- https://github.com/medic/cht-core/pull/1234
- https://github.com/medic/cht-core/issues/5678

**Documentation:**
- https://docs.communityhealthtoolkit.org/apps/reference/contact-page/
