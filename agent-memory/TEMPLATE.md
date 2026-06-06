# Context File Template

This document defines the template for context files used in `agent-memory/`. These files capture knowledge from resolved CHT-Core issues so the agent can learn from past solutions.

## Template

Context files are markdown with YAML frontmatter. Save them under `agent-memory/domains/<domain>/issues/` using the naming convention `<issue-number>-<short-slug>.md`.

```yaml
---
id: cht-core-<issue-number>
category: bug|feature|improvement
domain: contacts|forms-and-reports|tasks-and-targets|messaging|data-sync|authentication|configuration|interoperability
subDomain: <optional, e.g. "enketo", "replication", "purging", "sms-gateway">
issueNumber: <cht-core issue number>
issueUrl: https://github.com/medic/cht-core/issues/<number>
title: <brief title>
lastUpdated: <YYYY-MM-DD>
summary: <1-2 sentence summary of the issue and resolution>
services:
  - api|webapp|sentinel|admin
techStack:
  - typescript|javascript|angular|couchdb|pouchdb
---

## Problem

<What was the issue? Include symptoms, error messages, and affected user types (online/offline).>

## Root Cause

<What caused the issue? Be specific about the code path.>

## Solution

<How was it solved? Describe the approach at a high level.>

## Code Patterns

<Reusable patterns from the fix. Include file paths and brief code snippets where helpful.>

## Design Choices

<Why this approach was chosen over alternatives.>

## Related Files

- path/to/file1.ts
- path/to/file2.ts

## Testing

<What tests were added or modified? What test strategy was used?>

## Related Issues

- #<related-issue-number>: <brief description>
```

## Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier, format: `cht-core-<issue-number>` |
| `category` | Yes | One of: `bug`, `feature`, `improvement` |
| `domain` | Yes | Must match a `CHTDomain` value from `src/types/index.ts` |
| `subDomain` | No | More specific area within the domain |
| `issueNumber` | Yes | The cht-core GitHub issue number |
| `issueUrl` | Yes | Full URL to the issue |
| `title` | Yes | Short descriptive title |
| `lastUpdated` | Yes | Date in YYYY-MM-DD format |
| `summary` | Yes | 1-2 sentence overview |
| `services` | Yes | Which CHT services are involved |
| `techStack` | Yes | Technologies relevant to the fix |

## How to Find Good Issues to Document

1. **Start with closed issues** in [cht-core](https://github.com/medic/cht-core/issues?q=is%3Aissue+is%3Aclosed). Filter by label:
   - `Type: Bug` for bug fixes
   - `Type: Feature` for new features
   - `Type: Improvement` for improvements

2. **Prioritize issues that:**
   - Have linked PRs with code changes (so you can see what was changed)
   - Touch well-known areas (forms, contacts, tasks, sync) where patterns repeat
   - Have clear problem descriptions and solutions
   - Involve multiple files or services (cross-cutting concerns are most valuable)

3. **Skip issues that:**
   - Are purely configuration changes with no code
   - Are one-line typo fixes
   - Are marked `Won't fix` or `Duplicate`
   - Have no linked PR or resolution description

4. **For each issue, read:**
   - The issue description and comments for context
   - The linked PR diff to understand the actual code changes
   - Test files added/modified to understand the testing approach

## Directory Structure

Save context files under the matching domain directory:

```
agent-memory/
└── domains/
    ├── contacts/
    │   └── issues/
    │       └── 9601-prevent-duplicate-contacts.md
    ├── forms-and-reports/
    │   └── issues/
    │       └── 6430-file-too-large-error.md
    ├── data-sync/
    │   └── issues/
    │       └── 9838-refactor-contacts-to-cht-datasource.md
    └── ...
```

---

## Worked Examples

> **Note:** These examples are based on real CHT-Core issues but the solution details are illustrative, not exact records of the actual resolutions. They are meant to demonstrate the template format and the level of detail expected in a context file.

### Example 1: Bug Fix

**File:** `agent-memory/domains/forms-and-reports/issues/6430-file-too-large-error.md`

```yaml
---
id: cht-core-6430
category: bug
domain: forms-and-reports
subDomain: enketo
issueNumber: 6430
issueUrl: https://github.com/medic/cht-core/issues/6430
title: File too large error not handled properly in form submissions
lastUpdated: 2025-07-01
summary: When users attached large images in Enketo forms, the error message did not indicate the acceptable file size limit, leaving users unable to resolve the issue.
services:
  - webapp
techStack:
  - typescript
  - angular
---

## Problem

When offline users submitted forms with large image attachments, an error message appeared but provided no guidance on acceptable file size limits. Users had no way to know how to resize their images to successfully submit the form.

## Root Cause

The Enketo form submission error handler caught the file size validation error but displayed a generic message without interpolating the configured maximum file size from app settings.

## Solution

Updated the error handler in the Enketo service to include the maximum allowed file size in the error message. The limit is read from app settings and displayed in a human readable format (e.g. "Maximum file size: 5 MB").

## Code Patterns

- Error messages that reference configurable limits should always interpolate the current value from app settings, not hardcode it
- Offline users cannot check documentation, so error messages must be self-contained and actionable
- File: `webapp/src/ts/services/enketo.service.ts` handles form submission errors

## Design Choices

Chose to read the limit from app settings at display time rather than hardcoding, so deployments with different size limits show accurate information.

## Related Files

- webapp/src/ts/services/enketo.service.ts
- webapp/src/ts/services/xml-forms.service.ts
- config/default/app_settings.json

## Testing

Added unit test to verify error message includes the file size limit when a large file is rejected.

## Related Issues

- #6699: Database errors on some devices when forms have large attachments
```

### Example 2: New Feature

**File:** `agent-memory/domains/contacts/issues/9601-prevent-duplicate-contacts.md`

```yaml
---
id: cht-core-9601
category: feature
domain: contacts
subDomain: deduplication
issueNumber: 9601
issueUrl: https://github.com/medic/cht-core/issues/9601
title: Prevent duplicate sibling contact creation
lastUpdated: 2025-04-18
summary: Added duplicate detection during contact creation and editing. When a user submits a new contact, the system checks for existing siblings with similar names and presents possible duplicates before allowing submission.
services:
  - webapp
  - api
techStack:
  - typescript
  - angular
  - couchdb
---

## Problem

Community health workers frequently created duplicate contact records because there was no built-in check for existing contacts with similar names. Despite search functionality being available, CHWs rarely used it before creating new records, leading to data quality issues.

## Root Cause

The contact creation flow had no deduplication step. The form submitted directly to the database without checking for existing siblings with matching or similar names.

## Solution

Added a deduplication check that runs on contact form submission (both create and edit flows). The system queries existing sibling contacts and compares names using a similarity threshold. If possible duplicates are found, a modal displays them with links to navigate to the existing contact. Users can either proceed with creation or navigate to the duplicate.

## Code Patterns

- Deduplication checks should run at submission time, not during form filling, to avoid disrupting the user workflow
- Similarity matching uses normalized lowercase comparison with configurable threshold
- The duplicate check modal is a reusable component that could be applied to other entity types
- Pattern: query siblings at the same hierarchy level, not the entire database
- File: `webapp/src/ts/services/deduplicate.service.ts` contains the matching logic
- File: `webapp/src/ts/modules/contacts/contacts-edit.component.ts` integrates the check into the submission flow

## Design Choices

- Chose client-side similarity matching over server-side to work offline
- Used sibling-scoped queries (same parent) rather than global search to keep the result set manageable and relevant
- Made the check bypassable so users can still create records when they know it is not a duplicate (e.g. same name, different person)

## Related Files

- webapp/src/ts/services/deduplicate.service.ts
- webapp/src/ts/modules/contacts/contacts-edit.component.ts
- webapp/src/ts/services/contact-save.service.ts
- api/src/controllers/person.js

## Testing

- Unit tests for similarity matching logic with various name patterns
- E2E test verifying the duplicate modal appears when creating a contact with an existing sibling name

## Related Issues

- #10509: Support uploading attachments in contact forms
```

### Example 3: Improvement

**File:** `agent-memory/domains/data-sync/issues/9838-refactor-contacts-to-cht-datasource.md`

```yaml
---
id: cht-core-9838
category: improvement
domain: data-sync
subDomain: cht-datasource
issueNumber: 9838
issueUrl: https://github.com/medic/cht-core/issues/9838
title: Refactor contact reads to use cht-datasource instead of direct PouchDB calls
lastUpdated: 2025-09-02
summary: Migrated contact-reading code throughout cht-core from direct PouchDB/CouchDB calls to the cht-datasource shared library, consolidating data access patterns and enabling future API improvements.
services:
  - api
  - webapp
  - sentinel
techStack:
  - typescript
  - javascript
  - couchdb
  - pouchdb
---

## Problem

Contact documents were read directly from CouchDB/PouchDB in many places across the codebase using different patterns. The `shared-libs/lineage` library handled some use cases, but there was no consistent data access layer. This made it difficult to add features like caching, access control, or query optimization in one place.

## Root Cause

The codebase grew organically over time. Different developers used different approaches to load contact data: some used `shared-libs/lineage`, some queried PouchDB directly, and some used raw CouchDB HTTP calls. There was no single recommended pattern.

## Solution

Migrated all contact-reading code to use the `cht-datasource` shared library, which provides a unified API for reading contacts both with and without lineage data. This involved:
1. Identifying all call sites that read contacts directly from the database
2. Replacing them with equivalent `cht-datasource` calls
3. Ensuring lineage hydration behavior was preserved

## Code Patterns

- Use `cht-datasource` as the single data access layer for reading contacts, not direct PouchDB or CouchDB calls
- When you need a contact with its hierarchy (parent, grandparent, etc.), use the `withLineage` variant
- Pattern: `chtDatasource.v1.getContact(id)` for flat contact, `chtDatasource.v1.getContactWithLineage(id)` for hydrated
- File: `shared-libs/cht-datasource/` is the canonical data access library
- File: `shared-libs/lineage/` is the older library being phased out for read operations

## Design Choices

- Chose incremental migration (one call site at a time) over a big-bang rewrite to reduce risk
- Kept `shared-libs/lineage` functional for write operations where `cht-datasource` does not yet have equivalents
- Maintained backward compatibility by ensuring the returned data shape matches what callers expected from the old PouchDB queries

## Related Files

- shared-libs/cht-datasource/
- shared-libs/lineage/
- webapp/src/ts/services/cht-datasource.service.ts
- api/src/controllers/contact.js
- api/src/controllers/person.js
- api/src/controllers/place.js

## Testing

- Updated existing unit tests to verify they work with the new cht-datasource calls
- Added integration tests to ensure lineage hydration matches the old behavior
- No E2E changes needed since the external behavior is unchanged

## Related Issues

- #10019: Refactor code loading contacts via shared-libs/lineage to use cht-datasource
- #10091: Refactor existing getWithLineage functions to use shared-libs/lineage
```

