# Tickets Directory

This directory contains ticket files in markdown format. These tickets are used as input to the CHT Multi-Agent System for the research and development workflow.

For the full specification (enums, examples, and how **components** are parsed from the body), see [Ticket format](../docs/ticket-format.md).

## Ticket File Format

Tickets are markdown files with YAML frontmatter for metadata:

```markdown
---
title: Brief ticket title
type: feature
priority: high
domain: contacts
---

## Description

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

## Frontmatter fields (YAML)

**Required** (the parser rejects tickets missing any of these):

- **title** — Short title of the ticket
- **type** — One of `feature`, `bug`, or `improvement`
- **priority** — One of `high`, `medium`, or `low`
- **domain** — One of the eight CHT domains (see below)

**Optional:**

- **labels** — Additional tags (list or scalar, depending on your YAML)

Other custom frontmatter keys may be present for your own tooling; the agent pipeline only reads the fields above.

**Components** belong in the markdown body under `## Technical Context` → **`Components:`**, not in frontmatter.

## Markdown sections (body)

### Required sections

- **## Description** — What needs to be done and why (the parser matches this exact `##` heading)
- **## Requirements** — Bullet list of functional requirements
- **## Acceptance Criteria** — Bullet list of success criteria
- **## Constraints** — Bullet list of constraints or limitations

### Optional sections

- **## Technical Context** — **`Components:`** (bullets, ideally with backticks: `` `path/to/component` ``), **`Existing References:`**
- **## References** — **`Similar Implementations:`** and **`Documentation:`** with URLs
- **## User Stories** — User-facing scenarios
- **## Technical Considerations** — Extra technical notes

## CHT domains

The `domain` frontmatter value must be exactly one of:

1. **authentication** — User login, permissions, roles
2. **contacts** — Contact management, hierarchy, relationships
3. **forms-and-reports** — Form definitions, submissions, reports
4. **tasks-and-targets** — Task generation, targets, scheduling
5. **messaging** — SMS integration, notifications
6. **data-sync** — Replication, offline-first, conflict resolution
7. **configuration** — App configuration, settings
8. **interoperability** — FHIR, outbound push, mediators, external systems

## Example

See `contact-search-feature.md` for a fuller example (note: use `## Description` if you want the parser to populate `issue.description` from that section).

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

## Creating your own ticket

### Minimal template

```markdown
---
title: Your ticket title
type: feature
priority: high
domain: contacts
---

## Description

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

### Steps

1. Create a new `.md` file with the four required frontmatter fields (`title`, `type`, `priority`, `domain`).
2. Add **## Description** and the other body sections as markdown.
3. Use bullet lists (`-` or `*`) for requirements, criteria, and constraints.
4. Optionally add **## Technical Context** with **`Components:`** and **`Existing References:`**.
5. Optionally add **## References** with URLs.
6. Save and run with the research supervisor.

## Tips for non-technical users

- **Title**: Keep it short and descriptive (e.g., "Add search to contacts page").
- **Type**:
  - `feature` = new functionality
  - `bug` = something is broken
  - `improvement` = improve existing functionality (same idea as GitHub **Type: Improvement**)
- **Priority**:
  - `high` = urgent or critical
  - `medium` = important but not urgent
  - `low` = nice to have
- **Domain**: Pick the area that best matches the work; see the list above.
- **Description**: Explain what you need and why in plain language.
- **Requirements**: List what the solution should do.
- **Acceptance Criteria**: How you will know it is done correctly.
- **Constraints**: Limitations (offline support, compatibility, etc.).

You do not have to fill in **Technical Context** or **References** before running research; agents can help discover related components and links.
