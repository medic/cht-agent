# Memory Distillation Pipeline - First Production Run Post-Mortem

**Date:** 2026-07-01
**Scope:** All 8 open `chore(memory):` promotion PRs - the first production output of the
scraper -> filter -> distiller -> open-review-pr pipeline (`src/scripts/`), run against merged
`medic/cht-core` PRs.
**Method:** One analysis agent per PR (read PR body, comments, reviews, inline review threads,
each distilled `.md`, and spot-checked source issues against the live cht-core API), then a
synthesis pass. ~107 distilled memories reviewed across the 8 domains.

| PR | Domain | Memories | Feedback items | Reviewer |
|----|--------|---------:|---------------:|----------|
| #132 | contacts | 44 | 7 | sugat009 (CHANGES_REQUESTED) |
| #131 | authentication | 39 | 7 | sugat009 (CHANGES_REQUESTED) |
| #130 | configuration | 10 | 6 | sugat009 |
| #129 | data-sync | 14 | 10 | sugat009, Hareet (partial fix already shipped) |
| #123 | tasks-and-targets | 35 | 7 | sugat009 (rebase) |
| #122 | forms-and-reports | 47 | 6 | Hareet, sugat009 (rebase) |
| #121 | infrastructure | 49 | 7 | Hareet, sugat009 (rebase) |
| #120 | messaging | 17 | 6 | Hareet, sugat009 (rebase) |

---

## Executive summary

**The distillation prose is good; the plumbing is not.** Multiple reviewers independently
verified reviewer-attribution and verbatim-error claims against the live cht-core API and found
them accurate (`witash`/`m5r`/`dianabarsan` quotes in #130, correct file lists in #122/#123).
The systemic defects are almost entirely in **metadata assembly, deduplication, and input
truncation** - not in the model's summarization. **Fixes should target pipeline plumbing, not a
prompt rewrite.**

One defect dominates everything else:

> **PR-number-as-issue-number.** `buildFrontmatter` (`distiller.ts:267`) computes
> `issueNumber = pr.linkedIssues[0]?.number ?? pr.prNumber` and derives `id`, `issueNumber`, and
> `issueUrl` from it. The scraper's `fetchLinkedIssues` only matches body
> `fixes|closes|resolves #N`, but CHT encodes the issue in the **PR title** `type(#N):`, which is
> never parsed. So for the common case `linkedIssues` is empty, the `?? pr.prNumber` fallback
> fires, and the memory's primary key names the **merge PR** instead of the resolved issue.
> **~60 of 107 drafts across the four fully-reviewed domains** (contacts/auth/config/data-sync) are
> affected. The `/issues/N -> /pull/N` GitHub redirect makes
> the bad reference resolve to a valid page, so `validate-schema` passed with 0 failures while
> shipping wrong data.

Everything downstream inherits this: the id scheme is internally inconsistent (issue-keyed when
the body used a keyword, PR-keyed otherwise), which **defeats the planned #135 de-dup-by-issue-id
consumer** because the key is neither reliably the issue nor the PR.

PR #129 (data-sync) already shipped most of the fix (`gh-classify.ts` using the `pull_request`
API key to tell issues from PRs, `issue-linkage.ts` collecting refs from title + closing-refs, and
a one-off `relink-issues.ts`): title parsing is wired into the forward path (`scraper.ts`), the
`?? pr.prNumber` alias is gone from `buildFrontmatter` (`distiller.ts:268` flags PRs with no
issue), and the nested `10399 -> 10182(PR) -> 10183` case is handled and regression-tested
(`relink-issues.spec.ts:96`). **Deduplication is the one gap still open.**

---

# Part 1 - Consolidated findings

## 1. Overall patterns

1. **PR-number-as-issue-number is the single dominant defect** across all 8 seeders
   (`distiller.ts:267`). Reviewer-confirmed prevalence in the four fully-reviewed domains: 31/44
   contacts, 19/39 auth, 4/10 config, 6/14 data-sync - **~60/107**; tasks (15/35) and the
   messaging/forms/infra clusters add more on top.
2. **The mislink's root is upstream in the scraper, not the LLM.** `fetchLinkedIssues`
   (`scraper.ts:82-112`) parses only body `fixes/closes/resolves #N` and explicitly omits GitHub's
   `closingIssuesReferences` sidebar (documented limitation, header). The CHT `type(#N):` title
   convention is never parsed, so `linkedIssues` is empty for the common case.
3. **Distillation prose is high quality and well-grounded.** Independent API verification of
   reviewer quotes and error strings held up. Target the plumbing.
4. **No deduplication exists anywhere.** `filter.ts` dedups issue numbers only *within* one PR
   body; the distiller runs one LLM call per PR with no cross-PR state; `open-review-pr.ts` just
   lists `.md` paths by domain. CHT's master+backport release workflow and multi-PR epics multiply
   one logical fix into N memories (backport pairs 9027/9098, 8924/8933, 10073/10082; epics
   #10038 x5, #10792 x3; cross-domain #9835/#9065/#6543 shared between #131 and #132).
5. **The id scheme is internally inconsistent** because of the fallback - issue-keyed vs PR-keyed
   depending on whether the body used a keyword. This is unstable across regeneration and defeats
   #135's de-dup.
6. **Static, information-free frontmatter.** `confidence` is hardcoded `'medium'`
   (`distiller.ts:288`, not LLM-chosen) and `related_issues` is always `[]` (line 293, awaiting a
   "later post-pass" that does not exist). Reviewers of 40-49-draft PRs get zero triage signal.
7. **The mislink is invisible to CI** because `/issues/N` redirects to `/pull/N` - passes
   validation while shipping wrong data.
8. **Truncation is occasionally load-bearing on content, not just metadata.**
   `ISSUE_BODY_LIMIT=500` plus un-stripped CHT template boilerplate (a ~246-char PHI HTML comment)
   consumed the budget before the root-cause sentence in issue #10912, producing a vague Root Cause
   in the 10914 memory. The one confirmed case where a limit degraded prose.
9. **Low-rate but real prose defects surface on the highest-complexity/borderline entries:** a
   fabricated "Slack" channel (#132/9311 - no Slack in the scraper), hallucinated file paths
   (#123/10623), leaked pipeline-internal classifier reasoning ("cf. Seed 4", "a reviewer could
   re-bin", #129/10793), and ephemeral process noise (reviewer logins, LGTM, CI hiccups, #120).
   Hallucination hides in the elaborate entries, not the simple ones.

## 2. Recurring failure classes

| Failure class | Prevalence | PRs | Root cause |
|---|---|---|---|
| **PR number written into issue-identity fields** (`id`/`issueNumber`/`issueUrl`) | ~60/107; every seeder | all | `scraper.fetchLinkedIssues` misses title `type(#N):` + `closingIssuesReferences`; `distiller.ts:267` `?? pr.prNumber` fallback then derives id/URL from it |
| **Duplicate memories** - backport cherry-picks + multi-PR epics each yield a file | clusters per domain (7/47 forms = 3 fixes; 6/17 messaging = 3 fixes; #10038 x5) | 132,131,129,123,122,121,120 | No dedup stage; backport markers (`cherry picked from commit`, trailing `(#M)`, `baseRefName != master`) captured but unused |
| **Cross-domain duplication** - same issue promoted into two domain seeders | >=3 issues (#9835/#9065/#6543) | 132,131 | `filter.ts` classifies each PR independently; no global dedup key across seeders |
| **Static frontmatter carries no signal** - `confidence` always `medium`, `related_issues` always `[]` | all drafts | all | `distiller.ts:288` hardcodes confidence; line 293 sets `[]` awaiting a nonexistent post-pass |
| **Ungrounded prose on complex/borderline entries** - fabricated channels, hallucinated paths, leaked classifier reasoning, process noise | ~1-2 files/PR | 132,129,123,120 | narrative fields (`designChoices`, `rootCause`, `relatedFiles`, `testing`) have no grounding constraint |
| **Truncation drops the root-cause mechanism** for near-empty PRs whose detail lives only in the issue | confirmed once (10914) but structural | 129 | `ISSUE_BODY_LIMIT=500` on un-stripped bodies; PHI template block eats the budget; no HTML-comment stripping |
| **Mislink invisible to CI** - `/issues/N` redirects to `/pull/N` | all mislinked drafts | 132,131,130,123,122,121,120 | `distiller.ts:275` hardcodes `/issues/` path; schema can't distinguish issue from PR |
| **Borderline domain promoted as strong with no gradient** | config 64% weak this run; training-cards mis-domained into forms | 130,122 | `domainFit` is a binary LLM choice; no numeric confidence; prompt lacks an onboarding/navigation bucket |

## 3. Prompt improvements that address multiple issues

One CONSTRAINTS block appended to `buildPrompt` (after the JSON schema, ~line 206) fixes five
recurring prose defects at low effort:

1. **Ground `relatedFiles`/`entities` in the supplied file list.**
   > `relatedFiles` and `entities` MUST be chosen only from the Files changed list above. Do not
   > infer, guess, or invent paths. If a file is not in that list, do not include it.

   *Fixes:* hallucinated paths (#123/10623 - draft lists `services/user-contact.service.ts`, absent from the PR).
2. **Ban ungrounded channels/reviewers/process trivia.**
   > Do NOT mention communication channels (Slack, forum, etc.), reviewer usernames, approval
   > status (LGTM/approved), number of review rounds, or one-off CI/environment/dependency issues
   > unless they appear verbatim in the Review comments above. `testing` describes test strategy and
   > coverage, not the review process. `designChoices` and `rootCause` state only facts grounded in
   > the PR body, linked issues, or review comments provided.

   *Fixes:* fabricated "Slack" (#132/9311), process noise (#120/#130), hedged e2e narrative
   (#120/10442).
3. **Clean `domainReasoning` (field description, ~line 188).**
   > `<1 clean sentence naming the changed subsystem that makes this domain correct. Do NOT
   > reference internal seeds/rules, other drafts, or hedging like "a reviewer could re-bin".>`

   *Fixes:* leaked classifier reasoning (#129/10793).
4. **Concrete `rootCause` (field description, ~line 199).**
   > `<the concrete mechanism - name the specific function, API misuse, or code path (e.g.
   > "Set.add(...keys) drops all but the first id because add() takes one argument"). If the
   > mechanism is stated in the linked issue, reproduce it; do not paraphrase into vagueness.>`

   *Fixes:* vague Root Cause (#129/10914) as a secondary guard after boilerplate stripping.
5. **Onboarding/navigation domain cue (extend `DOMAIN_PITFALLS`).**
   > Classify by the changed subsystem (service/component/routing/i18n), not the user-facing
   > surface. Route guards, modals, app-shell wiring, and translation-only changes are NOT
   > forms-and-reports merely because they render through Enketo/forms UI - mark such PRs weak (or
   > the onboarding/navigation domain) and name the subsystem in `domainReasoning`.

   *Fixes:* training-cards mis-domained as strong forms-and-reports (#122/9512/9592).

## 4. Pipeline improvements that address multiple issues

1. **Resolve the canonical issue with a priority chain; stop aliasing the PR number.**
   `(1)` GraphQL `closingIssuesReferences` (GitHub's authoritative link) -> `(2)` CHT title
   `type(#N):` -> `(3)` body `Fixes/Closes/Resolves`, following one PR->PR hop via `gh-classify.ts`'s `pull_request` key;
   only if all fail, `issueNumber = null` + flag for human. Always keep the PR in `source_pr`.
   *Where:* `scraper.ts fetchLinkedIssues` + a shared resolver in `distiller.buildFrontmatter`
   (drop `?? pr.prNumber` at line 267); reuse #129's `issue-linkage.ts`/`gh-classify.ts`.
   *Solves:* the ~60/107 mislink and the id-scheme inconsistency that blocks #135.
2. **Require a resolved issue, or skip the PR - never fabricate `/issues/<prNumber>`.** #138 shipped
   this: `buildFrontmatter` keeps `issueNumber` required and `flagForHuman`s any PR that closes no
   tracked issue, rather than emitting a PR-derived `/issues/` URL.
   *Where:* `distiller.buildFrontmatter` (throws/flags when `linkedIssues[0]` is absent).
   *Solves:* the silent redirect that masks mislinks; fabricated issue metadata for `feat(na)`
   PRs (#131/8843, #121/8693/10689).
3. **Add a de-dup pass keyed on resolved issue id, across ALL seeders, before promotion.** Collapse
   backport cherry-picks and epics into one memory with a `source_prs[]` array; detect cross-domain
   collisions and keep one canonical domain + cross-reference. Detect backports via
   `(cherry picked from commit <sha>)`, trailing `(#M)` in title, and `baseRefName != master/main`.
   *Where:* a new stage invoked by `open-review-pr.ts` before grouping; log collapses to
   `_skipped.ndjson`.
   *Solves:* all duplication classes; a stated #135 acceptance item. **Must run after fix #1** so
   the key is a stable issue id.
4. **CI / pre-promotion guard.** Fail when `issueNumber == source_pr`'s PR number, when
   `issueNumber` contradicts the filename `type(#N)` slug, or when two drafts in a set share an id.
   *Where:* `validate-schema` or a guard in `open-review-pr.ts`.
   *Solves:* catches the entire mislink + duplicate-id class in CI regardless of upstream bugs.
5. **Strip HTML comments/template boilerplate before truncation;** optionally make
   `ISSUE_BODY_LIMIT` adaptive (grant more budget to the linked issue when the PR body is
   near-empty).
   *Where:* `scraper.ts` (strip before assembling bodies) + `distiller.ts` constants (line 41).
   *Solves:* the 10914 content-degradation; reclaims ~246 chars of PHI-comment budget on every PR.
6. **Confidence gradient + run/remove the `related_issues` cross-link pass.** Derive confidence
   heuristically (lower it when `issueNumber` fell back to PR, when the draft is a backport, or when
   `relatedFiles` aren't all in `fileList`) or let the LLM set it (add to `draftSchema`).
   *Where:* `distiller.buildFrontmatter` (lines 288/293) + `draftSchema` if LLM-set.
   *Solves:* the no-triage-signal problem on large promotion PRs.
7. **Per-run reconciliation report.** Count drafts where `issueNumber == prNumber` (mislink rate),
   suspected backports, cross-domain collisions, and `relatedFiles`-not-in-`fileList` (hallucination
   rate). *Where:* `run-pipeline.ts` summary and/or the promotion PR body. Also flag the
   `_skipped.ndjson` fixture-row hygiene issue (#120).

## 5. Prioritized implementation roadmap

> **Status:** most of this is now in-flight in the open **#138** (same author). Ranks 1-3 and 5-8
> map to `dedup.ts` (`ciGuardReason`, `dedupeByIssueId` + `source_prs[]`), `reconcile.ts`
> (`hallucinationRate`), the `buildPrompt` CONSTRAINTS block, `stripBoilerplate` +
> `ISSUE_BODY_LIMIT_EXPANDED`, and `computeConfidence`. Read the ranks below as tracking #138, not
> net-new work.

| Rank | Item | Impact | Effort | Rationale |
|:---:|---|:---:|:---:|---|
| **1** | Complete the issue-resolution chain (title `type(#N)` + `closingIssuesReferences`) and remove the `?? pr.prNumber` alias; set `issueNumber` null + flag when unresolved | high | med | Repairs the ~60/107 mislink that corrupts the corpus key and blocks #135. Extends #129's existing `gh-classify.ts`/`issue-linkage.ts`. |
| **2** | CI guard: fail promotion when `issueNumber == source_pr`, contradicts the filename slug, or duplicates an id | high | low | Cheap regression net that would have blocked every mislinked/duplicate draft; the `/issues->/pull` redirect makes this the only reliable detector |
| **3** | Cross-PR + cross-domain de-dup keyed on resolved issue id, collapsing to one memory with `source_prs[]` | high | med | Eliminates every duplication cluster; a #135 acceptance item. **Must run after rank 1.** |
| **4** | Require a resolved issue or skip: flag/skip PRs that close no tracked issue rather than fabricating `/issues/<prNumber>` | med | low | The approach #138 shipped - keeps `issueNumber` required and the schema issue-keyed, so the corpus never misrepresents a PR as an issue |
| **5** | Harden `buildPrompt` (the CONSTRAINTS block in section 3) | med | low | One edit fixes five prose defects; lower priority since prose is mostly sound |
| **6** | Strip HTML-comment/template boilerplate before truncation; consider adaptive `ISSUE_BODY_LIMIT` | med | low | Reclaims wasted budget on every PR; fixes the one confirmed content-degradation (10914) |
| **7** | Confidence gradient + run/remove `related_issues` cross-link pass | med | med | Gives reviewers triage signal; lets ranking down-weight backports. Depends on rank 1. |
| **8** | Per-run reconciliation report + fix `_skipped.ndjson` run-hygiene | low | low | Observability that surfaces the above before human review; removes committed fixture rows |

---

# Part 2 - Evaluation strategy

**Approach:** a three-layer, fixture-backed regression suite that pins each reviewer-caught defect
as a permanent test, plus a golden set scored automatically against the live cht-core API. Because
distillation prose is already mostly faithful, weight automatic metrics toward the deterministic,
cheap **metadata / dedup / grounding invariants**, and reserve LLM-graded prose scoring for a small
sample.

**Layers**

- **Unit** (pure functions, synthetic `ScrapedPR` fixtures, no network): `resolveIssueNumber`
  priority chain (`closingIssuesReferences` > title `type(#N)` > body keyword > null);
  `buildFrontmatter` never emits `/issues/<prNumber>` and sets null when unresolved; `slugify` edge
  cases; `relatedFiles subset of fileList` validator; PR-vs-issue classification via the `pull_request` key.
- **Integration** (dedup/promotion across multiple drafts): backport pairs and epics collapse to one
  memory with `source_prs[]`; cross-domain dedup keeps one canonical domain; the `validate-schema`
  guard fails on `issueNumber == source_pr`, slug/`issueNumber` mismatch, and duplicate ids.
- **E2E** (full scrape->filter->distill over recorded real PRs, `gh` output cached as fixtures):
  8675 (title-only), 10555 (body-keyword), 8843 (`feat(na)`), 10914 (template-boilerplate issue),
  9311 (multi-issue body). Assert frontmatter issue fields, that boilerplate stripping preserves the
  mechanism sentence, and that prose contains no reviewer/channel/path absent from inputs.

**Automatic metrics**

- **Mislink rate** - fraction where `issueNumber == source_pr`'s PR number OR `issueUrl` resolves to
  `/pull/` (target 0, via the `pull_request` key).
- **Linkage accuracy** - fraction whose `issueNumber` matches the golden-set expected issue.
- **Duplication rate** - distinct memory files per resolved issue id (target 1; report clusters >1).
- **Grounding/hallucination rate** - fraction of `relatedFiles` present in `fileList` (target 100%)
  + count of reviewer/channel proper-nouns not in `reviewContext` (target 0).
- **Boilerplate budget waste** - stripped-HTML-comment chars / total body; whether the root-cause
  sentence survives `ISSUE_BODY_LIMIT`.
- **Triage-signal coverage** - fraction with non-default `confidence` and non-empty `related_issues`.

**Golden set:** take ~30-40 already-human-reviewed drafts spanning all 8 seeders plus the specific
reviewer-verified cases (10043, 9311, 9027/9098, 8675, 8843, 8924/8933, 10198/10278/8722/9407,
10914, 10792 x3, 10623, 9553/9555/9569/9570, 10073/10082). For each, cache the `ScrapedPR` input
(`gh` JSON fixture) and record expected frontmatter - canonical `issueNumber` verified against the
live API using the `pull_request` key, expected dedup grouping (`source_prs[]`), and expected
domain. Store as PR->expected-memory pairs; diff on every pipeline change. **Seed it from this review
- the correct issue numbers are already established here.**

---

# Part 3 - Reusable evaluation catalog

Each row is a reviewer-caught defect turned into a permanent regression test.

### Unit
| Name | Scenario | Success criteria |
|---|---|---|
| title-only issue resolution | `{prNumber:8675, title:'feat(#6530): add rate limiting for authentication requests', body without Fixes/Closes, linkedIssues:[]}` | `issueNumber=6530`, `id=cht-core-6530`, `issueUrl=.../issues/6530`, `source_pr=medic/cht-core#8675` |
| body-keyword regression guard | `{prNumber:10555, title:'feat: add pt-BR translations' (no #N), body:'Closes #10556'}` | `issueNumber=10556` - a title fix must not regress body-linked PRs |
| title outranks body | `title:'fix(#8026)...', body:'Closes #9999'` (differ, no closing-ref) | `issueNumber=8026` - title beats body in descending authority; same input -> same id |
| no-issue PR fabricates nothing | `{prNumber:8843, title:'feat(na): script to bulk change list of users passwords', linkedIssues:[]}` | `issueNumber` null/omitted, `id=cht-core-pr-8843`, no `/issues/<prNumber>` |
| nested PR chain | draft `10399-fix10182` where 10182 is a PR (`fix(#10183)`), 10183 the real issue | `issueNumber=10183` after the PR->issue hop; others untouched (idempotent) |
| multi-issue body prefers title | `{prNumber:9311, title:'feat(#9193)...', body links #9241/#9237/#9238}` | `issueNumber=9193`; body Related Issues lists the rest |
| relatedFiles grounded | `{prNumber:10623, fileList has message.pipe.ts + reducers/tasks.ts, no services/user-contact.service.ts}` | `relatedFiles subset of fileList`; `services/user-contact.service.ts` rejected |
| confidence reflects quality | backport draft 9555 + a fallback-to-PR draft | `confidence 'low'` for backport/fallback vs `'high'` for a verified rich draft |
| host-anchored closing-ref URL | body link `https://github.com/attacker/medic/cht-core/issues/1` | rejected - only `startsWith https://github.com/medic/cht-core/issues/` passes (guards #129's relink fix) |

### Integration
| Name | Scenario | Success criteria |
|---|---|---|
| validate-schema flags PR-numbered issue | `{issueNumber:10198, source_pr:'medic/cht-core#10198'}` | fails: "issueNumber equals PR number - issue likely unresolved" |
| slug/issueNumber mismatch guard | filename slug `fix8026` but `issueNumber=10198` | promotion blocked |
| backport cluster collapses | `9027-fix8985` (original) + `9098-fix8985` (4.7.x cherry-pick) | one memory `id=cht-core-8985`, `source_prs=[#9027,#9098]`; extra -> `_skipped.ndjson` |
| epic maps to one issue | PRs 10793/10798/10799 all `fix(#10792)` | single canonical #10792 memory or explicit collision cluster; dedup on `issueNumber` |
| cherry-pick marker detection | `{prNumber:10082, body has '(cherry picked from commit ...)' and '#10068'}` | 10082 skipped/linked as backport of 10073; one memory for #10068 |
| cross-domain duplicate | issue #9835 distilled for contacts (#132) and auth (#131) | one domain owns #9835; other cross-references; no id in two promotion PRs |
| onboarding not mis-domained | PR #9512: `actions/global.ts`, `modals/training-cards/*`, `about.routes.ts` | `domainFit` weak for forms (or onboarding domain); reasoning names the routing/modal subsystem |
| no test-fixture audit rows | `_skipped.ndjson` line `{"prNumber":1,"reason":"LLM triage skipped"}` | CI rejects audit rows with `prNumber<=1` or a test run-id in a promotion PR |

### E2E
| Name | Scenario | Success criteria |
|---|---|---|
| no fabricated channel/reviewer | `reviewComments=[{author:'jkuester', body:'nit: handle null cursor'}]`, no Slack content | `designChoices` grounded in provided reviews; no "Slack" or unlisted reviewer named |
| boilerplate stripping preserves mechanism | issue #10912 (PHI HTML comment first, `docIds.add(...keys)` after char 500) + near-empty PR #10914 | after stripping, `rootCause` names the `Set.add` single-arg / dropped-ids mechanism |
| clean domainReasoning | borderline PR #10793 (`authorization.js`, replication symptom) | data-sync fit with no "Seed N" / "a reviewer could re-bin" language |

---

# Part 4 - Documentation updates

To accompany the next iteration (add to `docs/memory-seeding-runbook.md` or a new
`docs/memory-pipeline-design.md`):

- **known-limitations:** the scraper resolves issues only from body `Fixes/Closes/Resolves` and
  (pre-fix) missed both the CHT `type(#N):` title convention and `closingIssuesReferences`, so
  `buildFrontmatter` fell back to the PR number. Note the `/issues/N -> /pull/N` redirect that masks
  the error from inspection and validation, and the ~60/107 wrong-reference prevalence.
- **pipeline-behavior:** document the issue-centric-schema vs PR-driven-pipeline mismatch and the
  canonical resolution precedence (`closingIssuesReferences` > title `type(#N)` > body keyword >
  null/flag). State the invariant: `source_pr` always holds the PR; `issueNumber/issueUrl/id` hold
  the resolved issue, and a PR that closes no tracked issue is flagged/skipped rather than
  PR-derived. Explain the PR->issue hop via
  `gh-classify.ts`'s `pull_request` key (`gh issue view` never 404s on a PR number).
- **design-decisions:** `confidence` is currently hardcoded `'medium'` (not a signal - do not treat
  as ranking) and `related_issues` is `[]` pending a cross-link post-pass that does not yet run;
  the plan is to downgrade confidence on PR-number fallback and backports. Also record why #129
  relinked deterministically (metadata-only, 3 identity fields) rather than re-distilling - body
  content is independent of the linkage bug.
- **known-limitations (truncation):** record the limits (`BODY_LIMIT=4000`, `ISSUE_BODY_LIMIT=500`,
  `MAX_ISSUES=3`, `MAX_REVIEWS=3`, `REVIEW_BODY_LIMIT=300`) and the failure mode where un-stripped
  CHT template boilerplate (~246-char PHI HTML comment) consumes the budget, so a near-empty PR with
  all detail in the issue can lose its root-cause mechanism (10914). Note comment-stripping /
  adaptive limit as the fix.
- **memory-quality-guidelines:** distilled memories must (a) ground `relatedFiles`/`entities` in the
  PR's actual file list, (b) not name communication channels, reviewers, or approval/CI process
  trivia absent from the ingested review data, (c) name the concrete mechanism in `rootCause` when
  the source provides it, and (d) keep Domain Rationale free of pipeline-internal classifier
  reasoning. Canonical examples: 10623 (paths), 9311 (Slack), 10914 (mechanism), 10793 (leaked
  reasoning).
- **contributor-guidance:** document the de-duplication requirement (#135 acceptance item): collapse
  backport cherry-picks and multi-PR epics into one memory keyed on the resolved issue id with a
  `source_prs[]` array; detect backports via `(cherry picked from commit)` / trailing `(#M)` /
  `baseRefName`; detect cross-domain promotions (e.g. #9835 shared with #131). De-dup must run only
  after issue-id resolution is stable, or it keys on PR numbers and fails to collide.
- **eval-methodology:** document the spot-check procedure - verify linkage against the live cht-core
  API using the `pull_request` key to tell issues from PRs, and confirm every reviewer-attribution
  and verbatim-error claim is grounded. Each reviewer-caught case should become a fixed regression
  fixture; "31/44 wrong" is reproducible by sweeping frontmatter `issueNumber` against the filename
  `type(#N)` slug.

---

# Appendix - Per-PR detail

> Feedback categories: `missing-info`, `incorrect`, `hallucination`, `verbose`, `omitted-context`,
> `poor-prioritization`, `formatting`, `duplication`, `prompting`, `pipeline`, `ranking`, `schema`.
> Full machine-readable findings (per-PR JSON: feedback, root causes, improvements, eval cases,
> docs) were produced by the review workflow and are available on request.

## PR #132 - contacts (44 memories)
**Purpose:** promote 44 strong-fit contacts drafts. sugat009 requested changes on a corpus-wide
data-correctness defect, not any per-file content error. **Linked:** base #119; same bug flagged on
#121; #135 (de-dup consumer); cross-domain dupes with #131 (#9835/#9065/#6543).
- **[incorrect | sugat009]** 31/44 drafts: `issueNumber`/`issueUrl`/`id` name the merge PR. e.g.
  10043 stores `issueNumber:10043` (PR `feat(#10036):...`) but the real issue is #10036.
- **[duplication | sugat009]** #10038 x5, #10036 x4 (10070/10061/10056/10043), #8985 x2 (9027 + its 4.7.x backport 9098), etc.
- **[duplication | sugat009]** #9835/#9065/#6543 also promoted in auth #131 (cross-domain).
- **[hallucination | self]** 9311 `designChoices` cites "Reviewer discussion (jkuester, **Slack**)";
  the scraper has no Slack access - fabricated channel.
- **[omitted-context | self]** the body `## Related Issues` often holds the correct issue the
  frontmatter is missing (9311 lists #9193; 10043 lists #10036) - extracted to prose, not the field.
- **[schema | self]** the distilled drafts carry `confidence: medium`, `related_issues: []` (4 legacy `subDomain`-schema drafts carry neither field).
- **[missing-info | self]** 10897 has no `#N` in its title slug - a title-parse-only fix won't
  recover it (its `issueNumber:10878` came from the body).

## PR #131 - authentication (39 memories)
**Purpose:** promote 39 strong-fit auth drafts. **Linked:** blocking review by sugat009; #121, #135.
- **[incorrect | sugat009]** 19/39 mislinked (e.g. 8675 -> real issue #6530; 10414 -> #6784).
- **[duplication | sugat009]** #8868 promoted twice (8924, 8933); cross-domain #9835/#9065/#6543.
- **[incorrect | self]** `feat(na)` PRs (8843) fabricate `issueNumber:8843` + `/issues/8843`.
- **[pipeline | self]** the correct issue is available in three places `buildFrontmatter` never
  reads: PR title, the filename slug the distiller itself builds, and the LLM's own `relatedIssues`.
- **[pipeline | self]** scraper only parses body `Fixes/Closes/Resolves`; misses title + sidebar.
- **[missing-info | self]** 8933 title ends `(#8924)` - a strong "supersedes 8924" hint, unused.

## PR #130 - configuration (10 memories)
**Purpose:** promote 10 strong-fit; 18 weak deferred (config 64%-weak this run). **Linked:** #121,
#135, #119.
- **[incorrect | sugat009]** 4/10 mislinked (10198->#8026, 10278->#8027, 8722->#8075, 9407->#9406);
  verified against the live API; pipeline-wide 60/107.
- **[pipeline | self]** root cause = scraper body-only regex; the correct number is in the title
  (preserved in `slugify(prTitle)`), never read by frontmatter.
- **[duplication | self]** corpus id-scheme inconsistency - issue-keyed vs PR-keyed mix.
- **[omitted-context | self]** `.gitignore` leaked into 10198's Related Files from the 50-file slice.
- **[poor-prioritization | self]** 10604 (view-path, could re-bin to data-sync) and 11021
  (config-watcher, config vs infra) promoted as strong with no gradient.
- **[POSITIVE | self]** distillation faithful - three reviewer-attribution claims verified against
  the API (witash/m5r); truncation not causing embellishment here.

## PR #129 - data-sync (14 memories) - *partial fix already shipped*
**Purpose:** promote 14 data-sync drafts + carry the upstream linkage fix (`gh-classify.ts`,
`issue-linkage.ts`, `relink-issues.ts`). **Linked:** #135, #121, #119.
- **[pipeline | sugat009]** 6/14 mislinked (8773->#6299, 10776->#10749).
- **[pipeline | sugat009]** the relink "affected" predicate (`issueNumber === source_pr`) was
  narrower than the bug - missed nested `10399 -> 10182(PR) -> 10183`.
- **[duplication | self]** #10792 promoted 3x (10793/10798/10799), all `id: cht-core-10792`.
- **[missing-info | self]** 10914 Root Cause vague - issue #10912's `docIds.add(...keys)`/`Set.add`
  single-arg mechanism was truncated away by `ISSUE_BODY_LIMIT=500` (PR body was just `Fixes: #10912`).
- **[verbose | self]** 10793 Domain Rationale leaks "cf. Seed 4 ... a reviewer could re-bin".
- **[schema | sugat009]** `id` "Unique identifier" wording can't hold when N PRs close one issue
  (softened in-PR).
- **[pipeline | sugat009]** `gh issue view <N>` succeeds on a PR number -> the `pull_request` API key
  is the only reliable disambiguator (basis of `gh-classify.ts`).
- **[other | sugat009]** relink regexes hardcoded `medic`/repo names; closing-ref URL match was an
  unanchored substring (matched `github.com/attacker/medic/cht-core/issues/1`). Both fixed.
- **[missing-info | sugat009]** `tokenMismatch=true` audit-override path had no test (added via the
  10399 regression).

## PR #123 - tasks-and-targets (35 memories)
**Purpose:** promote 35 strong-fit. **Linked:** #119; sugat009 flagged merge conflicts (rebase).
- **[schema | self]** 15/35 point to a PR not an issue (9553 -> real #9552, etc.).
- **[duplication | self]** backports distilled standalone: fix9552 -> 4 files (2 real fixes);
  feat9431 -> 2 files. 9555's own Testing admits "Backported to 4.13.x via cherry-pick of dc47c51".
- **[duplication | self]** epic siblings correctly kept separate but **not** cross-linked
  (9232/9282/9317 all fix #9231; `related_issues: []`). *Collapse backports, cross-link epics.*
- **[hallucination | self]** 10623 lists `services/user-contact.service.ts`, which is absent from
  the PR (its `message.pipe.ts`/`reducers/tasks.ts`/`reducers/global.ts` are all real).
- **[pipeline | self]** body-only, keyword-only resolution can also grab a wrong issue
  (9232 resolved a stray #137).
- **[missing-info | self]** uniform `confidence: medium` - backports and hallucination-risk entries
  rank equal to verified ones.

## PR #122 - forms-and-reports (47 memories)
**Purpose:** promote 47 strong-fit. **Linked:** #119; Hareet + sugat009 (rebase).
- **[duplication | self]** 7 files = 3 fixes ({8746,8748,8752}=#8745; {9434,9436}=#9429;
  {9608,9610}=#9604). 8748 even documents itself as a 4.4.x cherry-pick.
- **[schema | self]** title-only PRs -> `issueUrl` points at the PR (8746 -> real #8745).
- **[missing-info | self]** scraper misses CHT's dominant title convention entirely.
- **[poor-prioritization | self]** onboarding/training-card PRs (9512, 9592 - route guards, modals,
  i18n) mis-domained as strong forms-and-reports; only 10290 (edits `forms/training/*.xlsx`) is
  defensible.
- **[schema | self]** `relatedWorkflows` (camelCase draft) vs `related_workflows` (snake_case
  frontmatter); `source_sha` + title `(#NNNN)` backport markers captured but unused.

## PR #121 - infrastructure (49 memories)
**Purpose:** promote 49 strong-fit (new domain from #119). **Linked:** #119, #126/#127; Hareet +
sugat009 (rebase).
- **[duplication | self]** nouveau-sidecar from #10482 **and** #10488 (both issue #10481). (CouchDB
  3.5.0 #9960/#10014 close *different* issues - #9882 vs #10027 - so they are duplicated effort, not
  a single-issue backport pair.)
- **[pipeline | self]** no cross-PR dedup anywhere.
- **[schema | self]** ~12/49 close no issue (8693, 10689, 10488) -> PR number labeled as an issue.
- **[omitted-context | self]** memories lean on review content but `MAX_REVIEWS=3` x 300 chars drops
  decisive reviewer context on heavily-discussed PRs.
- **[schema | self]** uniform `confidence: medium` across 49 drafts - no ranking signal.
- **[other | self]** `relatedWorkflows` over-applied - 9074 (deploy tooling) tagged `observability`
  for a log helper.

## PR #120 - messaging (17 memories)
**Purpose:** promote 17 strong-fit. **Linked:** #119; Hareet + sugat009 (rebase).
- **[duplication | self]** 3 backport pairs promoted as 6 files (10073/10082=#10068;
  10230/10243=#10225; 10803/10811=#10802); bodies literally say "(cherry picked from commit ...)".
- **[schema | self]** identity fields inconsistently issue vs PR (10442 -> real #10428/#10446).
- **[omitted-context | self]** ephemeral process noise baked in - reviewer logins, "LGTM", "two
  rounds of feedback", "missing chai-exclude dependency", "unrelated pre-existing e2e failure".
- **[verbose | self]** 10442 `rootCause` embeds a hedged e2e-flakiness dev narrative.
- **[pipeline | self]** `_skipped.ndjson` committed with 7 test-scaffold rows (all `prNumber:1`,
  2026-06-16) - leftover fixture noise in a promotion PR.
- **[missing-info | self]** `relatedIssues` records the true issue while `issueNumber` uses the PR -
  a detectable in-file contradiction the pipeline never flags.
