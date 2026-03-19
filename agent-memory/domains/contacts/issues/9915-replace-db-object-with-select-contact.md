---
id: cht-core-9915
category: refactoring
domain: contacts
subDomain: forms
issueNumber: 9915
issueUrl: https://github.com/medic/cht-core/issues/9915
title: Replace deprecated db-object appearance with select-contact
lastUpdated: 2026-03-16
summary: Migrated all XML forms in config/default and config/covid-19 from the deprecated db-object appearance and db:type bind to the modern select-contact appearance with string bind type. Also replaced deprecated horizontal-compact and horizontal appearances.
services:
  - config
techStack:
  - xml
  - xlsform
  - cht-conf
---

## Problem

The `db-object` appearance and `db:{{type}}` bind type used in CHT XML forms were deprecated in `cht-conf`. Running form validation/upload produced deprecation warnings. The CHT-Core default and COVID-19 config forms had not yet been migrated to the modern `select-contact` appearance.

## Root Cause

The `db-object` widget was replaced by `select-contact` which has superior support for multiple contact types. The old `db:person` bind type was replaced by `string` bind type with the contact type specified in the appearance. Config forms in `config/default` and `config/covid-19` still used the old syntax.

## Solution

PR #9924 updated all 51 XML form files across both config directories. The migration followed a documented rule:
- `<bind type="db:person"/>` -> `<bind type="string"/>`
- `<input appearance="db-object">` -> `<input appearance="select-contact type-person">`

Additionally, two other deprecated appearances were updated:
- `horizontal-compact` -> `columns-pack`
- `horizontal` -> `columns`

The correct workflow was followed: edit `.xlsx` source files, then regenerate XML via `cht-conf convert-contact-forms` / `convert-app-forms`.

## Code Patterns

- Migration rule: change bind type from `db:{{contact_type}}` to `string`, change appearance from `db-object` to `select-contact type-{{contact_type}}`
- The `bind-id-only` modifier is preserved with `select-contact`: `select-contact type-person bind-id-only`
- `hidden` modifier also preserved: `select-contact hidden`
- File: `config/default/forms/app/*.xml` — 10 app form files updated
- File: `config/default/forms/contact/*.xml` — 8 contact form files updated
- File: `config/covid-19/forms/app/*.xml` — 2 app form files updated
- File: `config/covid-19/forms/contact/*.xml` — 6 contact form files updated
- Always edit `.xlsx` source files first, then regenerate XML via `cht-conf`

## Design Choices

- Migration is a mechanical find-and-replace following documented rules, not a behavioral change
- Source-of-truth is the `.xlsx` files — XML is regenerated, not hand-edited (exception: place create/edit XMLs which were directly edited)
- All three deprecated appearances were handled in one PR to avoid multiple passes

## Related Files

- config/default/forms/app/
- config/default/forms/contact/
- config/covid-19/forms/app/
- config/covid-19/forms/contact/

## Testing

- Validated by running `cht-conf` form validation with zero deprecation warnings after migration
- Reviewer verified the correct workflow (xlsx edit -> xml regeneration) was followed

## Related Issues

- cht-conf#502: Original deprecation of db-object
- cht-conf#682: PR that introduced deprecation warnings for db-object
- #8074: Feature that added descendant-of-current-contact to the select-contact widget
