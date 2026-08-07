# Verifying agent-memory drafts

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

## Known blind spots

Three things this layer does not settle, all found while grounding
tasks-and-targets and all worth knowing before trusting a green run:

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
