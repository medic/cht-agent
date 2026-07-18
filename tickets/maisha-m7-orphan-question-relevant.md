---
title: "Child registration asks orphan status even after both parents' details are captured"
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

When registering household information, the child section asks whether a
child is an orphan even when both parents' details have already been
captured in the same form. CHPs experience this as an unnecessary and
contradictory question.

## Technical Context

- The `is_orphan` question is gated **only on age**, ignoring the
  parent-status fields captured earlier in the same forms:
  - `forms/contact/e_household-create.xml:21441` (the household child
    section — the reported surface):
    `<bind nodeset="/data/repeat/child/is_orphan" type="select1" relevant="../age_in_years_member &lt; 18" required="true()"/>`
  - `forms/contact/f_client-create.xml:19317` (individual client
    registration — same defect):
    `<bind nodeset="/data/f_client/is_orphan" type="select1" required="true()" relevant=" /data/f_client/age_in_years  &lt; 18"/>`
- The parent-status signals that should participate in the gate exist in
  the same forms:
  - `e_household-create.xml:21329-21330`: `father_alive` / `mother_alive`
    (required select1s).
  - `f_client-create.xml:19314`: `hh_member_caregiver` multi-select with
    `mother`/`father` options.
- A third copy of the age-only gate exists in
  `forms/app/household_member_registration_reminder.xml:692` (reminder
  form) — fix for consistency.

## Requirements

- Extend the `is_orphan` `relevant` (XLSForm source `survey` sheet, then
  regenerate with `cht convert-contact-forms`/`convert-app-forms` as
  applicable) so the question is skipped when the already-captured parent
  status makes it redundant:
  - `e_household-create`: age gate AND NOT (both `father_alive` and
    `mother_alive` answered alive).
  - `f_client-create`: age gate AND NOT (`hh_member_caregiver` includes
    both `mother` and `father`).

## Acceptance Criteria

- With both parents recorded (alive / both caregivers selected), the orphan
  question is not shown.
- With parent status unknown, incomplete, or a parent recorded deceased,
  the orphan question still appears for under-18s (no regression).
- No other question or group in the affected forms changes.

## Constraints

- Keep the change surgical: only the `is_orphan` `relevant` expressions
  change, in the XLSForm sources, regenerated to XML.
- Pipeline note: these are **contact forms** (`forms/contact/`); the
  Mission-05 apply/verify machinery currently targets `forms/app/` app
  forms (`configArtifact: form`) — running this ticket through the full
  closed loop needs the small contact-form extension (artifact paths +
  `contact-forms` QA bucket + verify oracle), otherwise treat dev output as
  a manual-apply change.
