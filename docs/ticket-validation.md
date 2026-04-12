# Ticket Validation Guide

This document explains how to validate ticket files to ensure they meet the required format before processing.

## Overview

The ticket validation system checks ticket files for:
- Required YAML frontmatter fields
- Valid field values
- Complete content
- Proper formatting

## Usage

### Command Line Interface

Validate individual ticket files:

```bash
npm run validate-ticket path/to/ticket.md
```

Validate all ticket files in a directory:

```bash
npm run validate-ticket --dir path/to/tickets
```

Show detailed output for each file:

```bash
npm run validate-ticket --dir path/to/tickets --verbose
```

### Programmatic Usage

```typescript
import { validateTicketFile } from '../src/utils/ticket-parser';

const result = validateTicketFile('path/to/ticket.md');

if (result.valid) {
  console.log('Ticket is valid');
} else {
  console.log('Errors found:');
  result.errors.forEach(error => console.log(`- ${error}`));
}
```

## Validation Rules

### Required Fields

All tickets must include these fields in the YAML frontmatter:
- `title`: Brief description of the issue
- `type`: One of 'feature', 'bug', 'improvement'
- `priority`: One of 'high', 'medium', 'low'
- `domain`: One of the valid CHT domains

### Content Requirements

- Description must not be empty
- Ticket should include markdown sections (recommended)
- Requirements and acceptance criteria are recommended

### Error Examples

Invalid ticket:

```markdown
---
title: 
type: invalid-type
priority: high
domain: messaging
---

## Description

Missing title and invalid type.

## Requirements
- Requirement 1
```

Output:

```
File: ticket.md
Status: INVALID

Errors:
  - Title is required in the YAML frontmatter
  - Type must be one of: feature, bug, improvement
```

## Best Practices

1. Always validate tickets before submission
2. Include all required fields
3. Use descriptive titles
4. Provide complete information in each section
5. Follow the established ticket format