# Runbook: taking a promote branch through content review

`memory-draft-verification.md` describes what each checker *is*. This describes
how to run a review round without wasting a day or shipping a new defect while
fixing an old one. Everything here is drawn from rounds on #120, #122, #123 and
#132 — the numbers are measured, not estimated.

## Layout

| Thing | Where |
|---|---|
| Tooling + these docs | `.claude/worktrees/memory-verify` (branch `memory/draft-verification`) |
| The corpus under review | a worktree per promote branch, e.g. `.claude/worktrees/scan-forms` |
| cht-core to verify against | `medic-cht-agent/cht-core` — **`git fetch origin master` first** |
| GitHub reads | `gh`, with `GH_TOKEN` exported (see below) |

The promote worktree needs `node_modules` to run `validate-schema`; symlinking
memory-verify's is fine and is gitignored.

## Three invocations that cost real time to get wrong

All three below were learned by getting them wrong on a live branch; the third
was written into an earlier draft of this runbook as advice that does not work,
and corrected only after running it.

**Export a token before anything `--online`.** Anonymous GitHub allows 60
requests/hour, and one 40-draft domain exhausts it. The run then reports drafts
as `unverified` and exits 3, which reads exactly like a content problem and is
not. Authenticated, the same bytes return `0 unverified`.

```sh
export GH_TOKEN=<read-only PAT>
gh api rate_limit --jq '.resources.core'   # 5000/hour, vs 60 without
```

**Point `--dir` at the whole corpus, not one domain.** `duplicate-issue` is built
from the drafts actually loaded, so a cross-domain collision is invisible if only
your domain is in memory. #122 shipped a draft duplicating a landed contacts
draft's identity for three review rounds because every run was scoped to
`domains/forms-and-reports`. Load everything and focus the reporting instead:

```sh
npm run verify-drafts -- --dir <agent-memory> --changed-only --base origin/main --online
```

**`--changed-only` does NOT work for the semantic tiers here, and the tools will
tell you so.** `ground-claims` and `check-coherence` accept the flag, but they
compute the diff *in the repo running them* — memory-verify — which knows nothing
about the promote branch's commits. The scripts live only on
`memory/draft-verification`, so there is no worktree that has both the tools and
the drafts. Every pass refuses with:

```
--changed-only matched none of the 40 drafts under <dir>, though 19 file(s) changed.
```

That is the tool being right, not broken. To gate only what changed, stage the
changed drafts into a scratch tree and point `--dir` at that. Both tiers are
per-draft, so this is sound; keep `verify-drafts` corpus-wide, because its
duplicate check is the one thing that genuinely needs every draft loaded.

```sh
STAGE=/tmp/delta/domains/<domain>/issues && mkdir -p "$STAGE"
git -C <promote-worktree> diff --name-only <last-clean-gate>..HEAD -- <issues-dir> \
  | while read -r p; do cp "<promote-worktree>/$p" "$STAGE/"; done
npm run check-coherence -- --dir /tmp/delta --label <l> --concurrency 3
```

Measured: 13 drafts per pass instead of 40. Exclude commits that only bump
`lastUpdated` — those bytes changed, the prose did not.

**For `ground-claims` there is now a flag that does this properly:
`--added-lines`.** It resolves the repo from `--dir` rather than from the repo
running the tool, which is the exact thing `--changed-only` gets wrong, so it can
be pointed straight at the promote worktree:

```sh
CHT_CORE_PATH=<cht-core> npm run ground-claims -- \
  --added-lines --dir <promote-worktree>/agent-memory --base <last-clean-gate>
```

It gates the **lines the diff added**, deterministically and with no LLM call, so
it is exhaustive over the delta rather than sampled over the corpus and costs
seconds rather than 40s per draft. That makes it a per-commit check, not a
per-round one — which is the point, since the measured source of round-N defects
is round-(N−1)'s repairs. It refuses a dirty tree, on the same frozen-bytes rule
as the ledger. Exit `1` on any `ungrounded`, `3` when only `unverifiable` remain,
and every `unverifiable` is printed: an unchecked sentence is not a pass.

Run it *in addition to* the staged-tree passes, not instead of them. It sees only
code-shaped claims in the delta; the semantic tier and the corpus-wide duplicate
check still need the full passes below.

## The round loop

1. Read the review. Fetch the body *and* the inline comments — most of the
   substance is inline.
2. **Re-derive every item before editing it.** Reviewers have been right
   essentially every time here, but the standard is that you checked, because a
   fix applied on faith is how a wrong claim gets laundered into memory.
3. Fix. Commit with a message that states what was verified and how.
4. Gate the delta: `ground-claims --added-lines --base <last-clean-gate>` on the
   commit you just made, then the staged-tree passes for the semantic tiers
   (above — and never `--changed-only`).
5. Repeat until the convergence bar below is met **on committed bytes**.
6. Write the reply: worst-first, re-runnable commands, an honest ledger, and an
   explicit list of what you disclosed rather than fixed.

## The convergence bar, and why it is not one clean pass

Claim extraction is sampled. `enumerate-claims`' own header measures it: two runs
over unchanged bytes shared 29% of extracted claims, so a single pass sees
61–67% of what is checkable. One clean pass is not evidence.

**Require at least three consecutive clean passes of each tier against frozen,
committed bytes.** Re-freeze after every fix.

The failure this prevents, verbatim from #122: passes `g17`–`g19` and `c17`–`c19`
all ran after the final commit; `g19` and `c19` came back clean and the run
stopped — while `c17`, `c18` and `g18` had each found something on those same
bytes that nobody actioned. Clean-at-the-end is not converged. Coherence on that
branch produced findings in passes 17, 18, 20–23, 25, 28, 31–33, 48, 49, 51 and
53 — almost always after one or two clean ones.

Two operational rules fall out of this:

- **Do not edit while a gate is running.** You lose the ability to say which
  bytes each pass read, which is the whole value of the ledger.
- **A degraded run is not a clean run.** If a report shows many "semantic
  extraction failed" entries (rate limits, CLI errors), its counts mean nothing —
  two runs on #122 dropped from 619 grounded to 452 and 407 that way.

## Verifying a claim: four steps, not two

This is the protocol that separates a review-grade check from what the gate does.
Apply it to the reviewer's items **and to every sentence you write yourself**.

1. Quote the claim at head.
2. Check it at the draft's own anchor.
3. Check it on `origin/master`.
4. **Walk the commits that touched the region in between.**

Step 4 is the one that gets skipped, and skipping it produced the two worst
defects of #122's round 3 — both introduced by the round-2 remediation:

- `10133` claimed "only one attachment is read". True of `getFormDocs` in
  `forms.js`, which was the only function checked; the same PR also changed
  `updateAttachments` in `generate-xform.js` to read three by name.
- `10071` credited place-create to #10099. It was already standing, from #10065
  and #10089, a week earlier.

Both sentences named only real symbols and contradicted nothing. Existence and
coherence checks cannot see either.

## Expect to cause defects while fixing them

Measured on #122: **3 of the 7 round-3 review items were introduced by the
round-2 remediation.** The follow-up audit found a fourth. When you replace a
wrong sentence, the replacement is unverified prose that the gate will only
check for symbol existence.

Two habits that pay for themselves:

- After fixing a section, **read its siblings**. `10133`, `10917` and `9553` each
  carried the same wrong claim in two or three sections; fixing one and leaving
  the others just defers the finding.
- Re-run coherence after every edit, not only at the end.

## Findings that are probe artifacts, not defects

Do not "fix" these by weakening a true sentence. Do consider rewording so the
claim is checkable — that is what stops it recurring every few passes.

| Shape | Example | Why it fires |
|---|---|---|
| Counterfactual | "kept as `target` rather than `target-interval`" | the absence *is* the claim |
| Placeholder literal | `` `sidebar_filter:analytics:<key>:select` `` | no literal grep can match it |
| Package specifier | `enketo-core/src/js/event` | not a repo path |
| XLSForm column | `instance::cht:duration` | lives inside the `.xlsx`; the rendered attribute (`cht:duration`) is what greps |
| Dotted prose form | `validation.extra_validations` | source spells it `extra_validations` |
| Literal spelled nowhere | `context: "false"` for a JSON field | reported `unverifiable`, never `ungrounded` — quote it as the source spells it |
| Epic-branch symbol | `Input.v1.UpdateReportInput` | real on master, absent at a child PR's anchor |

The durable fix for the last four is to name **both** forms — the one an author
writes and the one that greps.

## Epic-branch drafts

State it the same way every time, because the corpus has erred in both
directions (one draft treated an epic merge as shipped, another called merged PRs
unmerged):

> **Merged into `<branch>` on `<date>`; not on `master` (as of `<date>`).**

Then give the squash that carries the work to master, and check merge state via
`gh api repos/medic/cht-core/pulls/<n> --jq .merged` — git ancestry answers a
different question and both need saying.

## Stale-as-written findings out of the list regions

`entities:`, `concepts:` and `## Related Files` are lists, so the deterministic
tier reads **every** bullet — no model, no sampling, and it costs nothing extra on
a run you are already doing. Two drift defects (`10784`'s `prepareForSave`,
`9512`'s `app.module.ts`) survived five clean passes because only the LLM
extractor ever read a YAML list.

Fix one by annotating the bullet, never by deleting the entry:

```yaml
  - prepareForSave lifecycle hook (removed on master by the #10700 save-workflow rewrite, cccce201e)
  - webapp/src/ts/app.module.ts (present at this PR's anchor; removed on master by …, #9784)
```

The annotation only settles **its own** bullet, which is the point — a caveat
three lines up used to excuse the whole block.

Two things to check before writing the caveat, because "absent from
`origin/master`" is not always drift:

1. `git merge-base --is-ancestor <anchor> origin/master`. If the anchor is not on
   master, the finding is provenance, not tense — see *Epic-branch drafts*. On the
   landed corpus, 8 of 29 stale-as-written findings were this.
2. Look for the same basename elsewhere in the tree. Most of the rest are one
   directory reshuffle (#10823 moved five `api/src/services/*.js` into
   `api/src/services/replication/`), so the caveat should name where it went.

## What each tier can and cannot decide

| Tier | Cost | Decides |
|---|---|---|
| `validate-schema` | free | shape |
| `verify-drafts` | free, exhaustive | identity, duplicates, near-miss vocab, leakage, cross-field echoes |
| `ground-claims` | ~40s/draft, sampled over prose, **exhaustive over the list regions** | does this symbol/path/literal/status exist, did this PR touch it, and is it still true today |
| `ground-claims --added-lines` | seconds, exhaustive over the delta | the same, for every sentence this commit added — no LLM |
| `check-coherence` | ~40s/draft, sampled | do two sentences in one draft disagree |
| a human | slow | **is this the right explanation** |

The residual class is the last row: correctness of causal attribution. `9755`
misattributed index routing, `8656` inverted a timezone sign, `10917` overstated
a selector — each internally consistent, every symbol real. When you find a new
instance, ask whether it is mechanisable before writing prose about it. Three of
them since have been: `introduced-by` for a credit given to the wrong PR,
`literal-in-file` for a quoted selector attributed to the wrong file (9301), and
`sha-unreachable` for a commit declared gone that a `for-each-ref` still reaches
(10180). Each started as a hand-adjudicated review item.

**Anything two string comparisons can settle belongs in `verify-drafts`.** Three
such checks (`related-issues-desync`, `missing-domain-rationale`, `fit-mismatch`)
replaced defects previously found by sampled passes, one of them only on the
fourth convergence set.

## Budget

`ground-claims` and `check-coherence` spend one `claude -p` per draft per pass on
the operator's subscription; the session model is irrelevant. A 40-draft domain
run to convergence is tens of passes. Use `--changed-only`, keep
`--concurrency 3`, and log every run to `outputs/gate/` so the ledger survives a
session restart.
