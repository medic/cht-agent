# Ticket format (YAML frontmatter and markdown body)

Tickets are markdown files used as input to the CHT-Agent workflow. Each file starts with **YAML frontmatter** (between `---` delimiters) for structured metadata, followed by a **markdown body** with human-readable sections.

The parser lives in [`src/utils/ticket-parser.ts`](../src/utils/ticket-parser.ts). It reads frontmatter for `title`, `type`, `domain`, and `priority`, and pulls detailed fields (including **components**) from the body.

## Required frontmatter fields

These four keys must be present in the YAML block. Omitting any of them causes parsing to fail.

| Field | Type | Description |
| --- | --- | --- |
| `title` | string | Short, human-readable summary of the issue. |
| `type` | enum | Kind of work: `bug`, `feature`, or `improvement` (see [Valid values](#valid-values)). |
| `domain` | enum | Primary CHT functional area (see [Valid values](#valid-values)). |
| `priority` | enum | Relative urgency: `high`, `medium`, or `low`. |

## Optional frontmatter fields

| Field | Type | Description |
| --- | --- | --- |
| `labels` | list or string | Extra tags for categorization (e.g. GitHub-style labels). The parser coerces YAML values to strings internally; use simple scalar values if you rely on tooling beyond this repo. |
| *(custom)* | any | You may add other YAML keys for local or external tooling. They are **not** mapped onto the parsed `IssueTemplate` today; the pipeline only consumes the fields documented here. They remain in the file for your own records. |

## Markdown body sections

Use `##` headings so the parser can find each block.

### `## Description`

What should change and why. If this section is missing, the parser falls back to the raw body text.

### `## Technical Context`

Optional but recommended when you already know affected areas.

- **`Components:`** (bold label, then a bullet list)

  List components under **`Components:`** as bullets. Prefer backticks around paths or names (e.g. `` `webapp/modules/contacts` ``). The parser collects these via `extractCodeItems()` and stores them in `issue.technical_context.components`.

  **Do not put `components` in YAML frontmatter**—only this markdown subsection is supported.

- **`Existing References:`** (optional)

  Bullet list of related features or references.

### Other sections

- `## Requirements` — bullet list of functional requirements  
- `## Acceptance Criteria` — bullet list of success conditions  
- `## Constraints` — bullet list of limits or non-goals  
- `## References` — optional `**Similar Implementations:**` and `**Documentation:**` subsections with URLs  

You may add other sections for readers; the parser only extracts the sections above.

## Valid values

### `type`

| Value | Meaning |
| --- | --- |
| `bug` | Fixing incorrectly behaving code or behavior. |
| `feature` | Adding new functionality. |
| `improvement` | Improving existing functionality without framing it as a net-new feature (aligns with GitHub **Type: Improvement**). |

Values such as `refactor` or `enhancement` are **not** accepted by the ticket parser.

### `domain`

Must be exactly one of:

| Value | Typical scope |
| --- | --- |
| `authentication` | Login, permissions, roles, security |
| `contacts` | Contact records, hierarchy, relationships |
| `forms-and-reports` | Forms, submissions, reporting |
| `tasks-and-targets` | Tasks, targets, rules, scheduling |
| `messaging` | SMS, notifications, messaging flows |
| `data-sync` | Replication, offline-first, conflicts |
| `configuration` | App settings, `cht-conf`, configuration |
| `interoperability` | FHIR, outbound push, mediators, external systems |

### `priority`

- `high`
- `medium`
- `low`

## Examples

Each example uses valid `type`, `domain`, and `priority` values. **`Components`** appear only under `## Technical Context`, not in frontmatter.

### 1. Bug fix (`contacts`, `high`)

```markdown
---
title: "Fix contact search crash when query is empty"
type: bug
domain: contacts
priority: high
labels:
  - regression
---

## Description

Submitting an empty search string on the contacts page throws an unhandled exception instead of showing an empty state.

## Technical Context

**Components:**
- `webapp/modules/contacts`
- `api/controllers/contacts`

## Requirements

- Empty query must not throw.
- UI shows a clear empty state.

## Acceptance Criteria

- No console errors for empty search.
- Existing non-empty search behavior unchanged.

## Constraints

- Must work offline-first as today.

## References

**Documentation:**
- https://docs.communityhealthtoolkit.org/apps/reference/contact-page/
```

### 2. New feature (`forms-and-reports`, `medium`)

```markdown
---
title: "Add column picker to monthly supervisor report"
type: feature
domain: forms-and-reports
priority: medium
---

## Description

Supervisors need to hide columns they do not use on the monthly report export so the sheet is easier to scan on small screens.

## Technical Context

**Components:**
- `webapp/modules/reports`
- `api/services/reports`

## Requirements

- User can toggle visible columns before export.
- Preferences persist for the session.

## Acceptance Criteria

- Export reflects selected columns only.
- Default remains full column set.

## Constraints

- Compatible with CHT 4.x.

## References

**Similar Implementations:**
- https://github.com/medic/cht-core/pull/1234
```

### 3. Improvement (`tasks-and-targets`, `low`)

```markdown
---
title: "Reduce redundant API calls when loading task list"
type: improvement
domain: tasks-and-targets
priority: low
labels:
  - performance
---

## Description

The task list issues duplicate fetches on first paint; batch or cache the initial load to improve perceived performance on slow devices.

## Technical Context

**Components:**
- `webapp/modules/tasks`
- `api/services/tasks`

## Requirements

- Single consolidated fetch (or equivalent) for initial list load.
- No change to task correctness or ordering rules.

## Acceptance Criteria

- Network tab shows fewer duplicate requests on cold load.
- All existing task list tests pass.

## Constraints

- Behavior must remain correct when tasks update in real time.

## References

**Documentation:**
- https://docs.communityhealthtoolkit.org/apps/reference/tasks/
```

## See also

- [Tickets directory README](../tickets/README.md) — quick template and CLI usage  
- [Project README](../README.md) — link to this guide under **Project Structure**
