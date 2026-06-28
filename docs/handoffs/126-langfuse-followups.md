# Langfuse follow-up issues (post-#126)

#126 / PR #127 is scoped to **PoC instrumentation of the memory pipeline** + a proven
live smoke test. The handoff doc's "where to go next" lists five build-on-it items
that must **not** expand #126. Draft them as separate issues here; file after the
smoke test closes #126.

Ordering rationale: dashboards first (no code, immediate value), eval datasets next
(the bridge to kombo's evals work), then agent instrumentation (ties into the
Research Supervisor demo), then prompt versioning and alerting.

Shared design constraints every issue inherits (do not re-litigate):
- Langfuse stays a **passive observer** — never gates pipeline behavior.
- No-op when `LANGFUSE_ENABLED=false`.
- **SDK v3, not v5** (v5 OTEL drops non-LLM spans like `scrape`).
- Trace input = identity only, no PII. Mask before reuse on private data.
- New workflows follow the `startTrace` pattern in `docs/observability.md`.

---

## Issue 1 — Langfuse dashboards for the memory pipeline

**Type:** enhancement · **Depends on:** #126 (traces flowing) · **Effort:** S (UI-only)

**Problem.** Traces exist but there's no at-a-glance view of pipeline health or cost.

**Scope.** Configure Langfuse Cloud dashboards (no code):
- Cost per PR and cost per model tier (triage vs. distill), trend over time.
- Filter-decision distribution (distill / skip / flag-for-human).
- Distill success rate (`distill-outcome` score = 1).
- Latency by stage (scrape / filter / distill).

**Acceptance.** A shared dashboard URL; a screenshot or short doc in
`docs/observability.md` under a "Dashboards" section showing the four views populated
from real traces.

**Notes.** Pure configuration; good first task for a non-code contributor.

---

## Issue 2 — Curate an evaluation dataset from the trace store

**Type:** feature · **Depends on:** #126 · **Effort:** M · **Owner:** evals workstream (kombo)

**Problem.** We have no labeled baseline to evaluate memory (distillation) or codegen
quality against. The trace store now contains real pipeline inputs/outputs that can
seed one.

**Scope.**
- Select a representative set of PRs from the Langfuse trace store (mix of
  distill / skip / flag-for-human, across domains and both model tiers).
- Export to a Langfuse **Dataset** with expected outcomes (the labels).
- Document the curation criteria so the set can grow.

**Acceptance.** A Langfuse Dataset with ≥ N labeled items; a doc describing selection
criteria and how to extend it; the dataset is runnable as the input to an eval.

**Notes.** **This is the bridge to kombo's evals work** — kombo said evals are their
next piece to establish a baseline for memory + codegen. Coordinate ownership before
filing so it doesn't fork.

---

## Issue 3 — Instrument the Research Supervisor with Langfuse

**Type:** feature · **Depends on:** #126 · **Effort:** M · **Relates to:** Research Supervisor demo

**Problem.** Observability stops at the memory pipeline. The Research Supervisor and
its agents (documentation-search, context-analysis, code-context) make LLM calls that
are currently untraced.

**Scope.** Apply the `startTrace` pattern from `docs/observability.md` to
`src/supervisors/research-supervisor.ts` and the agents it orchestrates:
- One trace per supervisor run (`name: 'research-supervisor'`), session per batch.
- Pass the handler to each agent's LangChain `chain.invoke(...)`.
- Manual spans for non-LLM steps (context loading, domain inference).
- Score terminal outcomes; `trace.update({ output })` at the end; flush.

**Acceptance.** A supervisor run produces one trace with nested agent generations and
token/cost capture; tests stub `../observability` per the doc; coverage maintained.

**Notes.** Ties directly into the demo branch work. Defer until the memory-pipeline
PoC is validated (per the handoff).

---

## Issue 4 — Move filter/distiller prompts into Langfuse Prompt Management

**Type:** enhancement · **Depends on:** #126 · **Effort:** M

**Problem.** Prompts are inline in `filter.ts` / `distiller.ts`. There's no
versioning, no A/B comparison, no way to correlate a quality change with a prompt
change.

**Scope.**
- Register the triage and distill prompts in Langfuse Prompt Management.
- Fetch the active prompt version at runtime (with an inline fallback if Langfuse is
  unreachable — preserve the passive-observer guarantee).
- Tag traces with the prompt version so quality/cost can be compared across versions.

**Acceptance.** Prompts editable in Langfuse without a code deploy; traces show the
prompt version; the pipeline still runs if Langfuse is down (fallback path tested).

**Notes.** Pairs naturally with Issue 2 — versioned prompts + an eval dataset is what
enables real A/B quality comparison.

---

## Issue 5 — Alerting on flag-for-human / schema-validation spikes

**Type:** enhancement · **Depends on:** #126, Issue 1 · **Effort:** S

**Problem.** A degraded model or a CHT schema change could silently spike the
flag-for-human or schema-validation-failure rate; nothing notifies us.

**Scope.** Configure Langfuse alerting (or a thresholded job over the metrics) to
notify (Slack/forum) when the `flag-for-human` rate or schema-validation-failure rate
exceeds a threshold over a window.

**Acceptance.** A configured alert that fires on a deliberately induced spike in a
test run; documented thresholds and notification target.

**Notes.** Lowest priority — only meaningful once enough traffic flows to make a
"spike" well-defined.
