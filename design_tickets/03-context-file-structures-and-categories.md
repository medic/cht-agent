# Context File Structure & Categories

Based on two manual multi-agent iterations, we have [context files](https://github.com/medic/cht-core/blob/poc/add_cht_datasource_apis/.claude-agent-context/cht-datasource/developer-context.md)

What categories inside the Context File should be mandatory and required by our agent?

--- 

**Comment by @sugat009 at 2025-11-08T15:44:07Z:**

I went through a few different possible field combinations that could be kept in the context files. For simplicity and minimal files, I think the format below for the different context files would work.

---

## 1. Domain Context Files

### `domains/{domain}/overview.md`

```markdown
---
domain: string
last_updated: ISO-8601
related_domains: [string]
---

# {Domain Name} - Overview

## Purpose

What this domain handles in CHT

## Key Concepts

- Concept 1: Definition
- Concept 2: Definition

## Scope

### Included

- Feature 1
- Feature 2

### Not Included

- See other domains

## Key Technologies

- Technology (version) - Purpose

## Quick Reference

- Primary Components: Main files
- Main Entry Points: Where to start
- Critical Libraries: Dependencies
- Tests: Test locations

## Common Use Cases

1. Use case 1
2. Use case 2

## Known Challenges

- Challenge and mitigation

## Documentation

- [CHT Docs Link](url)
```

### `domains/{domain}/components.json`

```json
{
  "domain": "domain-name",
  "last_updated": "ISO-8601",
  "components": {
    "api": {
      "controllers": [
        {
          "path": "string",
          "purpose": "string",
          "key_functions": [
            "string"
          ]
        }
      ],
      "services": [
        {
          "path": "string",
          "purpose": "string"
        }
      ]
    },
    "webapp": {
      "modules": [
        {
          "path": "string",
          "purpose": "string"
        }
      ],
      "services": [
        {
          "path": "string",
          "purpose": "string"
        }
      ]
    },
    "sentinel": {
      "transitions": [
        {
          "path": "string",
          "purpose": "string"
        }
      ]
    },
    "shared_libs": [
      {
        "path": "string",
        "purpose": "string",
        "critical": boolean
      }
    ],
    "ddocs": [
      {
        "path": "string",
        "purpose": "string"
      }
    ],
    "tests": {
      "unit": [
        "string"
      ],
      "integration": [
        "string"
      ],
      "e2e": [
        "string"
      ]
    }
  }
}
```

---

## 2. Workflow Context Files

### `workflows/{workflow}/flow.md`

```markdown
---
workflow: string
services_involved: [string]
last_updated: ISO-8601
---

# Workflow: {Workflow Name}

## Overview

Brief description

## Flow Diagram
```

┌─────────┐ ┌─────────┐ ┌─────────┐
│ Service │───→│ Service │───→│ Service │
└─────────┘ └─────────┘ └─────────┘

```

## Step-by-Step Flow

### Step 1: {Action}
- **Service**: service-name
- **Component**: file-path
- **Action**: What happens
- **Input**: Input data
- **Output**: Output data

```language
// Code example
```

### Step 2: {Action}

[Repeat structure...]

## Data Flow Evolution

### Initial Input

```json
{
  "data": "structure"
}
```

### After Step 1

```json
{
  "data": "transformed"
}
```

## Error Scenarios

### Error 1: {Name}

- **When**: Condition
- **Where**: Location
- **Handling**: How handled
- **User Impact**: What user sees

## Related Domains

- [Domain](link)

```

### `workflows/{workflow}/involved-components.json`

```json
{
  "workflow": "workflow-name",
  "last_updated": "ISO-8601",
  "services": [
    {
      "service": "string",
      "role": "string",
      "components": ["string"],
      "entry_point": "string"
    }
  ],
  "shared_libs": [{"name": "string", "used_by": ["string"], "purpose": "string"}],
  "data_flow": "string"
}
```

---

## 3. Infrastructure Context Files

### `infrastructure/{component}/overview.md`

```markdown
---
component: string
importance: CRITICAL | HIGH | MEDIUM | LOW
last_updated: ISO-8601
---

# {Component Name} - Overview

## Purpose

What this component does

## Importance Level

**CRITICAL** | **HIGH** | **MEDIUM** | **LOW**

## Used By

- Service 1 - How used
- Service 2 - How used

## Key Concepts

### Concept 1

Explanation

## Architecture
```

Diagram

```

## Core Functionality
### Feature 1
```language
// Example code
```

## Dependencies

### Internal

- Dependency: Purpose

### External

- Package (version): Purpose

## Common Use Cases

### Use Case 1

```language
// Example
```

## Performance Characteristics

- Metric: Notes

## Known Limitations

- Limitation

## Related Components

- [Component](link)

```

---

## 4. Knowledge Base Files (Resolved Issues)

### `knowledge-base/resolved-issues/by-domain/{domain}/{year}/{month}/issue-{number}.md`

```markdown
---
id: ctx-{number}-{domain}
issue_number: number
timestamp: ISO-8601

category: string
domains: [string]
phase: completed

task_id: string
summary: string
tech_stack: [string]
components:
  api: [string]
  webapp: [string]
  sentinel: [string]
  shared_libs: [string]
  tests: [string]
---

# Issue #{number}: {Title}

## Problem

### User-Facing Symptom
What user experienced

**Error:**
```

Error message

```

### Reproduction
1. Step 1
2. Step 2
3. **Result**: What happens
4. **Expected**: What should happen

## Research

### Root Cause
Technical cause

### Similar Issues
- #{number} - Description

### Documentation
- [Link](url)

## Implementation

### Code Changes

**File: `path/to/file.js`**

Before:
```javascript
// Old code
```

After:

```javascript
// New code
```

### Tests Added

```javascript
// Test code
```

## Validation

### Test Results

```bash
✓ Tests passed
```

### Coverage

- Lines: X% (+Y%)

## Resolution

- **PR**: #{number}
- **Merged**: Date
- **Status**: Completed

## Lessons Learned

**Pattern:**

```javascript
// Reusable pattern
```

**Tags:** `#tag1` `#tag2`

```

---

## 5. Index Files

### `indices/domain-to-components.json`

```json
{
  "last_updated": "ISO-8601",
  "domains": {
    "domain-name": {
      "description": "string",
      "api": {"controllers": ["string"], "services": ["string"]},
      "webapp": {"modules": ["string"], "services": ["string"]},
      "sentinel": {"transitions": ["string"]},
      "shared_libs": [{"name": "string", "critical": boolean}],
      "tests": {"unit": ["string"], "integration": ["string"], "e2e": ["string"]}
    }
  }
}
```

### `indices/workflow-to-services.json`

```json
{
  "last_updated": "ISO-8601",
  "workflows": {
    "workflow-name": {
      "description": "string",
      "flow": [
        {
          "step": 1,
          "service": "string",
          "component": "string",
          "action": "string"
        }
      ],
      "data_flow": "string",
      "key_files": [
        "string"
      ]
    }
  }
}
```

### `indices/error-patterns.json`

```json
{
  "last_updated": "ISO-8601",
  "patterns": {
    "Error message": {
      "category": "string",
      "common_locations": [
        "string"
      ],
      "related_domains": [
        "string"
      ],
      "typical_causes": [
        "string"
      ],
      "solutions": [
        {
          "approach": "string",
          "code": "string",
          "success_rate": number
        }
      ],
      "related_issues": [
        number
      ]
    }
  }
}
```

### `indices/test-coverage-map.json`

```json
{
  "last_updated": "ISO-8601",
  "coverage_map": {
    "path/to/file.js": {
      "unit_tests": [
        "string"
      ],
      "integration_tests": [
        "string"
      ],
      "e2e_tests": [
        "string"
      ],
      "coverage": {
        "lines": number,
        "branches": number,
        "functions": number
      }
    }
  }
}
```

---

## 6. Agent Workspace Files

### `agent-workspaces/{agent}/documentation-index.json` (Research Agent)

```json
{
  "last_updated": "ISO-8601",
  "agent": "agent-name",
  "documentation_index": {
    "domain": {
      "official_docs": [
        {
          "url": "string",
          "title": "string",
          "topics": [
            "string"
          ]
        }
      ],
      "code_examples": [
        "string"
      ]
    }
  },
  "search_patterns": {
    "pattern-name": {
      "keywords": [
        "string"
      ],
      "likely_files": [
        "string"
      ],
      "common_solution": "string"
    }
  }
}
```

### `agent-workspaces/{agent}/test-selection-rules.md` (Test Orchestration)

```markdown
---
agent: agent-name
last_updated: ISO-8601
---

# {Agent Name} - Rules

## Rule 1: {Rule Name}

**Description**

### Example:

```language
// Code or config
```

## Rule 2: {Rule Name}

[Repeat structure...]

```

---

## Key Design Principles

### 1. File Format
- **Markdown files**: Use YAML frontmatter + Markdown content
- **Index files**: Use pure JSON for fast lookups

### 2. Required Fields (All Context Files)

#### Markdown Files:
```yaml
---
# Type-specific identifier (domain, workflow, component, agent)
id_field: value

# Last update timestamp
last_updated: ISO-8601

# Type-specific fields...
---
```

#### Knowledge Base (Resolved Issues):

```yaml
---
# REQUIRED
id: ctx-{number}-{domain}
issue_number: number
timestamp: ISO-8601

category: string
domains: [ string ]
phase: completed

task_id: string
summary: string
tech_stack: [ string ]
components: object

# RECOMMENDED
test_scenarios: [ object ]
validation_results: object

# OPTIONAL
tags: [ string ]
---
```

### 3. Append-Only Philosophy

- Context files **grow** through phases
- Research → Implementation → Validation → Completion
- Previous sections remain, new sections added

### 4. No Versioning Fields

- No `version` field (Git handles history)
- No `correlation_id` field (use `issue_number`)
- Just `timestamp` for last update time

---

## Field Types Reference

```typescript
// Common field types
string              // Text
number              // Integer or float
boolean             // true/false
ISO - 8601           // "2025-11-08T10:00:00Z"
    [string]           // Array of strings
object             // Nested structure
```

---

## Summary

### Context File Types

| Type                 | Format    | Location                          | Purpose                     |
|----------------------|-----------|-----------------------------------|-----------------------------|
| **Domain**           | MD + YAML | `domains/{name}/`                 | Document functional domains |
| **Workflow**         | MD + YAML | `workflows/{name}/`               | Document end-to-end flows   |
| **Infrastructure**   | MD + YAML | `infrastructure/{name}/`          | Document shared libraries   |
| **Knowledge Base**   | MD + YAML | `knowledge-base/resolved-issues/` | Document resolved issues    |
| **Indices**          | JSON      | `indices/`                        | Fast lookup tables          |
| **Agent Workspaces** | JSON/MD   | `agent-workspaces/{agent}/`       | Agent-specific knowledge    |

### Required vs Recommended

- **Required**: Fields that MUST exist for agents to function
- **Recommended**: Fields that significantly improve agent effectiveness
- **Optional**: Nice-to-have fields for additional context

### Parsing

```javascript
// Markdown with YAML frontmatter
const matter = require('gray-matter');
const {data, content} = matter(fs.readFileSync('file.md', 'utf8'));

// JSON files
const data = JSON.parse(fs.readFileSync('file.json', 'utf8'));
```

