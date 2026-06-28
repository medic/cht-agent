# Langfuse smoke-test runbook (#126)

The one open item that closes #126. Everything else (build, lint, 419 tests, 100%
observability coverage) is already green; this proves the integration works against
**real** Langfuse Cloud — which CI and unit tests deliberately cannot do
(`LANGFUSE_ENABLED=false`).

**Who runs this:** you (Hareet). It needs real Langfuse keys + network + OpenRouter
credits, none of which exist in the build/CI environment.

**Branch:** `126-langfuse-refactor` (worktree `.claude/worktrees/126-langfuse`).

---

## What we are proving

1. **Traces appear.** A real pipeline run produces a `memory-pipeline-pr` trace in
   Langfuse Cloud with a nested `scrape` span and `filter` / `distill` generations
   carrying token counts and cost.
2. **The bug is actually fixed.** Reprocessing the *same* PR (which the scheduled
   `--since` lookback does on overlap) must **not** corrupt session grouping. With
   Langfuse-generated trace IDs, each reprocess is a new trace under its own session
   — never an overwrite of the prior run. This is the regression the refactor
   targets; the smoke test is the only place it can be confirmed end-to-end.
3. **Scores land.** `distill-outcome` = 1 for written, 0 for flag-for-human/error.

---

## Prerequisites

| Need | Where to get it |
|---|---|
| Node 22 | `nvm use v22.18.0` (or invoke the v22 binary directly) |
| Langfuse keys | A project at https://cloud.langfuse.com → Settings → API Keys (`pk-lf-…`, `sk-lf-…`) |
| OpenRouter key | `OPENROUTER_API_KEY` — real LLM calls cost a few cents per PR |
| gh CLI auth | `gh auth status` — the scraper shells out to `gh` |

---

## Setup

```bash
cd .claude/worktrees/126-langfuse
nvm use v22.18.0
cp .env.example .env          # then edit .env:
#   LANGFUSE_PUBLIC_KEY=pk-lf-...
#   LANGFUSE_SECRET_KEY=sk-lf-...
#   LANGFUSE_HOST=https://cloud.langfuse.com
#   OPENROUTER_API_KEY=sk-or-...
#   (leave LANGFUSE_ENABLED commented out — tracing is on by default when keys exist)
npm ci
```

> **Heads-up — a real run dirties tracked files.** The pipeline writes skip/flag
> entries to `agent-memory/_skipped.ndjson` and any drafts to
> `agent-memory/_pending/<domain>/`. Both are tracked. After the smoke test,
> `git checkout -- agent-memory/_skipped.ndjson` and remove any throwaway drafts so
> they don't leak into the PR. Prefer a PR that the filter is likely to **skip**
> (avoids generating a draft) for the cleanest run.

---

## Step 1 — single PR, confirm traces appear

Pick a small, already-merged cht-core PR. Run it once:

```bash
LANGFUSE_ENABLED=true npm run run-pipeline -- --pr <PR_NUMBER>
```

Then in Langfuse Cloud → your project → **Traces**, confirm one trace named
`memory-pipeline-pr` with:

- [ ] **input** = `{ prNum, repo, url }` only — **no** raw PR body/diff (PII check)
- [ ] **tags** = `[memory-pipeline, medic/cht-core]`
- [ ] child **span** `scrape` with `output.fileCount`
- [ ] child **generation** `filter` with a model name + **token counts + cost**
- [ ] child **generation** `distill` *(only if the filter decided "distill")*
- [ ] a **score** `distill-outcome` (1 written / 0 flagged) when distill ran
- [ ] the trace **id is a Langfuse UUID**, NOT `pipeline-pr-medic-cht-core-<n>`

---

## Step 2 — the regression: reprocess the SAME PR

This is the core of the smoke test. Run the **same** PR number a second time:

```bash
LANGFUSE_ENABLED=true npm run run-pipeline -- --pr <PR_NUMBER>   # same PR again
```

Now in Langfuse → **Sessions** (and Traces):

- [ ] **TWO distinct traces** exist for that PR, each with its **own** id and its
      own session — the second run did **not** overwrite or merge into the first.
- [ ] Neither session shows the corrupted/overwritten grouping the old PR-derived
      id caused. (Sanity: with the old code, both runs reused the same trace id, so
      the second silently clobbered the first's session linkage.)

If both runs show up cleanly as separate traces → **the bug is fixed and #126's
acceptance criteria are met.**

---

## Step 3 — multi-PR run shares one session

Confirm the session-grouping design (one UUID per `runPipeline` invocation):

```bash
LANGFUSE_ENABLED=true npm run run-pipeline -- --since 48
```

- [ ] All traces from this single invocation share **one** session ID in the
      Sessions view; traces from Step 1/2 (separate invocations) do **not**.

---

## Step 4 — disabled path still no-ops

Belt-and-suspenders (already covered by unit tests, but verify live):

```bash
LANGFUSE_ENABLED=false npm run run-pipeline -- --pr <PR_NUMBER>
```

- [ ] Pipeline runs to completion identically; **no** new trace appears in Langfuse.

---

## Cleanup

```bash
git checkout -- agent-memory/_skipped.ndjson
git status --short    # ensure no stray _pending drafts staged for the PR
```

---

## Sign-off

When Steps 1–4 pass, #126 is done: traces are collecting in production and the
session-grouping regression is closed. Update PR #127 / the follow-up PR description
with a link to a representative trace, and hand the trace store to the evals work
(see `docs/handoffs/126-langfuse-followups.md`).
