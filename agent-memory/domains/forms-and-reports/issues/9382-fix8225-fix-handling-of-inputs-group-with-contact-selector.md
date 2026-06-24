---
id: cht-core-8225
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 8225
issueUrl: https://github.com/medic/cht-core/issues/8225
title: Fix db-object-widget contact selector by patching Enketo so the `inputs` group is always relevant
lastUpdated: '2026-06-23'
summary: When a form's `inputs` group was configured to never be relevant, the db-object-widget's contact selector could not load contact data into its sub-groups and dependent calculations/widgets broke. The CHT enketo-core patch was updated so the `inputs` group can never be set to non-relevant, keeping its calculations and widgets working even when the inputs fields are not shown.
services:
  - webapp
techStack:
  - javascript
  - enketo
  - xform
  - xlsform
  - webdriverio
tags:
  - form-relevance
  - inputs-group
  - db-object-widget
  - contact-selector
  - enketo-patch
  - patch-package
related_workflows:
  - form-submission
  - ui-extensions
source_pr: medic/cht-core#9382
source_sha: 9d1314a752836feb1b936839d9a3390a2573b456
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/patches/enketo-core+7.2.5.patch
  - tests/e2e/default/enketo/db-object-widget.wdio-spec.js
  - tests/e2e/default/enketo/forms/db-object-widget.xml
concepts:
  - Enketo relevance evaluation
  - inputs group
  - form calculations and widget dependencies on hidden/non-displayed fields
  - patch-package overrides for vendored enketo-core
related_issues: []
stale: false
---

## Problem

If a form's `inputs` group was set to never be relevant (e.g. relevant `./source = 'user'` evaluating false), the `select-contact` feature of the db-object-widget could not load contact data into a sub-group of `inputs`. More broadly, calculations, widgets, and other logic depending on `inputs` fields stopped working whenever the `inputs` fields were not shown in the form.

## Root Cause

Enketo's relevance logic permitted the `inputs` group to be marked non-relevant. Once non-relevant, the fields inside it (including contact data loaded via the db-object-widget) were not processed/available, so calculations and widgets that depend on `inputs` failed — even though CHT relies on `inputs` data always being available regardless of whether those fields are displayed.

## Solution

Updated the CHT patch to enketo-core (webapp/patches/enketo-core+7.2.5.patch) so the `inputs` group can never be set to non-relevant. This guarantees that calculations, widgets, and contact-data loading involving `inputs` always work as expected even when the inputs fields are hidden in the form.

## Code Patterns

Special-case the `inputs` group in Enketo's relevance evaluation to keep it always relevant; deliver the behavior change by editing the vendored dependency patch (webapp/patches/enketo-core+7.2.5.patch) applied via patch-package rather than changing form configs or the widget code.

## Design Choices

Patched the form-engine relevance logic to treat `inputs` as always-relevant, consistent with CHT's assumption that inputs data is always present, rather than forcing every form configuration to keep `inputs` relevant (which would break existing forms that hide inputs) or reworking the db-object-widget itself. Main risk acknowledged: a core Enketo patch could affect unrelated Enketo behavior, mitigated by expanded e2e coverage and manual testing.

## Related Files

- webapp/patches/enketo-core+7.2.5.patch
- tests/e2e/default/enketo/db-object-widget.wdio-spec.js
- tests/e2e/default/enketo/forms/db-object-form.xlsx
- tests/e2e/default/enketo/forms/db-object-form.xml
- tests/e2e/default/enketo/forms/db-object-widget.xml
- tests/e2e/default/enketo/pregnancy-complete-a-delivery.wdio-spec.js

## Testing

Expanded the db-object-widget e2e spec to cover using the widget to load contact data inside the `inputs` group, with updated form fixtures (db-object-form.xlsx/.xml, db-object-widget.xml). Updated pregnancy-complete-a-delivery.wdio-spec.js and confirmed existing Enketo e2e tests still pass. Manual testing of workflows that pass `inputs` to forms (e.g. forms triggered from tasks); a reviewer verified a pregnancy with danger signs triggering follow-up, ANC reminder, delivery, and postnatal tasks.

## Related Issues

- #8225: A never-relevant `inputs` group prevents the db-object-widget select-contact feature from loading contact data into an inputs sub-group

## Domain Rationale

**Fit:** strong

The change patches the Enketo form engine's relevance logic for the `inputs` group and fixes how the db-object-widget contact selector populates form fields — squarely form-rendering/behavior, not contact management or app config.
