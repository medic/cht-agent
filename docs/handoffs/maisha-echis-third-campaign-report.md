# Maisha eCHIS campaign — third run: five tickets, five bundles, three shippable

**Completed 2026-09-11.** Third campaign against the Maisha tickets, and the first by an
operator other than the runbook's author. Single session from a cold machine, following
`maisha-demo-full-procedure-v2.md` end to end. Branched off **`fix/pipeline-hardening`
@ `089e8a3`** — this report adds two documents under `docs/handoffs/` and changes no code.
The PR bundles are **not** committed, per the repo's own convention (`.gitignore:23`,
"shared out-of-band"); they are attached separately.

Read alongside §7 (first automated run, CHT 4.21.1) and §8 (second, updated config on
5.3.0) of the runbook. This run is the same config and stack as §8, which makes the two
directly comparable — see the gate numbers below. Config: the partner's updated release
(2026-09-03 handover export) — **not** the public mirror, which is long stale (see D1). Stack: CHT **5.3.0**, cht-conf **3.21.4** (`v3-21-4-with-830`), cht-core
checkout at `5.3.0`.

Gates (runbook §4, run once at the end, no commits — patches applied to the working tree
and reset after): baseline **1453 passing / 0 failing**; m3+m4+m5 applied together
**1453 passing / 0 failing**; failing-title diff empty in both directions → **zero
regressions**. The baseline matches §8's 1453/0 for this config and core version exactly,
which corroborates the environment.

Eight runs across five tickets produced five bundles. Three fixes are shippable; one
ticket was certified as already fixed upstream; one was run deliberately as-written to
capture a green-but-wrong result. **The pipeline never produced an incorrect fix.** Every
failure in this campaign was in the evidence *around* the fix — validation reasoning from
the wrong config, generated tests that cannot run, and a baseline comparison that blames
them on the change under review.

---

## Ticket outcomes

| Ticket | Runs | Result | Bundle |
|---|---|---|---|
| **M3** newborn PNC task duplication | 1 | **PASSED** — RED→GREEN, rev `2-…`→`3-…`, tier-2 9 passing. Bundle corrected post-run (F6). | `m3/` |
| **M4** immunization defaulter false positive | 4 | Fix verified (RED→GREEN, rev change, partner suite 130/0); **bundle reconstructed** source-only after generated-spec defects (F2). | `m4/` |
| **M5** PNC next-visit-date | 1 | **PASSED, no caveats.** Bind oracle 11/11, whole-document oracle clean, tier-2 14 passing. Run against a **corrected** ticket. | `m5/` |
| **M7** orphan question | 1 | **PASSED WITH CAVEATS** — every oracle green on a change its own reviewer called a false-negative risk (F1). Run as-written, deliberately. | `m7-as-written/` |
| **M8** education field calculate | 1 | **Certified.** `DID NOT PASS — the symptom never reproduced pre-fix … the config was never applied`. Bind assertions passed *pre-fix*. | `m8-certification/` |

`m7-corrected-caregiver` was **not** run. Its prescription keys on `hh_member_caregiver`,
which suppresses the question for a single orphan living with the surviving parent — also
clinically wrong — and it is a user-visible change, ruled out of scope by the config owner.

M4's four runs failed for four **different** reasons, none of them the fix: the compiled-
settings gate (F5), a session limit, a host suspend (F4), and a generated-spec defect (F2).

---

## The result worth leading with

M5 and M7-as-written produced **identical machine verdicts** and **opposite clinical
outcomes**. The only variable was the quality of the ticket going in.

| | M5 (corrected ticket) | M7 (as-written ticket) |
|---|---|---|
| RED reproduced | ✅ | ✅ |
| Whole-document oracle | ✅ only the target bind | ✅ only the target bind |
| GREEN verified | ✅ | ✅ |
| Artifact rev changed | ✅ | ✅ |
| Tier-2 | ✅ 14 passing | ✅ 2 passing |
| **Headline** | **PASSED** | **PASSED WITH CAVEATS** (caveat = scope, not the defect) |
| **Clinically** | correct minimal fix | **wrong** — suppresses a question CHPs need |

M7's emitted expression gates every household member's orphan question on
`/data/init/father_alive` — the *household head's* parents, asked only when the head is
≤18. For a child-headed household, the one case where those fields are populated, it
actively suppresses the question for every child.

**The pipeline knew.** Its reviewer derived this independently, from the wrong ticket:

> *"father_alive/mother_alive concern the household head's parents (label 'Is
> the household head's father alive?') and are only asked when hh_head_age_in_years <= 18,
> while is_orphan is per under-18 household member. Gating every member's orphan question
> on the head's parents' status can wrongly suppress it (false negative)."*

It was deferred — *"blocking — the deterministic XLSForm apply owns the verdict on this
path"* — and appears in PR.md as item 3 of 3 in a checklist below a green banner.

This is a sharper form of §8's "oracles prove what the ticket ASKED, not what the CHP
NEEDED": here a component *did* know what the CHP needed, and was outranked by policy.

---

## Findings (full detail in `FINDINGS-for-cht-agent-team.md`)

Ranked by damage on an unattended run.

| # | Finding | Severity |
|---|---|---|
| **F1** | The XLSForm path outranks its reviewer. Good for mechanics (the apply proves the attribute changed as described); wrong for semantics (it has no view on whether the change *means* anything, and the component that does is subordinated). M7 shipped green. | high |
| **F2** | Generated specs ship broken, in **three** distinct classes: invented harness APIs (`harness.pushMockedReport`, 0 occurrences in the harness); fixtures never executed (one spec is red→**red**, failing identically with and without the fix); and lint violations (M3's `eqeqeq`, which fail-fasts the partner's `npm test` in 2s). **No single mitigation covers all three.** | high |
| **F3** | Tier-2's baseline runs a smaller spec set than the post-fix run (3 vs 5 — generated specs cannot exist in `HEAD`) and reports *"pre-fix specs PASSED — every failure below is new in this change"*. Literally true, materially misleading. | high |
| **F4** | The dev-phase `claude -p` call has no read timeout. A host suspend (verified: `PM: suspend entry (deep)` 11:23:45 → `exit` 12:26:09) left it blocked on a dead socket: 71 min, 0 bytes, 0.39% CPU, progress counter still ticking. Test-gen caps at 600s and retries; this call does not. | med-high |
| **F5** | Correct blocking recommendations are recorded, not applied. M4 attempt 1 died at the compiled-settings gate on unused imports — which a DEFERRED item had named exactly, before HC2, and `automatic recommendation-driven refinement is off`. | medium |
| **F6** | A no-op fix is reported as **"XLSForm fix verified"**. M8's bind diff read `calculate: (absent) → (absent)`; the run continued ~50 min before QA aborted. This is T4 in `cht-conf-feedback-triage.md`, observed rather than theorised. T4 is unbuilt. | medium |
| **F7** | The reviewer reasons from cht-core's `config/default/nools-extras.js:21` (5-param helper) rather than the mounted config's the deployment's own `nools-extras.js` (6-param, with `sourceID`). Produced four unfounded blocking objections on M3. **The vector is not `CANONICAL_CONF`** — see the disproof in the findings doc; it needs someone who knows the code. | high |
| **F8** | Test-gen's 600s cap vs a 97,169-char prompt at `CLAUDE_CODE_EFFORT_LEVEL=max`: one spec needed 3 attempts on one run and 2 on another, ~50 min for one file. | medium |
| **F9** | The HC4 retry path walks into the non-reproduction trap: QA has already applied the fix, so the retry's QA cannot reproduce RED. Measured on M4 attempt 4 — mount `contact_summary` sha `8a89d74b` (baseline) vs deployed `7045541f` (fixed): the tree was rolled back, the instance was not. | medium |

Positive, and portable: the XLSForm path **annotates pre-verdict reviewer claims honestly**
(*"it never saw the apply/QA results above — superseded by a verified apply"*), **declines
to generate a spec that would prove nothing** (*"the relevant-centric template would not
distinguish buggy from fixed"*), and its bind/whole-document oracles matched an independent
pre-run measurement exactly (319 binds, one semantic change). None of these behaviours exist
on the settings path.

---

## Runbook findings

| # | Finding |
|---|---|
| **D1** | **The mirror the runbook's clone step is most likely to reach is long stale**, and no branch on it matches the handover export (173 files differ; 14 exist only on the mirror). The authoritative copy now lives elsewhere and is obtained from the engagement owner, per §0.2. §1.2 should say so explicitly — cloning the stale mirror silently invalidates every ticket citation, and the operator has no signal that it happened. |
| **D2** | **`CHT_NETWORK` collides silently, and the preflight cannot catch it.** The published compose declares `name: ${CHT_NETWORK:-cht-net}` — fixed and unprefixed — so a second CHT stack on the same host shares the network, and `couchdb`/`nouveau` round-robin between stacks. Our entire setup (config upload, hierarchy, user, cohorts) landed in a pre-existing stack's CouchDB. **Every §1.11 check passed**, because the reads round-robined to the same wrong database. Surfaced an hour later as a browser "Loading error" from a *different* cross-wiring (CouchDB 3.5.2 → the other stack's older nouveau, `422 initialPurgeSeq must not be null`). Tell: the reported CouchDB version changed 3.5.0 → 3.5.2 under the same image tag once isolated. Fix: pin `CHT_NETWORK=<unique>` in §1.6's `.env` and assert `getent hosts nouveau \| wc -l` = 1. |
| **D3** | **§1.5/§1.11's M5 grep false-negatives on the pristine XML.** `grep -o '<bind nodeset="[^"]*next_pnc_visit_date"…'` returns **zero matches** while the bug is present, because the partner's committed XML alphabetises attributes and `constraint` sorts before `nodeset`. §1.5 runs before §1.7's canonicalization, so an operator hits it in order and may "restore" a correct file. Not a converter property — the converter emits `nodeset` first, and the grep works post-regeneration. Order-tolerant: `grep -o '<bind [^>]*next_pnc_visit_date[^>]*>'`. |
| **D4** | **A stray host `ANTHROPIC_API_KEY` silently overrides the subscription path.** Compose forwards it as an "optional fallback"; `claude -p` prints `ok`, §1.11 passes, and the run bills the API. Worth a preflight assertion that it is unset. |
| **D5** | **§1.6's zsh word-splitting trap is real** and caught us despite being documented: `$CS down -v` became one command word, failed, and the next command in the same block wiped the data directory out from under six running containers. Worth promoting from a note to a hard rule. |
| **D6** | §3 line citations are stale against this config (M3 1368→1365, M4 175→168 / 1329→1326). The agent located by content regardless. M3's helper attribution is **correct** in the ticket — the nootils misattribution was the pipeline's reviewer, not the ticket. |

---

## Deviations from the procedure

- **`$SITE_CONFIG` is a `git init` of the handover export**, not a clone (D1). Tree content
  is authoritative; history is synthetic. Every patch was still acceptance-tested against it.
- **No commits anywhere.** This was a test run; fixes live only as archived patches. The §4
  regression check applied patches to the working tree and reset after.
- **M5 ran against a rewritten ticket**, installed with `docker cp` per §8. The baked ticket
  prescribes a `relevant` gate, which removes a field CHPs can see — out of scope under the
  config owner's standing rule. The corrected ticket prescribes the minimal `required`-column
  change instead, pre-verified against the real converter before the run.
- **M4's bundle is reconstructed**, source-only. Its generated specs were excluded after being
  run and found broken; shipping them would break the partner's `npm test`.
- **The browser halves of Phase B/E were not done.** All content checks were; the click-path
  story beats need a human.

---

## Post-run adversarial review (corrections applied)

Every factual claim in the findings document was independently re-derived by four checkers
against the live tree and containers: **31 confirmed, 5 wrong, 7 imprecise, 2 unproven.**
All corrected in place, with the overturned claims left visible rather than quietly fixed.

The most important correction was to **the original headline finding**. An earlier draft
blamed the reviewer's wrong-config reasoning (F7) on `CANONICAL_CONF`. That path resolves to
`config/standard`, which contains only a deprecated `readme.md`; its sole consumer
(`canonical-diff.ts`) looks only at `tasks.js`; and executing it live returns
`missing-in-canonical` with no file content. The observation stands, the cause does not, and
the proposed fix would have done nothing. Recorded as a disproof so nobody re-opens it.

Second: **F1 was originally written up as a strength.** After M5 the note read "the XLSForm
path subordinates the reviewer to the deterministic apply" — correct there, where the
deferred item was a whitespace nitpick. M7 showed the same policy overruling a correct
clinical objection. Rewritten.

Both errors are the same failure mode this campaign is about: finding a plausible artefact
and assuming its role without tracing it.

---

## Follow-ups discovered

1. **Build T9 (`--triage`).** Already specified in `cht-conf-feedback-triage.md`, currently
   backlog/medium. The three defective tickets cost more time in this campaign than every
   pipeline defect in F1–F9 combined. Its own spec names the fix: ground raw feedback in the
   local config before authoring, and emit `layer: investigate` rather than "a guessed config
   claim".
2. **Build T4** (no-op apply warning) — F6 is its premise, observed.
3. **Default `TEST_GEN_VERIFY=1` for `--qa-tier2`, and lint generated specs.** Neither alone
   is sufficient; see F2.
4. **Separate semantic from mechanical reviewer objections** (F1). A semantic objection should
   gate the verdict or change the headline, not sit under a PASSED banner.
5. **Config-side, for the eCHIS owners:** committed form XML is broadly out of sync with the
   workbooks (bind counts shift on 13 files, both directions — one contact form −18, one app form +17,
   another +10). CI regenerates before
   uploading so deployments are unaffected, but a committed `.xml` cannot be read as deployed
   behaviour. A CI check failing on a `convert-*-forms` diff would close it.
6. **`immunization_referral_follow_up` has never been able to fire** — its field
   `imm_schedule_upto_date` exists in no form; only a `tasks.js` reference and an orphaned
   translation key survive. Re-keying to `immunization_upto_date` (a readonly display note)
   leaves it just as unreachable. Making it reachable is a config-owner decision.
7. **One CI-workflow hygiene item in the partner repo** — withheld from this public
   document; it is in the private handover sent to the engagement owner. Not a proven leak,
   but it concerns a third party's repository and does not belong on a public page.

---

## Artifacts

```
~/maisha-pr-archive/
  m3/              PR.md · changes.patch · changes.patch.orig   (eqeqeq fix applied, F6)
  m4/              PR.md · changes.patch                        (reconstructed, source-only)
  m5/              PR.md · changes.patch
  m7-as-written/   PR.md · changes.patch                        (green, clinically wrong)
  m8-certification/PR.md · changes.patch                        (the abort IS the artifact)

config-echis-2-0-main/maisha-ticket-review/
  FINDINGS-for-cht-agent-team.md     the long-form findings, post-review
  maisha-echis-campaign-report.md    this document
  m3/m4/m5-*.md                      rewritten tickets (Technical Context replaced)
  REPORT-m7-*.md, REPORT-m8-*.md     the two tickets that should not be run as written
  HC2-PREDICTIONS.md                 pre-registered expected diffs + reject criteria
  evidence/m5-required-expression/   runnable proof of the M5 toolchain check
```

Each PR.md carries a reviewer's note recording what the machine evidence does and does not
establish. The M3 note refutes four unfounded deferred objections; the M4 note explains the
reconstruction; the M5 note documents the ticket correction; the M7 note is the caveat itself.
