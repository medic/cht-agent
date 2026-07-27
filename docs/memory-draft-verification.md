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

Those need the source tree at the PR's merge commit. That is `ground-claims.ts`
(operator-run, needs a cht-core checkout); this script deliberately stays
hermetic so it can gate CI.

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
