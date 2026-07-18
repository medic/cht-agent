---
title: "'Level of Education' select is corrupted by a choice-filter expression in its calculate"
type: bug
priority: medium
domain: contacts
layer: cht-conf
configArtifact: contact-form
artifactName: f_client-create
chtConfVersion: "3.21.4"
deploymentRef: "/workspace/cht-conf-project"
---

## Description

CHPs report the "Level of Education" field has validation/functionality
errors that block accurate data entry. In the config, the field is a
required, user-answerable select that ALSO carries a `calculate` — the
calculate overwrites any manual selection with a value that is not a valid
choice, so the field cannot reliably hold what the CHP selects.

## Technical Context

- Broken bind — `forms/contact/f_client-create.xml:19310`:
  `<bind nodeset="/data/f_client/hh_member_education_lvl" type="select1" required="true()" calculate="member_filter = /data/f_client/member_education_filter or over_5=/data/f_client/over_5_hhm_calc or over_4=/data/f_client/over_4_hhm_calc or member_filter = 2" relevant="../hh_member_education = 'at_school' or ../hh_member_education = 'left_school'"/>`
  The `calculate` payload is a **choice-filter expression mis-mapped into
  the calculate column**: it references bare choices-instance columns
  (`member_filter`, `over_5`, `over_4`) that only resolve inside an
  `<itemset>` predicate — evaluated as a calculate it yields a boolean-ish
  string that is not one of the six valid choices
  (`none/ecd/primary/secondary/tertiary/other`, body 21797-21823).
- The correct pattern exists in the same form two fields up: the
  identification select uses a proper `<itemset>` choices filter
  (`f_client-create.xml:19408`).
- Same defect on the sibling field `hh_member_occupation`
  (`f_client-create.xml:19313`) — fix in the same pass.
- Clean reference bind (proves intended shape) —
  `forms/contact/e_household-create.xml:21444`: the child
  `education_level` is a required select1 with `relevant` and **no**
  `calculate`.

## Requirements

- Remove the spurious `calculate` from `hh_member_education_lvl` and
  `hh_member_occupation` in the XLSForm source (survey sheet), then
  regenerate the XML. If a choices filter was actually intended, express it
  as an `<itemset>` choice_filter (as at :19408), never as a bind
  `calculate`.

## Acceptance Criteria

- A CHP's education/occupation selection is stored exactly as selected, for
  every choice value.
- The fields remain required and gated by their existing `relevant`
  (`at_school`/`left_school` path) — no regression.
- No other binds in the form change.

## Constraints

- Surgical: attribute removal (or itemset-filter relocation) only.
- Pipeline note: contact form (`forms/contact/`) — same contact-form
  extension caveat as the M7 ticket for running the full closed loop.
