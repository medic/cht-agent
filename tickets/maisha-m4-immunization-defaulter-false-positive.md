---
title: "Fully-immunized children incorrectly flagged for immunization defaulter tracing"
type: bug
priority: high
domain: tasks-and-targets
layer: cht-conf
configArtifact: contact-summary
artifactName: is_immunization_defaulter
chtConfVersion: "3.21.4"
deploymentRef: "/workspace/cht-conf-project"
qaSpecs:
  - test/contact-summary.spec.js
  - test/tasks/defaulter_follow_up.spec.js
  - test/tasks/immunization_service.spec.js
---

## Description

Children who have completed their full immunization schedule are sometimes
flagged for defaulter tracing, generating unnecessary follow-up visits for
CHPs and eroding trust in the task list.

## Technical Context

- The defaulter flag is computed **two different ways** in the config, and
  the wrong one drives the newborn path:
  - **Broken (length inequality)** — `contact-summary.templated.js:175` and
    its mirror `tasks.js:1329`:
    `getVaccinesReceived(reports).requiredVaccines.length !== countTotalVaccinesByAge(contact) ? 'yes' : 'no'`.
    This compares the COUNT of distinct vaccine tokens actually recorded
    (`common-extras.js:215-289`) against an age-banded EXPECTED integer
    (`common-extras.js:172-198`). Any divergence — extra optional doses,
    yellow-fever counting differences, doses ahead of schedule — flags
    `yes`, including for fully/over-immunized children.
  - **Correct (coverage test)** — `contact-summary.templated.js:458-460`
    already uses `vaccinesNotReceivedByAge(contact, reports).length > 0`
    (every DUE vaccine present ⇒ not a defaulter), and
    `isFullyImmunized` (`contact-summary-extras.js:375-380`) proves the
    intended semantics with an `every(...includes...)` coverage test.
- Downstream: `postnatal_care_service_newborn.xml:558/:595` consumes the
  flag and opens the defaulter follow-up branch when it is `yes`.
- Related dead code worth removing in the same pass: `tasks.js:1007` keys a
  referral follow-up on `immunization_screening.imm_schedule_upto_date`,
  a field that does not exist in `u5_assessment.xml` — that `appliesIf` can
  never be true.

## Requirements

- Replace the length-inequality test at `contact-summary.templated.js:175`
  and `tasks.js:1329` with the coverage-based predicate already used at
  `contact-summary.templated.js:458-460`
  (`vaccinesNotReceivedByAge(contact, reports).length > 0`).
- RE-KEY (do not retire) the unreachable `imm_schedule_upto_date` predicate
  (`tasks.js` ~1004, the `immunization_referral_follow_up` task): change its
  `appliesIf` to read the field the u5_assessment form actually emits —
  `immunization_screening.immunization_upto_date === 'no'`. The referenced
  `imm_schedule_upto_date` node exists nowhere in the config; the field name
  is a typo-class defect, not dead code.
  CONFIG-OWNER CALL, stated explicitly: whether this task should exist at
  all remains the config owners' decision — surface it in the PR. But the
  updated upstream config REGISTERED this task (a `data/tasks.json` key and
  a shipped translation), signalling intent to keep it, and the open-ended
  "retire vs re-key" wording has previously caused automated runs to retire
  it — which would now delete a feature the partner just added. This ticket
  therefore prescribes re-keying; owners can veto in review.

## Acceptance Criteria

- A child whose received vaccines cover every age-due vaccine is NOT flagged
  (`is_immunization_defaulter = 'no'`), including when extra/optional doses
  are recorded.
- A child genuinely missing an age-due vaccine IS still flagged (no
  regression in true defaulter detection).
- The newborn PNC form's defaulter branch opens only for true defaulters.

## Constraints

- Surgical: predicate replacement only; do not change vaccine schedules,
  `countTotalVaccinesByAge`, or form logic.
- Regression surface: the partner repo's `test/contact-summary.spec.js` and
  `test/targets/` immunization specs must stay green; add a case for the
  over-immunized child.
