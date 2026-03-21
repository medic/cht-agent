---
domain: forms-and-reports          # Required: One of 7 domains
title: Enketo Form Rendering       # Required: Brief descriptive title
last_updated: 2026-02-16           # Required: ISO date
tags: [enketo, forms, validation]  # Optional: Freeform tags for searchability
---

# Enketo Form Rendering

## Summary

<!-- Required: 2-3 sentence overview of this context -->

Brief description of what this context covers and why it's important for agents working in this area.

## Key Concepts

<!-- Recommended: Core concepts an agent needs to understand -->

- **Concept 1**: Description
- **Concept 2**: Description
- **Concept 3**: Description

## Code Patterns

<!-- Recommended: Common patterns found in this area -->

### Pattern Name

```typescript
// Example code showing the pattern
```

**When to use**: Description of when this pattern applies.

**Related files**:
- `path/to/file1.ts`
- `path/to/file2.ts`

## Related Components

<!-- Recommended: Files and modules related to this context -->

| Component | Path | Purpose |
|-----------|------|---------|
| Service | `webapp/src/ts/services/enketo.service.ts` | Main service |
| Controller | `api/src/controllers/forms.js` | API endpoint |

## Common Issues

<!-- Optional: Known issues and their solutions -->

### Issue: Form validation fails silently

**Symptoms**: Form submits but data is not saved.

**Cause**: Missing required field in form definition.

**Solution**: Check form XML for required fields.

**Related**: Link to GitHub issue if applicable.

## Dependencies

<!-- Optional: What this depends on and what depends on it -->

**Depends on**:
- `shared-libs/validation`
- `enketo-core`

**Dependents**:
- Report generation
- Task triggers

## Performance Notes

<!-- Optional: Performance considerations -->

- Large forms may cause memory issues on low-end devices
- Consider lazy loading for forms with many repeats

## Migration Notes

<!-- Optional: Version-specific migration information -->

- v4.0: Migrated from AngularJS to Angular
- v3.5: Added offline form caching

## References

<!-- Optional: Links to documentation, issues, or external resources -->

- [CHT Docs: Forms](https://docs.communityhealthtoolkit.org/apps/reference/forms/)
- [Enketo Documentation](https://enketo.org/docs/)
