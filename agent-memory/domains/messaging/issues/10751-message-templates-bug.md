---
id: cht-core-10751
category: bug
domain: messaging
subDomain: templates
issueNumber: 10751
issueUrl: https://github.com/medic/cht-core/issues/10751
title: Message templates not loading correctly when using dynamic placeholders
lastUpdated: 2026-04-12
summary: Message templates with dynamic placeholders like {{patient.name}} and {{clinic.location}} were failing to load or rendering incorrectly, causing automated messages to contain empty or undefined values instead of the actual data.
services:
  - api
  - webapp
techStack:
  - javascript
  - nodejs
  - handlebars
---

## Problem

Automated messages were sending with empty or undefined values instead of the actual patient and clinic data. Messages like "Hello {{patient.name}}, your appointment is at {{clinic.location}}" would arrive as "Hello , your appointment is at " making them useless for communication. This affected all automated messaging features including appointment reminders, follow-up messages, and alert notifications.

## Root Cause

The template loading system had two main issues:
1. Placeholder resolution was happening before the template was fully compiled, causing variables to be evaluated in the wrong scope
2. The template engine was not properly escaping nested template syntax, causing conflicts between dynamic content and template structure

When templates contained nested placeholders or complex data structures, the resolution would fail silently, resulting in empty values.

## Solution

Restructured the template loading and resolution pipeline:
- Separated template compilation from placeholder resolution
- Implemented a two-pass system: first compile the template structure, then resolve placeholders
- Added proper scope chaining for nested data access
- Created a placeholder validation step to detect malformed syntax before processing
- Implemented fallback values for missing or undefined placeholders

The key change was ensuring placeholder resolution happens after template compilation in the correct scope context.

## Code Patterns

- Use template compilation first: `const compiled = template.compile(source)`
- Then resolve placeholders: `const result = compiled(context)`
- Implement scope chaining: `context.patient?.name` instead of `context.patient.name`
- Add placeholder validation: `{{#if placeholder}}content{{/if}}`
- Pattern: `const resolvedTemplate = compiledTemplate(context);` separates compilation from execution
- File: `template-loader.js` contains the core template processing logic
- The fix ensures all placeholders are properly resolved with the correct data context

## Design Choices

Chose to restructure the entire template pipeline rather than adding quick fixes because the issue was fundamental to how templates were processed. This approach provides a solid foundation for future template features and ensures reliable processing of all template types.

## Related Files

- template-loader.js
- api/src/services/template-service.js
- webapp/src/components/MessageTemplate.vue
- test/unit/templates.test.js

## Testing

- Created test suite covering various placeholder patterns and data structures
- Tested nested placeholders like {{patient.contact.phone}}
- Verified edge cases with null or undefined values
- Performance testing for template compilation and resolution
- Integration testing with real message templates

## Related Issues

- #10802: Message processing state management
- Multiple issues related to template rendering and data binding