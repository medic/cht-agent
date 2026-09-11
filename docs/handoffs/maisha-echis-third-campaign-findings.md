# Maisha demo re-run — findings for the cht-agent team

**Date:** 2026-09-11 · **Operator:** sugat · **Config:** eCHIS updated release (handover export, 2026-09-03) · **Stack:** CHT 5.3.0 · **Pipeline:** `cht-agent` @
`fix/pipeline-hardening` `089e8a3` · **cht-conf:** 3.21.4 (`v3-21-4-with-830`)

Scope: full §1 setup from cold, then all five tickets — M3 (1 run), M4 (4), M5 (1),
M7 as-written (1), M8 (1). Eight runs, five bundles. `m7-corrected-caregiver` was
deliberately not run: its prescription is also clinically wrong (see the M7 report) and it
is a user-visible change, which the config owner ruled out of scope.

Everything below was observed live and verified against the tree or the running instance.
Where a claim rests on a single observation it says so.

**Review status:** every factual claim in this document was independently re-derived by four
adversarial checkers against the live tree and containers. 31 confirmed; 5 were wrong, 7
imprecise and 2 unproven, and all have been corrected here — including the original §1.1,
whose *cause* was refuted outright. Where a correction overturned an earlier draft the
document says so explicitly rather than quietly fixing it.

---

## 1. Pipeline findings

Ranked by how much damage they do on an unattended run.

### 1.1 The dev-phase reviewer reasons from cht-core's config, not the deployment's

**Severity: high — produces confident, false, blocking objections to correct fixes.**

On M3 the reviewer emitted four DEFERRED/blocking "correctness defects" against a fix that
was correct. Three of them (`m3/PR.md` :63, :65, :69) share one root cause: the reviewer
read **cht-core's** `config/default/nools-extras.js:21`, where
`isFormArraySubmittedInWindow(reports, formArray, start, end, count)` takes five parameters
and has no source id — and concluded the appended `r._id` was inert.

But `tasks.js:38` does `require('./nools-extras')`, resolving to the mounted deployment's
own file, whose signature is
`(reports, formArray, dueDate, event, count, sourceID)` and whose body implements
`if (sourceID) { if (Utils.getField(report,'inputs.source_id') === sourceID) ... }`.
Verified live: `require.resolve('./nools-extras', {paths:['/workspace/cht-conf-project']})`
→ `/workspace/cht-conf-project/nools-extras.js`.

The fourth item (:67) is a separate, also-unfounded scope objection ("only one resolvedIf
line was modified") — the adjacent the adjacent referral template already passes `report._id` as
`sourceID`.

**How the reviewer reached cht-core's file is not established.** An earlier draft of this
document blamed `CANONICAL_CONF`. That was wrong, and the disproof is worth recording so
nobody re-opens it:

- `CANONICAL_CONF` defaults to `/workspace/cht-core/config/standard`, which contains **only**
  `readme.md` ("The `standard` config is no longer available") — no JS whatsoever.
- Its only consumer is `src/utils/canonical-diff.ts`; for a `task` ticket its candidate path
  list is `['tasks.js']` alone. It never opens `nools-extras.js` under any root.
- Executed against the live container, `diffAgainstCanonical({artifact:'task', ...})` returns
  `status: missing-in-canonical`, `summary: "tasks.js is a deployment-specific artifact with
  no canonical counterpart"`, and no diff body. That single summary line is all that reaches
  any prompt.

The likelier vector is simply that `/workspace/cht-core` is mounted read-write and the
reviewer prompt is framed in cht-core terms (`src/layers/code-gen/lib/prompts.ts:27`, `:358`),
so the reviewer browses there. **That needs confirming by someone who knows the code** —
we could not identify it from outside.

**Impact unattended:** these objections ship into PR.md as recorded blocking defects. A
reviewer reading that PR would reasonably conclude the fix is broken.

**Suggested fix:** not a `CANONICAL_CONF` change — that would leave this untouched and would
make the canonical diff compare the deployment against itself. Instead, constrain the
reviewer's file access to the artifact under review, or state the deployment config's path in
the reviewer prompt and require that `require()` targets be resolved relative to the file
being reviewed.

### 1.2 Generated specs invent harness APIs, and `TEST_GEN_VERIFY` is off by default

**Severity: high — the generated specs are the thing tier-2 then fails on.**

Two M4 runs produced specs that fail out of the box:

- **attempt 2** (specs preserved at tag `m4-salvaged-attempt1`): 6 failures against the fixed
  tree — 3× `TypeError: harness.pushMockedReport is not a function` (`pushMockedReport`
  appears **0** times in `cht-conf-test-harness/src/harness.js`; `pushMockedDoc` appears 6),
  plus 3 assertion failures from fixtures that never match the config.
  `test/contact-summary.agent.spec.js` fails **identically with and without the fix** — it is
  red→red, so it proves nothing even when it runs.
- **attempt 4**: `Error: Cannot find module './harness'` (the partner's own specs use
  `require('cht-conf-test-harness')`). *Single observation — the spec artefacts and log were
  not retained.*

- **M3's spec (which SHIPPED)**: `value == null` — an `eqeqeq` violation against the
  partner's own eslint config. `npm test` is fail-fast (`eslint && compile-app-settings &&
  validate-forms && test-unit`), so applying that bundle as delivered killed the partner's
  entire suite in **two seconds**, before a single test ran. Found only by running §4's
  full-suite regression check; tier-2 had reported 9 passing.

So there are three distinct defect classes, not one: invented APIs, fixtures that were never
executed, **and specs that pass mocha but violate the project's lint config**. `TEST_GEN_VERIFY=1` exists precisely to prove generated specs red→green and
drop the unproven ones — it is opt-in and off.

**Suggested fix:** default `TEST_GEN_VERIFY=1` on for `--qa-tier2` runs, **and** lint
generated specs against the project's own eslint config before shipping them.

Neither measure alone is sufficient, and this is worth being precise about:
- A smoke-require would not catch attempt 2's specs — they import cleanly and still fail, and
  one is red→red.
- `TEST_GEN_VERIFY` would not catch M3's — it proves specs red→green through mocha; it does
  not lint them.
- Only running the partner's own `npm test` (or at least its eslint stage over `test/**`)
  catches the M3 class. **No gate in the pipeline runs it.** Tier-2 invokes mocha directly;
  the compiled-settings gate lints only the webpack contact-summary build.

### 1.3 Tier-2 measures a smaller baseline than the post-fix run and reports the gap as regression

**Severity: high — turns 1.2 into a false regression report.**

The post-fix run executes 5 specs; the baseline can only execute the 3 that exist in
`HEAD`:

```
[tier-2] mocha <3 partner specs> <2 generated specs>   (cwd=/workspace/cht-conf-project)
fatal: path 'test/contact-summary.agent.spec.js' exists on disk, but not in 'HEAD'
[tier-2] baseline: mocha <3 partner specs>             (sandbox=/tmp/...)
```

It then prints **"tier-2 baseline: pre-fix specs PASSED — every failure below is new in
this change"** and reports `tier-2 FAILED`. The failures are in the two specs the baseline
structurally cannot run.

Verified by running the partner's three pinned specs directly against the fixed tree:
**130 passing / 0 failing**, on both M4 attempt 2 and attempt 4.

**Suggested fix:** compare only the specs present in both runs, and report
generated-spec failures in their own category.

### 1.4 The dev-phase CLI call has no read timeout

**Severity: medium-high — silently consumes a whole run.**

M4 attempt 3: the host suspended (`PM: suspend entry (deep)` 11:23:45 →
`PM: suspend exit` 12:26:09). On resume the dev-phase `claude -p` was still blocked on a
dead socket. Observed state: process alive 71 minutes, **0 bytes stdout**, container CPU
**0.39%**, while a fresh `claude -p` in the same container returned `ok` immediately. The
progress line kept ticking (`Still running... 4219s elapsed`), so it looked like work.

Test-gen caps at 600 s and retries; the dev call has no equivalent.

**Suggested fix:** give the dev-phase call the same timeout-and-retry treatment as
test-gen. A suspend-induced hang would then cost one retry rather than a run.

### 1.5 Correct blocking recommendations are recorded but not applied — and one killed a run

**Severity: medium.**

M4 attempt 1 died at the compiled-settings gate:

```
❌ compileSettingsOffline: compile-app-settings exited with code 1
   ERROR Webpack errors when building contact-summary
```

Cause: after the predicate swap, `getVaccinesReceived` and `countTotalVaccinesByAge` were
unreferenced in `contact-summary.templated.js` but still imported.
`compile-app-settings` runs eslint inside the webpack contact-summary build and
`no-unused-vars` is an error.

The pipeline had already diagnosed this *before* HC2 — a DEFERRED/blocking item said
exactly "Remove them from the respective destructuring imports" — but the log also says
`automatic recommendation-driven refinement is off`, so it was recorded rather than
applied. The run died on it one phase later.

**Suggested fix:** auto-apply the mechanical, compile-blocking subset (unused imports and
similar), or at minimum promote them above the HC2 diff rather than burying them in a
deferred list.

### 1.6 Test-gen 600 s cap vs a 97 k-character prompt at `max` effort

**Severity: medium — wall-clock only.**

`test/tasks/immunization_service.agent.spec.js` needed 3 attempts on one run and 2 on
another; ~50 minutes across two runs for one file. Observed prompt size 97,169 chars,
`maxTurns=20`, exit `code=143` (SIGTERM at the cap). Compose defaults
`CLAUDE_CODE_EFFORT_LEVEL=max`.

**Suggested fix:** scale the timeout with prompt size, or lower the default effort for
test-gen specifically.

### 1.7 The HC4 retry path leads into the non-reproduction trap

**Severity: medium — documented in the runbook, but the UI walks you into it.**

After a tier-2 failure, HC4 offers "Retry development with this QA feedback?". Answering
yes re-runs dev — but QA has already applied the fix to the live instance, so the next
QA pass cannot reproduce RED and aborts with *"symptom did not reproduce … this run proves
nothing about the fix"*. Observed on M4 attempts 2 and 4.

Measured on attempt 4 after the retry started: mount `contact_summary` sha
`8a89d74b9f321f87` (= baseline), deployed sha `7045541f7fc557e1` (= fixed). The working
tree had been rolled back; the instance had not.

**Suggested fix:** don't offer the retry when the fix is already applied, or roll the
instance back with the tree.

### 1.8 The "generated specs outside pinned qaSpecs" warning is stale and should be deleted

Minor, but it misleads. Test-gen warns *"tier-2 QA will NOT run them"* — then tier-2 runs
them anyway: `findTier2Specs` (`src/utils/cht-conf-tier2.ts:195-211`) unions this run's
`*.agent.spec.js` files into the pinned selection. The warning's own doc comment
(`spec-inventory.ts:421-425`) still cites the pre-union behaviour as "verified".

It is stale rather than merely early — delete or invert it rather than resequencing. It
remains accurate only for a generated spec rejected at HC2, or one not named `*.agent.spec.js`.
The emitting code path is unconditional (`spec-inventory.ts:431-433`); we saw it on every run
we observed, though no logs were retained to count them. It caused me to give the operator
wrong advice once.

### 1.9 The XLSForm path outranks its reviewer — good for mechanics, bad for domain

**Severity: high — this is the finding I would lead with.**

An earlier draft of this document recorded "the XLSForm path subordinates the reviewer to the
deterministic apply" as a **strength**, based on M5. The M7 run disproved that as a general
claim, and the correction is the most important result of the campaign.

On this path the supervisor prints *"blocking — the deterministic XLSForm apply owns the
verdict on this path"*, and reviewer objections are recorded rather than acted on.

- **On M5 that was right.** The single deferred item was a whitespace-coupling nitpick about
  the generated spec. Machine evidence genuinely superseded it.
- **On M7 as-written it was wrong.** The reviewer independently derived, from the original
  (incorrect) ticket, that `father_alive`/`mother_alive` describe the *household head's*
  parents, are asked only when `hh_head_age_in_years <= 18`, and that gating every member's
  orphan question on them *"can wrongly suppress it (false negative)"*. That is exactly right,
  and it is the reason the ticket should not have been implemented as written.

It was deferred. The run then passed every gate:

```
RED reproduced — 1 of 3 bind assertions failed (/data/repeat/child/is_orphan)
RED oracle     — deployed differs from local ONLY at the target bind
GREEN verified — all 3 bind assertions passed
GREEN oracle   — deployed is canonically identical to local
rev changed    — 2-022f3b8c… → 3-9bf6b497…
tier-2         — 2 passing
Result: PASSED WITH CAVEATS
```

The caveat named in the headline is *scope* (two sibling sites unverified), not the clinical
defect. The clinical objection appears once, as item 3 of 3 in a deferred checklist below the
green result.

**The structural gap:** the deterministic apply can prove the attribute changed *as
described*. It has no view on whether the change *means* anything clinically — and the only
component that does is outranked by policy. So a run can go fully green carrying a change its
own reviewer identified as harmful.

Worth noting the emitted expression is the **worse** of the two spellings: it compiled to the
absolute `/data/init/father_alive`, so for a child-headed household — the one case where those
fields are populated — it will actively suppress the orphan question for every child based on
the head's parents' status.

**Suggested fix:** distinguish reviewer objections about *mechanics* (which the apply can
supersede) from objections about *semantics* (which it cannot). A semantic objection should
gate the verdict or at minimum change the headline, not sit below a PASSED banner.

### 1.10 The XLSForm path does get several things right

Recorded as a positive, because these behaviours are absent on the settings path and may be
portable to it:

- **It annotates pre-verdict reviewer claims honestly**: *"written by the PRE-VERDICT reviewer
  (it never saw the apply/QA results above) — superseded by a verified apply"*. On M3 the same
  reviewer produced four unfounded objections with no such caveat and a human had to refute
  them by hand.
- **It declines to generate a spec that would prove nothing**: *"XLSForm fix has no `relevant`
  change — SKIPPING deterministic harness spec generation (the relevant-centric template would
  not distinguish buggy from fixed)"*. Contrast 1.2, where the settings path shipped a spec
  that is red→red.
- **The bind-level and whole-document oracles are precise and trustworthy**: on M5, "deployed
  differs from local ONLY at the target bind" matched an independent measurement made before
  the run (319 binds, exactly one semantic change).

### 1.11 A no-op fix is reported as "XLSForm fix verified" — T4's premise, observed

**Severity: medium — costs a whole run, and the pipeline already has a ticket for it.**

M8's descriptor cleared a `calculation` column that was already empty. The bind diff read:

```
calculate: (absent) → (absent)
relevant:  ../hh_member_education = 'at_school' or … → (identical)
```

and the supervisor reported **"XLSForm fix verified"**. No warning. The run continued for
roughly 50 more minutes before QA aborted at *"symptom did not reproduce"*.

That is precisely the behaviour T4 in `cht-conf-feedback-triage.md` predicts — *"the apply
'verifies' a no-op and the run only fails much later at QA reproduce"* — observed rather than
theorised. T4 is unbuilt.

Two further observations from the same screen:

- **The rationale contradicted its own measurement.** It asserted at length that the education
  row *"also carries a value in the calculation column"* and quoted the expression — from the
  ticket, not from the workbook it had just read. Its own apply reported the attribute absent.
- **It widened scope unprompted**: `"siblingsUnchanged": false`, clearing `hh_member_occupation`
  as well, arguing past the single-bind invariant. Runbook §3.2 flags this as M8's known scope
  trap; it recurred.

---

## 2. Runbook findings (`maisha-demo-full-procedure-v2.md`)

### 2.1 The M5 bug-assertion grep false-negatives on the *pristine* partner XML

§1.5 and §1.11 use:

```bash
grep -o '<bind nodeset="[^"]*next_pnc_visit_date"[^>]*>' forms/app/postnatal_care_service.xml | head -1
```

In the partner's **committed** XML, bind attributes are alphabetised, so the target bind's
`constraint=` precedes `nodeset=` and this anchored pattern returns **zero matches** — while
the bug is present. §1.5 runs this assertion *before* §1.7's canonicalization, so an operator
following the procedure in order hits it, concludes the bug is missing, and may "restore" a
correct file.

Important correction to an earlier draft: this is **not** a property of the pinned converter.
The converter emits `nodeset` first. Once §1.7 regenerates the forms the grep works again
(2 matches, the first being the target), which is why §1.11 passes. The trap lives in the
checked-in XML and disappears on regeneration.

Order-tolerant version, safe at both points: `grep -o '<bind [^>]*next_pnc_visit_date[^>]*>'`.
The M8 grep in the same block is already order-tolerant; M5's is not.

### 2.0 The mirror reachable from the clone step is stale

Correcting an earlier draft: the ticket and §3.5 do **not** misattribute `sourceID` to
nootils. The pipeline-fed ticket names the right helper explicitly
(*"it omits the `sourceID` (6th) argument to `isFormArraySubmittedInWindow` …
(`nools-extras.js:27-34` only dedups when `sourceID` is passed)"*). The nootils
misattribution was made by the **pipeline's reviewer** (see 1.1), not by the ticket or the
runbook.

What is genuinely stale: both cite `tasks.js:1368` for a line that is at **1365**, and the
prose says `report._id` where the closure parameter is `r` (`resolvedIf: function(c, r, event,
dueDate)`). The agent located it by content regardless.

### 2.3 M4's "dead predicate" framing is incomplete in both directions

§3.4 offers "optionally retiring the dead `imm_schedule_upto_date` predicate". §8 says this
flipped to re-key. Both are partly right:

- `imm_schedule_upto_date` exists in **no form** in this config (no XML, `.properties.json`
  or workbook). In source it survives only at `tasks.js:1004` and as an orphaned label key at
  `translations/messages-en.properties:2621` — the last trace that the field once existed.
  The `immunization_referral_follow_up` task has therefore never been able to fire.
- But the re-key target `immunization_upto_date` is a `readonly` display note with no
  `calculate`/`setvalue`, so it never holds `'no'` either. Re-keying to it leaves the task
  just as unreachable.
- Making the task reachable surfaces a card CHPs have never seen — a config-owner decision,
  not a bug fix.
- Caveat on the "it is registered, so they meant to keep it" argument: `data/tasks.json` is
  only a title lookup map (a lookup map in the config), the dead task hardcodes its title rather
  than reading it, and the same title is also emitted by a second, *reachable* task at
  `tasks.js:503`. Neither the entry nor the translation is evidence about this task.

### 2.0 The mirror reachable from the clone step is stale

M3 1368→1365, M4 175→168 and 1329→1326. Expected against an updated config; worth a note
that §3's citations are indicative, and that the agent should locate by content. It did.

### 2.5 No warning about the `CHT_NETWORK` collision — and it silently corrupts a run

**This one cost the most time and is the most dangerous.**

The published compose declares its network as `name: ${CHT_NETWORK:-cht-net}` — fixed and
unprefixed. Any second CHT stack on the same host joins the same network. Both stacks have
services called `couchdb` and `nouveau`, so Docker round-robins DNS between them.

Observed: a pre-existing `local-build` stack was running. My `create-users`, config upload,
hierarchy and cohort seeding all landed in **its** CouchDB, not mine. Every verification
passed, because reads round-robined to the same wrong database. The symptom only surfaced
later, as a browser "Loading error", caused by a **different** cross-wiring: my CouchDB 3.5.2
talking to the other stack's older nouveau, which rejected index creation with
`422 initialPurgeSeq must not be null`.

Confirmation after isolating: CouchDB version reported changed from 3.5.0 to 3.5.2 under the
same image tag — proof the earlier readings came from the other stack.

**§1.11's preflight cannot catch this.** Every check passes against the contaminated instance.

**Suggested runbook fix:** set `CHT_NETWORK=<unique>` in §1.6's `.env`, and add a preflight
assertion that `nouveau` and `couchdb` each resolve to exactly one address:

```bash
docker exec <couchdb> sh -c 'getent hosts nouveau | wc -l'   # must be 1
docker exec <couchdb> sh -c 'getent hosts couchdb | wc -l'   # must be 1
```

### 2.6 A stray host `ANTHROPIC_API_KEY` silently overrides the intended subscription auth

§0.2 and §1.10 describe subscription login. The compose forwards `ANTHROPIC_API_KEY` from the
host as an "optional fallback". If the operator happens to have one exported, the container
authenticates with it and `claude -p` prints `ok` — the §1.11 preflight passes, and the run
silently bills the API instead of the subscription. Worth a preflight assertion that the key
is unset when the subscription path is intended.

### 2.7 The §1.6 zsh word-splitting trap is real and I walked into it

Documented in §1.6, and it still caught me: `$CS down -v` became one command word and failed,
while the next command in the same block ran on regardless — wiping the data directory out
from under six running containers. Worth promoting from a note to a hard "write compose
commands inline in anything scripted".

---

## 3. Run outcomes

| Ticket | Runs | Outcome |
|---|---|---|
| **M3** | 1 | **PASSED**, bundle corrected post-run (shipped spec failed the partner's eslint — see 1.2/3a). RED→GREEN, rev `2-…`→`3-…`, tier-2 9 passing incl. the generated spec. Patch applies clean to the pristine clone. Four deferred items, all unfounded — three from one root cause (1.1), one a separate scope objection. |
| **M4** | 4 | **Fix verified, bundle reconstructed.** RED→GREEN and rev change on attempts 2 and 4; partner suite 130/0 both times. Tier-2 failed both times on generated-spec defects (1.2/1.3). |
| **M5** | 1 | **PASSED, no caveats.** Bind oracle 11/11, whole-document oracle "differs ONLY at the target bind", rev `2-e6cd99e0…`→`3-4b2b318f…`, tier-2 14 passing. Run against a **corrected** ticket (see 5.1). |
| **M7** | 1 (as-written) | **PASSED WITH CAVEATS** — every oracle green on a change its own reviewer called a false-negative risk. See 1.9. `m7-corrected` not run (also clinically wrong; user-visible). |
| **M8** | 1 | **Certified.** `DID NOT PASS — the symptom never reproduced pre-fix … the config was never applied`. Bind assertions passed *pre-fix*: machine confirmation the bug is gone. See 1.11. |

M4's four failures had four **different** causes, none of them the fix being wrong:
compile gate (1.5), session limit, host suspend (1.4), generated-spec defect (1.2).

**The pair worth putting on a slide.** M5 and M7-as-written produced identical machine
verdicts — every oracle green, rev changed, tier-2 passing, Result PASSED — and opposite
clinical outcomes. The only variable was the quality of the ticket going in.

---

## 3a. Full-suite regression check (runbook §4)

Run once for the campaign, without commits — patches applied to the working tree and reset
after.

| | passing | failing |
|---|---|---|
| Baseline (`maisha-baseline`) | **1453** | 0 |
| m3 + m4 + m5 applied together | **1453** | 0 |

Failing-title diff in both directions: **empty**. Zero regressions.

Two things worth noting:

- **The baseline matches §8's 1453/0 exactly** for this config and core version — independent
  corroboration that this setup reproduces the one in the runbook.
- **The +14 gap versus §8's 1467 is fully explained**: that figure counts generated specs
  shipping with the fixes. Ours contribute none — M4's were excluded as broken (1.2), M5's
  path deliberately skipped generation (1.10), and M3's had to be removed to let the suite
  run at all (1.2). §8 also merged four fixes to our three, since `m7-corrected` was out of
  scope here.

The first attempt at this check **failed in two seconds** on M3's eslint violation, which is
how that defect was found. A useful side effect: §4 is the only step in the whole procedure
that runs the partner's real `npm test`, and it caught something five earlier gates did not.

---

## 4. Config findings worth passing to the eCHIS owners

Not pipeline issues; found while validating.

1. **Committed form XML is broadly out of sync with the workbooks.** Regenerating the app and
   contact forms through the pinned converter shifts bind counts on **13 files**, in both
   directions (largest: one contact form −18 binds, two app forms +17 and +10). It also rewrites ~80 of the 91 committed `.xml` files,
   though that file count is only approximate — the converter's attribute/element ordering is
   not deterministic, and two consecutive runs here differed from each other on 69 files. The
   bind-count deltas are the stable signal. CI regenerates before uploading, so deployments are
   unaffected — but a committed `.xml` cannot be trusted as a picture of deployed behaviour.
   A CI check that fails when `convert-*-forms` produces a semantic diff would close it.
2. **`immunization_referral_follow_up` has never been able to fire** (see 2.3).
3. **`tasks.js:1326` passed the task wrapper instead of the contact** to
   `countTotalVaccinesByAge`, leaving `date_of_birth` undefined. Fixed as part of M4.
4. **One CI-workflow hygiene item** — withheld from this public document; sent to the
   engagement owner privately. It concerns a third party's repository.

---

## 5. The thing I'd raise first

Across five runs the pipeline never produced a wrong fix. Every fix it wrote was correct, and
the two oracles that judge the *deployment* (compiled-settings RED→GREEN, artifact rev change)
were right every time.

What repeatedly went wrong was the **supporting evidence**: validation reasoning about the
wrong config (1.1), generated tests that cannot run (1.2), and a baseline comparison that
blames them on the fix (1.3). On an attended run these cost time. On `--qa-auto` they would
ship as PR text saying a correct fix is broken and breaks six tests.

`TEST_GEN_VERIFY=1` would address the largest single source of it (1.2/1.3). The reviewer's
config confusion (1.1) needs someone who knows the code to identify the actual vector.

### 5.1 The other lever is ticket quality, and it is measurable

M5 was run against a **corrected** ticket — one that named the real mechanism (the
over-prompting is on the follow-up branches, not the miscarriage path), cited the exact
workbook cell, stated the scope constraint ("do not add a `relevant`"), and recorded that the
prescribed edit had been verified against the real converter.

The pipeline then independently derived the three-branch reachability analysis, produced the
minimal fix, and passed every oracle first time. Same pipeline that emitted four false
objections on M3.

The original tickets were built from CHP feedback in a way that is accurate about symptoms and
unreliable about mechanism: the Description is transcribed near-verbatim from the meeting
minutes (accurate in all five cases), while the Technical Context was reverse-engineered by
config search afterwards and is wrong on three of five. Ticket accuracy tracked how
mechanistically precise the CHP happened to be — where they described what they saw (M3, M4)
the search landed on the right code; where they offered a theory of cause (M5, M7) or none at
all (M8), the guess was inherited and then dressed in file:line citations.

The unbuilt `--triage` ticket in `cht-conf-feedback-triage.md` (T9) already specifies the fix:
ground raw feedback in the local config *before* authoring, and emit `layer: investigate`
rather than "a guessed config claim". Based on this campaign that is worth more than its
current medium/backlog priority — the three tickets it would have caught cost more time than
every pipeline defect in section 1 combined.
