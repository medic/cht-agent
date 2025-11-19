# Tickets Directory

This directory contains ticket files in markdown format. These tickets are used as input to the CHT Multi-Agent System for the research and development workflow.

## Ticket File Format

Tickets are simple markdown files with minimal YAML frontmatter for metadata:

```markdown
---
title: Brief ticket title
type: feature
priority: high
domain: contacts
---

# Description

Detailed description of what needs to be done and why...

## Requirements

- Requirement 1
- Requirement 2
- Requirement 3

## Acceptance Criteria

- Criteria 1
- Criteria 2

## Constraints

- Constraint 1
- Constraint 2

## Technical Context

**Components:**
- `component/path/1`
- `component/path/2`

**Existing References:**
- reference-1
- reference-2

## References

**Similar Implementations:**
- https://github.com/medic/cht-core/pull/1234

**Documentation:**
- https://docs.communityhealthtoolkit.org/...
```

## Frontmatter Fields (Metadata Only)

The YAML frontmatter should contain only identification metadata:

- **title** (required): Brief title of the ticket
- **type** (required): One of `feature`, `bug`, or `enhancement`
- **priority** (required): One of `high`, `medium`, or `low`
- **domain** (optional): One of the 7 CHT domains (see below)
  - If not specified, the system will automatically infer the domain during research

## Markdown Sections (Detailed Content)

All detailed content goes in the markdown body with standard headings:

### Required Sections:

- **## Description** - What needs to be done and why
- **## Requirements** - Bullet list of functional requirements
- **## Acceptance Criteria** - Bullet list of success criteria
- **## Constraints** - Bullet list of constraints or limitations

### Optional Sections:

- **## Technical Context** - Technical details:
  - **Components:** (bullet list with backticks: `` - `path/to/component` ``)
  - **Existing References:** (bullet list of related features)
- **## References** - Links to related work:
  - **Similar Implementations:** (bullet list of URLs)
  - **Documentation:** (bullet list of doc URLs)
- **## User Stories** - User perspective scenarios
- **## Technical Considerations** - Additional technical notes

## CHT Domains

The `domain` field in frontmatter must be one of:

1. **authentication** - User login, permissions, roles
2. **contacts** - Contact management, hierarchy, relationships
3. **forms-and-reports** - Form definitions, submissions, reports
4. **tasks-and-targets** - Task generation, targets, scheduling
5. **messaging** - SMS integration, notifications
6. **data-sync** - Replication, offline-first, conflict resolution
7. **configuration** - App configuration, settings

## Example

See `contact-search-feature.md` for a complete working example.

## Usage

Run the research supervisor with a ticket:

```bash
# Use default ticket (contact-search-feature.md)
npm run example:research

# Use a specific ticket
npm run example:research tickets/my-ticket.md

# Use a ticket from another location
npm run example:research /path/to/ticket.md
```

## Creating Your Own Ticket

### Minimal Template (domain will be inferred):

```markdown
---
title: Your ticket title
type: feature
priority: high
---

# Description

What needs to be done...

## Requirements

- Requirement 1
- Requirement 2

## Acceptance Criteria

- Criteria 1
- Criteria 2

## Constraints

- Constraint 1
```

### With Domain Specified (optional):

```markdown
---
title: Your ticket title
type: feature
priority: high
domain: contacts
---
...
```

### Steps:

1. Create a new `.md` file with the minimal frontmatter (3 required fields: title, type, priority)
2. Add your description and sections as markdown
3. Use bullet lists (`-` or `*`) for requirements, criteria, constraints
4. Optionally specify domain if you know it (will be auto-inferred if not)
5. Optionally add Technical Context section with components
6. Include URLs in References section if available
7. Save and run with the research supervisor

## Tips for Non-Technical Users

- **Title**: Keep it short and descriptive (e.g., "Add search to contacts page")
- **Type**:
  - `feature` = new functionality
  - `bug` = something is broken
  - `enhancement` = improve existing functionality
- **Priority**:
  - `high` = urgent/critical
  - `medium` = important but not urgent
  - `low` = nice to have
- **Domain**: You can skip this! The system will figure it out from your description
  - If you do know it, you can specify it to speed things up
- **Description**: Explain what you need and why in plain language
- **Requirements**: List what the solution should do
- **Acceptance Criteria**: How will you know it's done correctly?
- **Constraints**: Any limitations or requirements (offline support, compatibility, etc.)

You don't need to fill in Technical Context, Components, or References - the research agents will automatically find and add that information!
