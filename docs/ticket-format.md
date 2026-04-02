# Ticket YAML Frontmatter Format

This document provides a detailed specification of the YAML frontmatter format required for all tickets (issues) in the CHT-Agent project.

## Required Fields

Every ticket must include the following fields in its YAML frontmatter:

- `title` **(string)**: A brief description of the issue.
- `type` **(enum)**: The category of the work.
- `domain` **(string)**: The primary CHT domain the ticket applies to (e.g., `forms`, `tasks`, `reports`).

## Optional Fields

You can optionally include these fields to provide more context:

- `priority` **(enum)**: The urgency of the ticket.
- `components` **(list of strings)**: A list of affected components in the codebase.
- `labels` **(list of strings)**: Additional categorization or tags.

## Valid Values for Enums

For fields that act as enums, you must use one of the following exact string values:

### `type`
- `bug`: For fixing incorrectly behaving code.
- `feature`: For adding new functionality.
- `enhancement`: For improving existing functionality.
- `refactor`: For restructuring existing code without changing its external behavior.

### `priority`
- `low`
- `medium`
- `high`

## Examples

Below are complete examples of different ticket types. All tickets should enclose the YAML frontmatter within `---` lines at the top of the file.

### 1. Bug Fix Ticket

```yaml
---
title: "Fix crash when rendering empty list in forms"
type: "bug"
domain: "forms"
priority: "high"
components:
  - "FormRenderer"
  - "ListWidget"
labels:
  - "critical"
  - "ui"
---

**Description:**
The app currently crashes if the form contains an empty list...
```

### 2. New Feature Ticket

```yaml
---
title: "Add offline caching for submitted reports"
type: "feature"
domain: "reports"
priority: "medium"
components:
  - "OfflineStorage"
---

**Description:**
We need to introduce offline caching for submitted reports so users in low-connectivity areas...
```

### 3. Enhancement Ticket

```yaml
---
title: "Improve load time for task list view"
type: "enhancement"
domain: "tasks"
priority: "low"
labels:
  - "performance"
---

**Description:**
The task list view is taking too long to load when there are over 1000 tasks. Let's paginate...
```

### 4. Refactoring Ticket

```yaml
---
title: "Extract common API client logic"
type: "refactor"
domain: "core"
components:
  - "ApiClient"
  - "AuthMiddleware"
---

**Description:**
The API client logic is currently duplicated across multiple files. We should abstract...
```