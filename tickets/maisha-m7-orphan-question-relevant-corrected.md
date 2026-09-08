---
title: "Child registration asks orphan status even when both parents are the recorded caregivers (corrected prescription)"
type: bug
priority: medium
domain: contacts
layer: cht-conf
configArtifact: contact-form
artifactName: e_household-create
chtConfVersion: "3.21.4"
deploymentRef: "/workspace/cht-conf-project"
---

## Description

When registering household members, the child section asks whether a child
is an orphan even when the same repeat entry has already recorded BOTH
parents as the child's caregivers. CHPs experience this as an unnecessary
and contradictory question.

CORRECTED PRESCRIPTION (2026-09-03): the original ticket prescribed gating
on `father_alive`/`mother_alive` — but those fields live at `/data/init`
and describe the HOUSEHOLD HEAD's parents, asked only when the head is 18
or younger. For the common adult-headed household they are empty, so a
gate built on them never fires (a structural no-op). The per-child signal
that actually exists in the repeat entry is `hh_member_caregiver`.

## Technical Context

- The `is_orphan` question is gated **only on age**:
  `forms/contact/e_household-create.xml` (compiled from
  `forms/contact/e_household-create.xlsx`):
  `<bind nodeset="/data/repeat/child/is_orphan" type="select1" required="true()" relevant="../age_in_years_member &lt; 18"/>`
- The per-child caregiver signal exists in the SAME repeat entry:
  `hh_member_caregiver` — a select_multiple whose choices include
  `mother` and `father`.
- Do NOT use `/data/init/father_alive` or `/data/init/mother_alive` — they
  are household-head-scoped (relevant only when
  `hh_head_age_in_years <= 18`) and empty in the common case.

## Requirements

- Extend the `is_orphan` `relevant` in the `e_household-create` XLSForm
  survey sheet (then regenerate the XML with `cht convert-contact-forms`)
  so the question is skipped ONLY when both parents are recorded as the
  child's caregivers:
  `../age_in_years_member < 18 and not(selected(../hh_member_caregiver, 'mother') and selected(../hh_member_caregiver, 'father'))`

## Acceptance Criteria

- A child whose `hh_member_caregiver` selection includes BOTH `mother` and
  `father` does not see the orphan question.
- A child with any other caregiver state — one parent, neither, other
  relatives, or the caregiver question unanswered/not shown — still sees
  the orphan question when under 18 (an empty selection must behave as
  "still ask": `selected()` on an empty node is false, so the gate must
  rely on that and never invert it).
- No other question or group in the form changes.

## Constraints

- Keep the change surgical: only the `is_orphan` `relevant` expression
  changes, in the XLSForm source, regenerated to XML.
- Sibling surfaces (`f_client-create`, the reminder app form) are
  deliberately out of scope for this pass — the original ticket's
  `f_client-create` prescription (caregiver-based) was already correct and
  rides a separate pass.
