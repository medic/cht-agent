---
title: "Pregnancy home visit keeps prompting danger-sign questions after a miscarriage is recorded"
type: bug
priority: high
domain: forms-and-reports
layer: cht-conf
configArtifact: form
artifactName: pregnancy_home_visit
chtConfVersion: "6.5.0"
deploymentRef: "demo/config-pnc-demo"
---

## Description

When a CHW completes a **Pregnancy home visit** and records the pregnancy as ended
(`Pregnancy status` = "No, Miscarriage"), the form still shows the **Danger Signs**
question group and keeps asking about vaginal bleeding, fever, and other ongoing-pregnancy
danger signs. Those questions are clinically irrelevant once the pregnancy has ended in a
miscarriage, and CHWs report that the form "keeps prompting after a miscarriage is
recorded." The Danger Signs group should only appear while the pregnancy is continuing
(`visit_option` = "yes"); it must be skipped for the miscarriage / abortion outcomes, the
same way the sibling "Safe pregnancy practices" and "Summary" groups are skipped.

## Technical Context

The Danger Signs group's `relevant` was widened so it no longer excludes the miscarriage
outcome. The affected artifacts in the deployment config are:

- `forms/app/pregnancy_home_visit.xlsx`
- `forms/app/pregnancy_home_visit.xml`

The controlling field is `pregnancy_summary/visit_option` (a `select_one visit_options`
whose choices include `yes`, `miscarriage`, `abortion`, `refused`, `migrated`). The
`danger_signs` group must be gated to the `yes` (pregnancy-continuing) case only.

**Existing References:**
- The sibling groups `safe_pregnancy_practices` and `summary` still use the correct gate `selected(../pregnancy_summary/visit_option, 'yes')` and can be used as the reference pattern.
- The `pregnancy_ended` group uses `not(selected(../pregnancy_summary/visit_option, 'yes'))` to drive the miscarriage/abortion follow-up notes.

## Steps to Reproduce

1. Open the Pregnancy home visit form for a pregnant woman.
2. On the pregnancy summary screen, set the visit outcome to "No, Miscarriage".
3. Continue through the form.
4. Observe that the Danger Signs group still appears and requires danger-sign answers.

## Requirements

- The `danger_signs` group in `pregnancy_home_visit` must not be shown when `visit_option` is `miscarriage` (or any non-`yes` outcome).
- Fix the `relevant` expression in the xlsx source (`survey` sheet, `danger_signs` begin-group row, `relevant` column) so it reads `selected(../pregnancy_summary/visit_option, 'yes')`.
- Regenerate `pregnancy_home_visit.xml` from the corrected xlsx with `cht convert-app-forms` so the shipped XML matches the source.

## Acceptance Criteria

- Recording a miscarriage on the Pregnancy home visit no longer displays the Danger Signs group.
- Recording an ongoing pregnancy (`yes`) still displays the Danger Signs group as before.
- The `danger_signs` bind's `relevant` in the regenerated XML is exactly `selected(../pregnancy_summary/visit_option, 'yes')`.
- The sibling groups `safe_pregnancy_practices` and `summary` are unchanged.

## Constraints

- The bug's source of truth is the xlsx; `cht convert-app-forms` regenerates the XML from it, so the xlsx must be corrected (do not hand-edit only the XML).
- Keep the change surgical: only the `danger_signs` group's `relevant` should change.

## References

**Documentation:**
- [Pyxform / XLSForm relevant column](https://docs.getodk.org/form-logic/#relevant)
- [cht-conf convert-app-forms](https://github.com/medic/cht-conf)
