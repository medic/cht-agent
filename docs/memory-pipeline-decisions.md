# Memory pipeline: design decisions

**Status:** DRAFT — awaiting sign-off (posted to PR #138 on 2026-08-27)
**Deciders:** @alexosugo, @sugat009, @Hareet
**Context:** PR #138 review (rounds 1–3). The review surfaced questions that are
product decisions, not code defects. This doc records one decision per question so
future reviews argue against a written spec instead of re-negotiating in threads.
Each decision below is a **proposal** until a decider objects or approves.

A fact that frames everything: the nightly pipeline has never produced a draft in
production. All 50 scheduled runs since 2026-06-24 either found no PRs or died on
a missing LLM key, and the commit step has never succeeded (husky hook). Decisions
D1 and D2 exist to get one real end-to-end run, because until then every review
argues hypotheticals.

---

## D1. The nightly promotes drafts through a PR, not a direct push to `main`

*(Sugat Q7; dissolves the husky and ruleset blockers)*

**Decision:** Replace the direct `git commit && git push` in `run-pipeline.yml`
with the existing promotion path: commit drafts to a branch and open a PR
(`open-review-pr.ts` already implements branch + PR creation). A human merges it.

**Rationale:**
- Ruleset `15146469` requires a PR with 1 approving review for `main`, with no
  bypass actors. A direct push can never succeed. Working around the ruleset
  (bypass actor for the bot) weakens the protection for no gain.
- The `.husky/pre-commit` hook that blocks the commit step becomes a non-issue on
  a branch; no `HUSKY=0` workaround needed.
- Machine-written knowledge should get a human glance before it lands. The repo
  already believes this: promotion from `_pending` to `domains/` goes through a
  review PR by design.

**Consequences:**
- `[skip ci]` on the pipeline commit is removed; the `check-pending` guard runs
  on the draft PR — closing the "guard never runs on the commit that adds a
  draft" gap (Sugat's note on `unit_tests.yml`).
- The nightly needs `permissions: pull-requests: write` and a branch-naming
  convention (`memory/nightly-<date>`), plus dedup of an already-open nightly PR
  (append to the existing branch rather than opening a second PR).

## D2. CI gets `OPENROUTER_API_KEY`; the workflow also wires `ANTHROPIC_API_KEY`

**Decision:** Add the repo secret and pass both env vars in `run-pipeline.yml`,
since `distiller.ts` supports both and the error message advertises both.
Owner: whoever holds repo admin (secret cannot be added from a PR).

## D3. Base-branch gate: exclusion is a skip, never an error

*(Blocker on `scraper.ts`; fix agreed in review, recorded here as the contract)*

**Decision:** A PR merged into a non-default branch is a normal, auditable
exclusion. It must write a `_skipped.ndjson` row and leave the run's exit code
untouched. Implementation: carry `baseRefName` on `ScrapedPR` and decide in the
filter (`checkSkipRules`), not by throwing from the scraper. `PR #N is not
merged` moves to the same channel. A pipeline-level test asserts
`failures === 0` plus one appended skip row for a batch containing an excluded PR.

**Contract:** an exclusion the design intends is never allowed to fail the run
or to skip the audit log. Anything that increments `failures` must be an actual
malfunction (gh failure, corrupt JSON, rate limit).

## D4. Release branches (`5.1.x` style) are IN scope; the gate allows them

*(Sugat Q1)*

**Decision:** The gate accepts the default branch plus branches matching
`/^\d+\.\d+\.x$/`. Everything else is skipped (per D3).

**Rationale:** cht-core PR 11137 merged into `5.1.x`, shipped in tags 5.1.3+,
and never reached `master`. That is real released work; excluding it loses
knowledge the corpus exists to hold. The backport-duplication risk is already
handled: dedup keys on issue id and keeps the mainline fix, so a `master` fix
plus its release-branch backports collapse to one entry.

**Trade-off accepted:** a release-branch PR whose fix later also lands on
`master` produces a transient duplicate until dedup collapses it.

## D5. Long-lived feature branches stay OUT of scope; the umbrella PR represents them

*(Sugat Q2)*

**Decision:** PRs based on feature branches (e.g. `10224-ui-extensions`,
`10707-dmp-2026-...`) are skipped permanently, even after the umbrella merges.
The umbrella PR itself (merged into `master`) is scraped and distilled, and its
linked epic issue carries the knowledge entry.

**Rationale:** member PRs describe intermediate states; the umbrella carries the
shipped result. Re-admitting members once the umbrella lands would need
merge-ancestry tracking for deleted branches — real complexity for marginal
knowledge. Revisit only if a distilled umbrella proves too coarse in practice.

## D6. Dedup never destroys distilled content

*(Blocker on `open-review-pr.ts`)*

**Decision:** `finalizeDedupDrops` moves dropped drafts to
`agent-memory/_pending/_collapsed/<domain>/` instead of `unlinkSync`. The audit
row keeps the dropped draft's title. `check-pending` and promotion ignore
`_collapsed/`. A human can merge content from `_collapsed/` by hand and delete it.

**Rationale:** for backport clusters the drop loses nothing of value; for epics
it deletes disjoint work (cht-core issue 6543: four PRs, file sets overlapping on
exactly one file). Since the pipeline cannot yet tell the two shapes apart (D7),
it must not delete either.

## D7. Epic vs backport discrimination is deferred to #154; interim rule below

*(Sugat Q3, the blocking-on-the-answer question on `dedup.ts`)*

**Decision (interim):**
- Dedup continues to collapse same-issue groups to one canonical entry.
- The tiebreak changes from lowest PR number to **default-branch base first,
  then lowest PR number**. "Prefer the mainline fix" is the actual intent, and
  PR number cannot express it (a backport opened before the master PR would win).
  `baseRefName` is available once D3 lands.
- When a group's members have effectively disjoint `relatedFiles` (pairwise
  overlap of at most one file), the group is flagged for human review instead of
  silently collapsed. That is the cheap epic detector Sugat proposed.
- Full merge-per-epic semantics (one entry per PR, or LLM-merged single entry)
  is #154's scope, informed by real corpus data after D1/D2 produce some.
- The `dedup.spec.ts` fixture titled "collapses a multi-PR epic" is renamed: the
  10792/10793/10798/10799 cluster is a backport cluster in cht-core, not an epic,
  and the real drafts live in `data-sync`, not `tasks-and-targets`. A true epic
  fixture (6543 shape) is added for the flag-for-human path.

## D8. `run-pipeline` rejects repos outside the schema enum up front

*(Sugat Q5)*

**Decision:** `--repo` values other than `medic/cht-core` and
`medic/cht-interoperability` fail fast with a clear error, before any gh call.
The schema stays the single source of the allowed list. Widening the corpus to a
new repo is a schema change plus taxonomy review, not a CLI flag.

## D9. Merge order: #138 lands first; #127 rebases

*(Sugat Q6; already agreed in threads, recorded so it stops being re-asked)*

**Decision:** #138 merges first. #127 rebases on top and its author re-verifies
that the run-scoping of `_skipped.ndjson` survives the resolution of the five
conflict regions in `run-pipeline.ts` (one is exactly the `auditOffset`/
`BatchState` initialization).

## D10. `_skipped.ndjson` truncation in #138 was deliberate

*(Sugat Q4)*

**Decision:** Confirmed. All 7 removed rows were `prNumber: 1` test pollution
("LLM triage skipped") written by a spec that ran without a `logPath` (#146).
The remainder of #146 (pass `logPath` in the four option-less `filterPR` spec
calls, `NODE_ENV=test` guard) stays on #146 and does not grow #138.

**Post-rebase note (2026-08-27):** #158 landed on `main` and gitignores
`agent-memory/_skipped.ndjson`. After the rebase the file is no longer in the #138
diff at all, so the truncation question is closed by `main`, not by this PR.

## D11. Scope discipline for #138 and after

**Decision:** #138 takes only the D3 and D6 fixes (its two in-PR blockers) plus
the D7 interim tiebreak if reviewers want it in the same PR; otherwise D7 ships
with #154. Everything else here lands as follow-up PRs referencing this doc:
D1+D2 (pipeline-to-PR), D4 (release-branch gate), D5 (no change needed — it is
the current behaviour, kept), D8 (CLI guard). Non-blocking review findings
(reconcile buckets, warn surfacing via `linkage_warning:` frontmatter, transient
`defaultBranch` cache, stale runbook lines) become small issues, not #138 commits.

**Validation practice (applies to all of the above):** every behavioural change
gets a test at the pipeline boundary, not only the unit boundary — the D3 test
shape (`failures === 0` + audit row) is the model. Unit tests prove mechanisms;
pipeline tests prove the mechanism is wired to the right channel.

---

## Verification standard: test at the pipeline boundary

### The problem this solves

The review rounds on #138 repeat one shape. The author fixes a mechanism and cites a
unit test. The reviewer traces the mechanism through the pipeline and finds it lands
in the wrong channel.

The D3 blocker is the clearest case. The base-branch gate works: `scraper.spec.ts`
proves the scraper rejects a PR merged into a feature branch. But the rejection
travels as a `ScraperError`. In `run-pipeline.ts` that path increments `failures` and
exits 1. The nightly dies and no audit row is written. The unit test passed; the
behaviour was still wrong.

The same shape appears in other review findings:

| Finding | Unit test says | Pipeline says |
|---|---|---|
| Base-branch gate | Scraper rejects the PR | Whole batch fails, no audit row |
| `scraper.spec.ts:178` | Guard throws | Throw is swallowed by the fail-open `catch`; the test cannot fail |
| `stripBoilerplate` | Function strips comments | Neither production call site is covered |
| `warn` audit entry | Entry is written | Nothing reads it; a human never sees it |

### The standard

**A behavioural claim is "fixed" only when a test at the pipeline boundary proves it.**

The pipeline boundary is `runPipeline` (nightly path) and `openReviewPR` (promotion
path). Those two functions are where a decision becomes observable: an exit code, a
written draft, a row in `_skipped.ndjson`, or a `git` action.

Each boundary test asserts two things:

1. **The exit signal.** For `runPipeline`: `state.failures` and whether `process.exit`
   was called. For `openReviewPR`: the returned status per domain.
2. **The audit row.** One appended entry in `_skipped.ndjson` with the expected
   `decision` and a `reason` that names the case.

If a change alters neither the exit signal nor the audit trail, it is not a
behavioural change and a unit test is enough.

### Why this shape

- **It is already the house pattern.** `test/scripts/run-pipeline.spec.ts` has
  "processes every PR and does not exit when all succeed" and "records a failure and
  exits 1 when a PR throws". The D3 test is a third sibling. No new harness.
- **It ends "which channel" arguments.** The open blockers are all about channel:
  error versus skip, delete versus move, log versus surface. A boundary test names the
  channel in its assertion.
- **It gives the review a citation.** A reviewer writes "covered by
  `runPipeline › skips a non-default-base PR without failing the batch`" instead of
  re-tracing the code.
- **It exposes tests that cannot fail.** Delete the guard, run the test, watch it
  fail. That mutation check is how the `scraper.spec.ts:178` gap was found.

### Applied to the two open blockers

**D3**

```
runPipeline([excludedPR, normalPR])
  → failures === 0
  → process.exit not called
  → _skipped.ndjson gained one row: { prNumber: excludedPR, decision: 'skip', reason: /non-default branch/ }
  → normalPR still produced a draft
```

**D6**

```
openReviewPR(domain with two same-issue drafts)
  → canonical promoted
  → dropped draft exists at _pending/_collapsed/<domain>/<file>
  → dropped draft no longer in _pending/<domain>/
  → audit row: { decision: 'skip', reason: /duplicate of .* "<dropped title>"/ }
  → check-pending over the tree passes (ignores _collapsed/)
```

### Cost

One extra `it` block per behavioural change, about 15 to 30 lines. The `runPipeline`
tests already stub `processSinglePR`; the D3 test needs a stub that returns a skip
decision and writes the row. No new fixtures, no new frameworks.

### What it does not cover

- **Distillation quality.** Whether a draft is good is a judgement, not an assertion.
- **Live `gh` behaviour.** Boundary tests stub `gh`. Live checks (like the 10767/10432
  validation) stay a manual step, recorded in the PR comment.
- **Workflow YAML.** `run-pipeline.yml` steps are not reachable from mocha. D1 needs a
  real run to prove itself.

### In one sentence

Every behavioural claim in review gets a test at `runPipeline` or `openReviewPR` that
asserts the exit signal and the audit row. Unit tests prove a mechanism exists;
boundary tests prove it reaches the right channel.

---

## Open items this doc does NOT decide

- Whether `LinkedIssue.comments` (written, never read) should feed the distiller
  prompt or be deleted. Needs a distillation-quality judgement; owner: #135 scope.
- The filename-grammar consolidation (three conventions on `main`; 0 files in the
  new `<pr>-issue-<n>-<slug>.md` shape yet). Harmless until the corpus is
  regenerated; decide alongside #153.
