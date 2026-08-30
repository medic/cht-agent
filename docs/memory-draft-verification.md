# Verifying agent-memory drafts

> **Running a review round?** This file is the reference for what each checker
> does. `memory-review-runbook.md` is the operational counterpart — order of
> operations, the invocations that cost time when wrong, the convergence bar, and
> the claim-verification protocol.

`npm run validate-schema` proves a draft is well-**shaped**. It cannot prove the
shape is **true**. Both defect classes below passed schema validation and CI
green, and were caught by a human reading 163 drafts against the cht-core source:

- **Identity.** `issueNumber` held the number of the merge PR rather than the
  issue it closed, on ~60 of the first 107 drafts. Invisible to any URL check,
  because `github.com/.../issues/<pr-number>` silently redirects to `/pull/`.
- **Fabricated detail.** Drafts named symbols that do not exist in cht-core:
  `con_create_people` (real: `can_create_people`), `docs_by_type` (real:
  `doc_by_type`), `task.status` (real: `task.state`), a `getOidc` handler (real:
  `oidcLogin`), an `isDue()` helper that exists nowhere.

`npm run verify-drafts` closes the part of that gap a machine can close on its
own, without a cht-core checkout and without an LLM.

## What it checks

| Check | Severity | Catches |
|---|---|---|
| `identity-alias` | blocking | `issueNumber` equal to the draft's own `source_pr` |
| `identity-incoherent` | blocking | `id` / `issueNumber` / `issueUrl` naming different issues |
| `filename-issue-mismatch` | blocking | filename issue token contradicting frontmatter |
| `duplicate-issue` | blocking | two drafts claiming one issue, incl. against the landed corpus |
| `vocab-near-miss` | blocking | a symbol 1–2 edits from a real cht-core term |
| `missing-frontmatter` | blocking | an unkeyed file (`validate-schema` skips these) |
| `unparseable-frontmatter` | blocking | YAML that does not parse |
| `process-leakage` | warning | classifier/review scaffolding left in the prose |
| `uniform-domain-fit` | warning | every draft self-reporting `domainFit: strong` |
| `related-issues-empty` | warning | `related_issues` never backfilled anywhere |
| `fit-mismatch` | blocking | frontmatter `domainFit` disagreeing with the `**Fit:**` line |
| `related-issues-desync` | warning | `## Related Issues` cross-links issues the frontmatter omits |
| `missing-domain-rationale` | warning | a distilled draft with no Domain Rationale section |
| `issue-number-is-pr` | blocking, `--online` only | `issueNumber` that is really a PR |

## What it does NOT catch

A green run is **not** a claim that a draft's prose is true. By construction it
cannot see:

- **A fabricated symbol that is not a near-miss of a real one.** `getOidc` is not
  within two edits of `oidcLogin`, so nothing here flags it.
- **Misattribution.** `updateServiceWorker` is a real exported function; the
  draft credited it to the wrong file. The token check passes.
- **Inverted semantics.** Draft 9281 said an AsyncGenerator yields *pages*; it
  yields documents. Every symbol it names is real.
- **Mechanism claims.** "added alongside `add-branding-doc.js`, preserving the
  original" — when the PR in fact *deleted* that file.
- **Version and backport claims.** "backported to the 4.1.x line" when the
  backport was 4.13.x.

Those need the source tree at the PR's merge commit. That is `ground-claims`,
below; this script deliberately stays hermetic so it can gate CI.

## Running it

```sh
# whole corpus, offline — what to run while editing drafts
npm run verify-drafts

# only this branch's drafts, as CI runs it
npm run verify-drafts -- --changed-only --base origin/main

# add the network issue-vs-PR check — run this before pushing a promote branch
npm run verify-drafts -- --online

# scan a different worktree's corpus without switching branches
npm run verify-drafts -- --dir /path/to/other-worktree/agent-memory
```

Exit codes: `0` clean, `1` at least one blocking finding, `3` only online checks
went unverified (a throttled `gh` never reports a pass).

**Authenticate before running `--online`.** `gh-classify` asks `gh api` first and
falls back to anonymous `curl`, so the tier works on a host with no `gh` at all —
but anonymously it gets GitHub's **60 requests/hour**, and a single 37-draft
domain exhausts that. The run then reports `unverified` counts that read like
content problems and exits `3`. Export a token — any read-only PAT will do — and
the same scan returns `0 unverified` and exits `0`:

```sh
GH_TOKEN=<read-only PAT> npm run verify-drafts -- --dir <dir> --online
gh api rate_limit --jq '.resources.core'   # 5000/hour authenticated, 60 without
```

Measured on contacts: three consecutive anonymous runs each left 3–4 drafts
unverified and needed an hour's wait between them; the authenticated run cleared
all 37 in one pass. Nothing about the corpus changed in between.

## The vocabulary snapshot

`vocab-near-miss` compares against `agent-memory/indices/cht-core-vocab.json`, a
committed snapshot of real cht-core terms grouped into families (permissions,
CouchDB view names, scheduled-task fields). A candidate token is compared only
against its own family, which is what keeps false positives low.

The snapshot is committed so CI needs no cht-core checkout. It records the commit
it was mined from, so staleness is visible rather than silent. Regenerate it when
cht-core adds vocabulary:

```sh
npm run build-vocab -- --cht-core /path/to/cht-core
```

Regeneration is a deliberate, reviewable commit: it changes what the gate
considers real.

---

# Layer 2: `ground-claims`

Where Layer 1 reads only the draft, `ground-claims` reads the **source**. It runs
operator-side, before pushing a promote branch.

```sh
CHT_CORE_PATH=/path/to/a/current/cht-core \
LLM_PROVIDER=claude-cli \
  npm run ground-claims -- --changed-only --base origin/main --label promote-messaging
```

Keep that checkout **fetched**. A stale clone does not produce wrong answers — an
unresolvable anchor reports `unverifiable`, never a pass — but it converts
decidable claims into undecidable ones, and the `file-touched` and
`release-branch` claims it gives up on are exactly the mechanism and backport
claims that are hardest to catch by reading.

`LLM_PROVIDER=claude-cli` runs on the operator's Claude subscription — no API key.
Budget roughly **40 seconds per draft**; `--concurrency 3` is the default and
`--limit N` smoke-tests the prompt cheaply before committing to a full branch.

## Two stages, and why they are split

1. **Extraction (LLM).** A model reads the draft and reports what it *asserts* —
   identifiers, file attributions, "the PR changed X", backport lines. It is told
   explicitly never to judge truth and never to correct a spelling, because a
   silently corrected symbol is a lost defect.
2. **Adjudication (git).** Every extracted claim is settled by `git grep -F -w`,
   `git diff-tree --name-status`, `git ls-tree`, or `git branch --contains`.

The model decides *what was claimed*; git decides *whether it is true*. An LLM
verdict can flip between runs on identical bytes — which is precisely why a
"review this draft" prompt is not trustworthy enough to act on, and why this is
not a CI check.

## What a claim can be

Every claim is one of these shapes, and each is settled by one git command. The
first five are what a draft asserts *exists*; the last three are the ones a
reader cannot check by eye, and each was added after a review round found the
class it catches.

| Kind | The draft is asserting | Settled by |
|---|---|---|
| `symbol` | this identifier exists at the anchor | `git grep -F -w` |
| `symbol-in-file` | …and lives in this file | `git grep -F -w -- <file>` |
| `literal-in-file` | this **quoted literal** is in this file | `git grep -F` / relaxed `-E`, then the rest of the tree |
| `path-exists` | this path exists at the anchor | `git ls-tree` |
| `file-touched` | this PR added / modified / deleted it | `git diff-tree --name-status` |
| `release-branch` | it was backported to this line | `git branch -r --contains`, plus a cherry-pick search |
| `introduced-by` | **PR #N** put this symbol there | the symbol's absence at #N's parent, per file |
| `sha-unreachable` | this **commit** cannot be reached | `git for-each-ref --contains` |

### Literals: the mechanism sentence nothing could check

A symbol has to be identifier-shaped, so every selector, query string and object
literal a draft quotes went unchecked. #122 round 4 found the consequence: the
standalone `webapp/web-components/cht-form/src/app.component.ts` was said to
"look it up as `` `instance[id="contact-summary"]` ``". That selector is in
exactly one file on master — `webapp/src/ts/services/form.service.ts:105` — and
every identifier in the sentence is real, so no existence or coherence check
could see it.

A literal is now bound to the one file its own sentence names and grepped there.
Two tolerances, because source and prose legitimately differ:

- **whitespace**, since source wraps an object literal across lines;
- **interpolation**, since prose writes the value where the code has a variable.
  form.service.ts spells it `` `instance[id="${instanceId}"]` ``, so a plain
  `-F` search finds the draft's spelling in *neither* file and cannot tell them
  apart. The tolerance is guarded: the substituted value must itself appear in
  that file, or `instance[id="anything"]` would match and a fabricated selector
  would come back "found" with a confidently wrong suggestion.

**Absence is not a defect here.** A literal that occurs nowhere is
`unverifiable`, not `ungrounded` — prose normalises source constantly, and whole
documented classes (XLSForm column headers, placeholder templates) can never be
grepped. Only a literal that is real *somewhere else* is a finding, and the
report names where. Such a claim also carries its `unverifiable` into the
pre-fix / "before this PR" / "on master" retries, which otherwise fire only on
`ungrounded`: 10133 describes the read its own PR deleted, and the parent has it.

Extraction is screened against measured false positives: a call suffix is a
symbol (`getCurrentHref()` is declared `const getCurrentHref = () =>`), an
invocation is not file content (`npm run unit-webapp`, `UNIT_TEST_ENV=1`), and a
backticked English phrase is not code.

### The list regions: enumerated, never sampled

Three regions of a draft are lists, not prose: frontmatter `entities:`,
frontmatter `concepts:`, and the `## Related Files` bullets. One bullet is one
assertion, so nothing about them needs a model — and for a long time nothing but
the model read them. At ~2/3 recall a pass, that is how two drift defects
survived **five clean full-corpus passes** and were caught only on the eighth
cumulative sample:

- `10784` — `concepts: - prepareForSave lifecycle hook`. The hook is real at that
  PR's commit and was deleted from master by `cccce201e` (#11256). It was caught
  in the end only because the body *also* backticks `prepareForSave`; a concept
  named only in the list had nothing looking at it.
- `9512` — `## Related Files - webapp/src/ts/app.module.ts`, deleted on master by
  `a1730c4b1` (#9784).

All three regions are now enumerated exhaustively. What a bullet *is* differs
between them, and the rules differ with it:

| Region | A bullet is | Emits |
|---|---|---|
| `entities:` | one code entity | `path-exists` when path-shaped, `symbol` when identifier-shaped |
| `concepts:` | a prose phrase that may embed code | `symbol` per identifier-shaped **token** |
| `## Related Files` | a path the PR changed | `file-touched`, downgraded to `path-exists` when the bullet disclaims the edit |

`concepts:` carries no backticks, so it gets a stricter code signal than a
backticked span does: `snake_case`, a dotted member path, a `()` call suffix, or
lowerCamelCase. Requiring a **lowercase first character** is what earns its keep
— the ordinary "any internal case change" rule reads `CustomEvents` out of
*"library-supplied event factories over hand-built CustomEvents"* and probes a
prose plural of a DOM interface as a cht-core symbol, which is absent and would
be filed as a defect. `datasource abstraction layer` emits nothing at all, which
is the point.

An `entities:` bullet is tested whole, so `_design/medic-client`,
`shared-libs/validation` and `api/src/services/replication/` emit nothing: a
directory or a ddoc id is neither a path `ls-tree` can find nor a string that can
be in a file. A bare lowercase word is also left alone, on the same call the
module makes for a bare backticked word — `purging` is as likely to be the
concept as the export.

**The annotation governs its own bullet and no other.** A claim's quote is the
bullet's own line, so the existing `ABSENCE_CONTEXT` / `NOT_TOUCHED` screens read
`(removed on master by the #10700 save-workflow rewrite, cccce201e)` or
`(present at this PR's anchor; removed on master by …, #9784)` and suppress that
entry, while an unqualified entry three lines down still gets probed. That is
exactly the difference between the two fixture pairs in
`test/scripts/claim-probes.real.spec.ts`: `bdbf090` flags, `aa398b0` does not.

### A commit the draft says is gone

The mirror image: a **negative** existence claim, and the only one git settles in
a line. #122 round 4 shipped a repair asserting that
`70b7be0b4f0394b22f7d24b5fd1b824fdef0aa87` was "absent from a clone because the
epic squashed it away". The commit is in the clone, reachable from
`refs/verify/pr10083` — a fetched `refs/pull/10083/head`, which is exactly the
ref `git branch --contains` cannot see.

Settled in one direction only:

| What git says | Verdict |
|---|---|
| some ref contains it | `ungrounded`, naming the ref |
| the object is not here | `unverifiable`, with the `git fetch refs/pull/N/head` that would settle it |
| present but dangling | `unverifiable` — unreferenced *here* is not absent from the repository |

A clone holds only the refs somebody fetched, so "I do not have it" and "it does
not exist" are different sentences. Conflating them is what wrote the defect.

## Outcomes

| Outcome | Meaning |
|---|---|
| `grounded` | the probe confirms the claim |
| `ungrounded` | the probe contradicts it — a defect to fix |
| `unverifiable` | the probe could not run. **Not a pass.** |
| `anchor-unusable` | the anchor is a revert, so it cannot evidence the change |

Each verdict also carries a **provenance**: `anchor` (proven at the draft's own
commit — settled) or `fallback` (the anchor would not resolve, so the claim was
checked against `origin/master`). Absence under `fallback` still refutes a
fabricated symbol, but cannot distinguish "never existed" from "existed then was
removed", so treat it as strong evidence rather than proof.

## Stale as written

A fifth thing a verdict can carry, and it is not an outcome: **drift**. The claim
is `grounded` — true about its own PR — and names something the current tree no
longer has, with no temporal qualifier. Checking only the anchor certifies it and
checking only master refutes it; both are wrong. The defect is in how a reader
will take it, because an agent consuming the memory reads an unqualified path or
symbol as current.

Reported for `path-exists`, `file-touched`, `symbol`, `symbol-in-file` (its file)
and `literal-in-file`, in the report's own section and in the `--added-lines`
gate, and it exits `3` rather than `1`: nothing is disproven.

A finding is settled by time-scoping the entity **anywhere in the draft** — one
honest mention is enough, since demanding the caveat in every sentence is how a
correct draft gets churned. Both spellings work:

```yaml
  - prepareForSave lifecycle hook (removed on master by the #10700 save-workflow rewrite, cccce201e)
  - webapp/src/ts/app.module.ts (present at this PR's anchor; removed on master by …, #9784)
```

Read the finding before acting on it: "absent from `origin/master`" has three
causes and only two are drift.

- **The path moved.** #10823 pulled `api/src/services/{authorization,replication,
  bulk-docs,db-doc,purged-docs}.js` into `api/src/services/replication/`, so 14
  findings across 7 data-sync drafts are one directory reshuffle. Real drift, and
  the fix is the annotation, not a new path.
- **It was deleted.** `webapp/src/ts/app.module.ts` (#9784),
  `analytics-target-aggregates-sidebar-filter.component.html` (#10423).
- **The anchor is not on master at all.** Check
  `git merge-base --is-ancestor <anchor> origin/master` first. `10390`'s seven
  `target-interval.*` findings all anchor at `60ca9634fc`, which no remote branch
  contains — the work never landed, which is a *provenance* problem and a much
  bigger one than a missing caveat.

## Attribution: "added" vs "modified"

The probe for a `file-touched` claim compares the status the prose asserts
against the PR's real file list, so "a new mocha harness was added (…)" is a
defect when the PR's own diff deletes those files. That check is only as good as
the extractor: it fires when a claim carries `status`, and for three review
rounds nothing set one, so it never ran. `enumerate-claims` now infers the status
deterministically, which is what makes this class caught on every run rather than
whenever the model volunteers it.

Inference is deliberately narrow, because a false "this is fabricated" costs more
than a missed check. A status is only read when the file itself is the object of
a create/delete verb — the verb precedes the path, sits within ~90 characters and
the same clause, and the path is not the object of a locating preposition. That
last rule is the load-bearing one: *"added a `dbQuery` wrapper in
pouchdb-provider.js"* creates a symbol inside a file the PR **modified**.
Measured over the tasks-and-targets batch, a screen keyed on verb-near-path
produced 64 hits of which 63 were that shape; the rules above reduce it to 6
inferred statuses, all confirmed by the PR file lists, while still reproducing
the #10436 defect from the pre-fix text.

## Backports: the pick does not carry the PR number

`branch -r --contains <anchor>` can never see a backport, because a cherry-pick is
a different commit. The probe therefore also searches the release branches for a
commit referencing the PR — the draft's own, and any PR number quoted in the
sentence ("backported to 4.13.x (PR #9555)").

Neither is guaranteed to be there. cht-core stamps the **issue** in the subject and
marks the pick with a bare `(backport)` suffix, so #9608's real backport reads

```
69ae8c0ab fix(#9604): fix integer validation in sms rules (backport)
```

at the tip of `origin/4.14.x` — while the draft's own PR is #9608 and its sentence
names the backport PR #9610. Both searches missed, and a true backport was reported
as invented. What a cherry-pick *must* carry is the original subject, so the anchor's
own subject is now mined for the reference it was stamped with, and the refusal
message lists every reference it searched rather than only the draft's PR.

## Gating the delta: `--added-lines`

A full sweep is **sampled** — extraction sees 61–67% of what is checkable per
pass, which is why the convergence bar is three clean passes. Meanwhile the
defects that survive are the ones the *repairs* write: on #122, three of the
seven round-3 items came from the round-2 remediation, and round 4 found two
more. A replacement sentence is unverified prose.

```sh
CHT_CORE_PATH=/path/to/cht-core npm run ground-claims -- \
  --added-lines --dir <promote-worktree>/agent-memory --base <last-clean-gate>
```

- **No LLM.** Deterministic enumeration only, so it is exhaustive over
  code-shaped claims in the delta and says nothing about semantic ones. It costs
  seconds, so run it after every commit rather than once a round.
- **The repo comes from `--dir`** (`git -C <dir> rev-parse --show-toplevel`),
  which is why this is not `--changed-only`. That flag diffs in the repo running
  the tool, and the tools live on a branch with no drafts.
- **A dirty tree is refused.** A verdict is evidence about specific bytes, and an
  uncommitted edit is both undiffable and uncitable — its new sentences would be
  silently out of scope.
- **Scope is applied by masking, not filtering.** A claim's quote is the first
  line where the enumerator saw its token, so filtering quotes against added
  lines reported the 10180 repair as "3 added lines, 0 claims" while its added
  paragraph named eight symbols. The gate enumerates from the draft with
  untouched lines blanked and the `## Headings` kept, so every quote is an added
  line by construction and section-dependent claim kinds still work.
- Exit `1` on any `ungrounded`, `3` when only `unverifiable` / `anchor-unusable`
  remain. `unverifiable` items are printed: they are unchecked sentences, not
  passes.

## Known blind spots

Four things this layer does not settle, the first three found while grounding
tasks-and-targets and the fourth while grounding forms-and-reports, all worth
knowing before trusting a green run:

- **Symbol attribution.** A `symbol` claim asks whether an identifier exists at
  the anchor, not which PR introduced it. #10324 credited itself with the
  sidebar's `telemetryKey` input; the input is real, so every probe passed, but
  #10371 added it. Catching this needs the PR's own added lines, not the tree.
- **Counterfactuals.** "The type was kept as `target` rather than
  `target-interval`" asserts that the second name does *not* exist, and the
  probe reports the absence it finds as `ungrounded`. `ABSENCE_CONTEXT`
  deliberately excludes "rather than"/"instead of", because Design Choices uses
  them constantly for things that do exist, so this is a known trade rather than
  a bug.
- **Placeholder literals.** A backticked template written with its holes spelled
  out — `` `sidebar_filter:analytics:<telemetryKey>:reporting-period:select` `` —
  can never be found by a literal `git grep`. Quote the real template literal
  instead.
- **Identifiers that live in binary form sources.** An XLSForm *column header* —
  `instance::cht:duration`, `instance::cht:unique_tel` — exists only inside the
  zipped XML of an `.xlsx`, so `git grep` over the tree cannot see it and the
  probe reports it as fabricated. Both were filed as ungrounded on
  forms-and-reports and both are real; the proof is to unzip the fixture:

  ```sh
  git -C $CORE show origin/master:tests/e2e/default/enketo/forms/phone_widget.xlsx > pw.xlsx
  unzip -q -o pw.xlsx -d pw && grep -o 'instance::[^<"]*' pw/xl/sharedStrings.xml | sort -u
  #   instance::cht:unique_tel
  ```

  The *downstream* artefacts are greppable — the header becomes `cht:unique_tel`
  in the generated XForm instance and `data-cht-unique_tel` on the rendered
  question — so a draft that also names one of those gives the probe something it
  can settle. Naming only the column header does not.

## Anchor resolution, and why it often fails

In order: `source_sha` if that commit is present locally, then the squash-merge
subject (`git log --all --fixed-strings --grep='(#<PR>)'`), since cht-core stamps
the PR number there. Two reasons it still fails:

- **`source_sha` is frequently a PR-head commit** that squash-merge discarded, so
  it never lands on `master`.
- **cht-core does not stamp every PR number** into a subject. The SSO cluster
  (#9833, #9900, #9901) has no `(#N)` subject anywhere, even though the code is
  plainly in the tree.

Both are why the `fallback` ref exists — and fetching does **not** fix the second
one. Measured against a same-day clone, `#9833`, `#9900`, `#9901`, `#11021`,
`#11057` and `#9281` still resolve to nothing, because those PR numbers are
stamped nowhere in history.

### A cluster has more than one anchor

A hand-authored or collapsed draft carries `source_prs[]` and its prose spans
every PR in the cluster — but the canonical anchor is only the **first** entry.
A symbol the fifth PR introduced does not exist at the first PR's commit, so
judging it there reports a real, present identifier as fabricated. `file-touched`
already consulted the siblings; `symbol`, `symbol-in-file` and `path-exists` did
not, and settled at the canonical anchor alone.

On contacts, one draft made the cost concrete: `9835` lists five `source_prs`,
resolved to #10022 (the earliest), and returned **12 ungrounded claims — every
one of them false**. `minifyDoc`, `assertSameParentLineage`, `getUpdatedContact`,
`createDoc`, `updateDoc`, `ResourceNotFoundError`, `assertPermissions` and
`postResource` are all real on master, in exactly the files the draft names; they
simply arrived in #10081/#10083/#10222/#10246. Tree-scoped claims now retry at
each sibling anchor before being called ungrounded, and say which sibling settled
them. A single-PR draft has no siblings, so no verdict there changes.

That makes an unresolvable anchor worth a second look rather than a shrug. Two
of the three configuration drafts that would not anchor turned out to have real
problems a reader would not spot: one describes a feature that is not on master
at all (no dispatch branch, no commit referencing its issue), and one describes a
real mechanism that actually arrived under a different PR number. An anchor that
will not resolve on a current checkout is weak evidence that the draft's
provenance is wrong.

## Reports

Written to `outputs/verification/<label>/` — `outputs/` is gitignored, and reports
must **never** be moved under `agent-memory/`, where a future agent would load a
verification artifact as domain knowledge. Each report is stamped with a
**content hash** of the draft bytes, so a promotion gate can later refuse a
report that no longer matches the draft it claims to verify.

Exit codes: `1` any ungrounded claim, `3` only unverifiable / anchor-unusable
claims, `0` fully grounded.
