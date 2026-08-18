---
id: cht-core-9915
category: improvement
domain: contacts
subDomain: forms
issueNumber: 9915
issueUrl: https://github.com/medic/cht-core/issues/9915
title: Replace deprecated db-object appearance with select-contact
lastUpdated: '2026-08-17'
summary: Migrated all XML forms in config/default and config/covid-19 from the deprecated db-object appearance and db:type bind to the modern select-contact appearance with string bind type. Also replaced deprecated horizontal-compact and horizontal appearances.
services:
  - webapp
techStack:
  - xml
  - xlsform
  - cht-conf
related_issues:
  - cht-core-8074
---

## Problem

The `db-object` appearance and `db:{{type}}` bind type used in CHT XML forms were deprecated in `cht-conf`. Running form validation/upload produced deprecation warnings. The CHT-Core default and COVID-19 config forms had not yet been migrated to the modern `select-contact` appearance.

## Root Cause

The `db-object` widget was replaced by `select-contact` which has superior support for multiple contact types. The old `db:person` bind type was replaced by `string` bind type with the contact type specified in the appearance. Config forms in `config/default` and `config/covid-19` still used the old syntax.

## Solution

PR #9924 (`41362a25`) modified 50 files across both config directories — 29 `.xml` forms and 21 `.xlsx` sources, no additions or deletions. The migration followed a documented rule:
- `<bind type="db:person"/>` -> `<bind type="string"/>`
- `<input appearance="db-object">` -> `<input appearance="select-contact type-person">`

Additionally, two other deprecated appearances were updated:
- `horizontal-compact` -> `columns-pack`
- `horizontal` -> `columns`

Two paths were used, because not every form has a one-to-one source. For the 17 forms that do, the `.xlsx` was edited and the XML regenerated via `cht-conf convert-contact-forms` / `convert-app-forms`. The 12 place create/edit XMLs have no per-type source of their own: cht-conf expands them from the shared `PLACE_TYPE-create.xlsx` / `PLACE_TYPE-edit.xlsx` templates, so this PR edited those two templates in each config directory (4 files, whose own XML is not checked in) and updated the 12 generated place XMLs directly in the same change.

## Code Patterns

- Migration rule: change bind type from `db:{{contact_type}}` to `string`, change appearance from `db-object` to `select-contact type-{{contact_type}}`
- The `bind-id-only` modifier is preserved with `select-contact`: `select-contact type-person bind-id-only`
- `hidden` modifier also preserved: `select-contact hidden`
- File: `config/default/forms/app/*.xml` — 11 app form files updated
- File: `config/default/forms/contact/*.xml` — 8 contact form files updated
- File: `config/covid-19/forms/app/*.xml` — 2 app form files updated
- File: `config/covid-19/forms/contact/*.xml` — 8 contact form files updated
- Edit the `.xlsx` source first and regenerate the XML via `cht-conf` wherever a form has its own source; the place create/edit forms are expanded from the shared `PLACE_TYPE-*.xlsx` templates, so their generated XML is edited directly instead

## Design Choices

- Migration is a mechanical find-and-replace following documented rules, not a behavioral change
- Source-of-truth is the `.xlsx` files. For the 17 forms with their own source the XML was regenerated rather than hand-edited; the 12 place create/edit forms have no per-type source, so their `PLACE_TYPE-*.xlsx` template was edited and the checked-in expansions were updated by hand in the same change
- All three deprecated appearances were handled in one PR to avoid multiple passes

## Related Files

- config/default/forms/app/
- config/default/forms/contact/
- config/covid-19/forms/app/
- config/covid-19/forms/contact/

## Testing

- Validated by running `cht-conf` form validation with zero deprecation warnings after migration
- Source/output consistency is checkable from the diff itself: of 29 changed `.xml` files, 17 have a same-named `.xlsx` changed alongside them, and the remaining 12 are the place create/edit forms expanded from the 4 changed `PLACE_TYPE-*.xlsx` templates

## Related Issues

- cht-conf#502: Original deprecation of db-object
- cht-conf#682: PR that introduced deprecation warnings for db-object
- #8074: Feature that added descendant-of-current-contact to the select-contact widget
