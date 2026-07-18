# Deliverable A — PR package: postnatal_care_service next-PNC-visit-date fix

Target repo: `github.com/moh-kenya/config-echis-2.0` (per the partner README
carried in the working copy; branches `training`/`staging`/`main` — confirm
the partner's intake branch before opening). The local
`~/ai_medic/config-echis-2-0-main` is a zip download (no `.git`) — start from
a fresh clone or your fork.

## The three files (the deliverable artifacts)

All live in the demo working copy `~/ai_medic/medic-cht-agent/demo-conf` after
the successful closed-loop run:

1. `forms/app/postnatal_care_service.xlsx` — the **source-of-truth fix**: the
   `next_pnc_visit_date` survey row gains
   `relevant = ${has_delivered}='yes'`.
2. `forms/app/postnatal_care_service.xml` — regenerated from the corrected
   xlsx by the deployment-pinned cht-conf 3.21.4 (`convert-app-forms`), so
   reviewers see exactly what will deploy.
3. `test/forms/postnatal_care_service.spec.js` — a `cht-conf-test-harness`
   regression spec in the repo's own house pattern: fails against the pre-fix
   form, passes against the fixed one; runs in their existing
   `npm run test-unit` suite.

## Operator steps

```bash
# 1. clone (or your fork) + branch
git clone git@github.com:moh-kenya/config-echis-2.0.git ~/src/config-echis-2.0
cd ~/src/config-echis-2.0
git checkout <intake-branch>            # training / staging — per partner process
git checkout -b fix/pnc-next-visit-date-relevant

# 2. copy the three artifacts from the demo working copy
D=~/ai_medic/medic-cht-agent/demo-conf
cp $D/forms/app/postnatal_care_service.xlsx forms/app/
cp $D/forms/app/postnatal_care_service.xml  forms/app/
cp $D/test/forms/postnatal_care_service.spec.js test/forms/

# 3. sanity: their own gate (needs their npm ci; harness needs Chromium + xsltproc)
npm ci && npm run test-unit -- 2>&1 | tail -5   # or at minimum:
npx mocha test/forms/postnatal_care_service.spec.js

# 4. commit + push + PR
git add forms/app/postnatal_care_service.xlsx forms/app/postnatal_care_service.xml \
        test/forms/postnatal_care_service.spec.js
git commit -m "fix(pnc): gate next_pnc_visit_date on has_delivered='yes' so ended pregnancies stop prompting"
git push -u origin fix/pnc-next-visit-date-relevant
gh pr create --base <intake-branch> --title \
  "Fix: PNC form keeps demanding a next-visit date on every follow-up (incl. after miscarriage)" \
  --body-file PR-BODY.md
```

## PR description (save as `PR-BODY.md`)

```markdown
## The bug

The `next_pnc_visit_date` question in `postnatal_care_service` has **no
`relevant` expression** and is `required`, so it is demanded on **every**
visit that reaches the "Mother PNC Danger Signs" page — most painfully on
follow-up visits, where CHWs must invent a future postnatal appointment to
be allowed to save the visit at all, including when the reason for the visit
is that the woman's pregnancy has ended (miscarriage). There is no path to
close out: each follow-up demands scheduling another postnatal visit,
indefinitely.

Deployed bind (before):

    <bind nodeset="/postnatal_care_service/group_mother_pnc_danger_signs/next_pnc_visit_date"
          type="date" constraint="..." jr:constraintMsg="Date cannot be in the past"
          required="true()"/>        <!-- no relevant= -->

## How we identified and reproduced it

Reconstructed the live config on a throwaway CHT 4.21.1 instance (read-only
`backup-app-settings`/`backup-all-forms`; dummy data only) and reproduced at
three levels:

1. **Content**: `GET /api/v1/forms/postnatal_care_service.xml` shows the bind
   above with no `relevant` gate — while every delivery-detail sibling
   (`group_pnc_visit`, `group_delivery_outcome`) is correctly gated on
   `has_delivered='yes'`.
2. **In the browser, as a CHW**: record a delivery (Visit 1) → the standard
   PNC follow-up task series appears (task rules key off
   `date_of_delivery` +1/+2/+3/+7) → open any follow-up task (Visit 2) →
   the form demands "Enter next PNC visit date" and refuses to advance
   without it.
3. **The entered date goes nowhere**: the report dutifully stores
   `Needs subsequent visit: true` / `Subsequent visit date: <date>` — and no
   task or reminder is ever generated from it. We verified by grep that none
   of its derived fields (`needs_subsequent_visit`, `subsequent_visit_date`,
   `missed_home_visit_date`) has any consumer in `tasks.js`, `targets.js`,
   or contact-summary. The field is mandatory data entry with no effect.

## The fix

Gate the question the same way its siblings are gated — in the **XLSForm
source** (`survey` sheet, `relevant` column):

    ${has_delivered} = 'yes'

compiled: `relevant=" /postnatal_care_service/group_pregnancy_status/has_delivered ='yes'"`.
The question still appears on the visit that records a live delivery (where
transcribing the MCH booklet's next appointment is meaningful) and stops
being demanded on follow-ups. The regenerated XML is included; conversion was
done with the repo-pinned cht-conf 3.21.4. **Exactly one bind changes** —
verified by a canonicalized whole-document diff of the compiled form (every
other bind, body and itext line is unchanged).

## Verification

- Red→green against a live test instance: pre-fix the deployed bind fails
  the expectation (`relevant` absent); post-upload all bind assertions pass
  and the deployed XML is canonically identical to the compiled fix.
- `test/forms/postnatal_care_service.spec.js` (included) loads the compiled
  form in `cht-conf-test-harness` (real Enketo) and asserts the gated bind —
  it fails on the pre-fix form and passes on this branch; it runs in the
  existing `test/**/*.spec.js` mocha suite.
- Manual UI walkthrough: follow-up visits save without a date; the
  delivery-recording flow still shows the question; the follow-up **task
  series is unaffected** (it is generated from the delivery date, not from
  this field).

## Two follow-up decisions for the config owners (not blockers)

1. **Optional booklet capture on follow-ups.** Post-fix, follow-up visits no
   longer offer the next-facility-appointment field at all. Nothing in this
   config consumes it, but if downstream analytics (e.g. dbt models over raw
   report fields) want it, consider re-adding it on follow-ups as
   **optional** (non-required) rather than gated off — a one-line `relevant`/
   `required` change.
2. **Dead scheduling lever.** `has_pnc_up_to_date` is hard-disabled
   (`relevant="false()"`) while its downstream task rule
   (`needs_pnc_update_follow_up` in `tasks.js`) still exists — that leg is
   currently unreachable dead code. Either re-enable the question or retire
   the rule.
```

## Notes for the operator

- The demo working copy also contains agent scaffolding that must NOT ride
  the PR: `.cht-agent/` (excluded from writes by design — verify), and any
  `tests/` (plural) directory from early runs. The three files above are the
  complete change.
- If the partner process requires XLSForm-only PRs (CI converts), drop the
  `.xml` from the commit and say so in the description — the included XML is
  then illustrative.
- The spec's harness launch args include `--no-sandbox` (needed in hardened
  containers; harmless on CI/dev machines). Harness 3.x `loadForm`
  additionally needs the `xsltproc` binary on the machine running the suite.
