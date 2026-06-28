# Design note: how far to extend Langfuse across cht-agent

**Question this answers:** now that the memory pipeline is traced (#126), do we
instrument the *rest* of cht-agent — and if so, where do we hook in so we don't
hand-wire `startTrace` onto every call site forever?

**TL;DR recommendation:** instrument **per-workflow** for the next step (Research
Supervisor), because the "provider chokepoint" that would let us auto-trace
everything **does not exist on the hot path today**. Treat building that chokepoint
as a separate, deliberate refactor — valuable, but not a prerequisite, and not
something to bolt on under #126.

---

## What's actually traced today

Only the memory pipeline: `run-pipeline.ts` → `filter.ts` (triage) → `distiller.ts`
(distill). One `startTrace` per PR, handler threaded into each LangChain
`chain.invoke(...)`. That's the whole footprint.

## The LLM surface that *could* be traced (grounded inventory)

| Component | File:line | Real LLM? | Notes |
|---|---|---|---|
| Research Supervisor (LangGraph) | `supervisors/research-supervisor.ts:82` | **Yes** | `new ChatAnthropic` planner; 4-node graph; the flagship/demo workflow |
| Domain inference | `utils/domain-inference.ts:187` | **Yes** | `new ChatAnthropic` LLM *fallback* — CLAUDE.md flags it as expensive |
| Filter (pipeline) | `scripts/filter.ts:154,163` | **Yes** | ✅ already traced via #126 |
| Distiller (pipeline) | `scripts/distiller.ts:105,114` | **Yes** | ✅ already traced via #126 |
| Anthropic provider | `llm/providers/anthropic.ts:108` | **Yes** | The clean abstraction — but see "the hole" below |
| Claude-CLI provider | `llm/providers/claude-cli.ts` | **Yes** | Subprocess (`claude -p`); not a LangChain call — traces as a span, not a generation |
| Code Context Agent | `agents/code-context-agent.ts` | No (MCP) | OpenDeepWiki retrieval — trace as a **span** (latency/rate-limit), not token cost |
| Doc Search Agent | `agents/documentation-search-agent.ts` | No (MCP, mocked) | Kapa retrieval; currently mocked |
| Context Analysis Agent | `agents/context-analysis-agent.ts` | No | Rule-based — nothing to trace |
| Test Environment Agent | `agents/test-environment-agent.ts` | No | Mocked Docker — nothing to trace |
| Code-gen `claude-api` module | `layers/code-gen/modules/claude-api/` | No | Static scaffolds — nothing to trace |
| Dev / QA Supervisors | — | — | Not started |

**Takeaway:** the *worthwhile* targets beyond the pipeline are exactly two real LLM
sites today — the **Research Supervisor** and **domain inference** — plus MCP
retrieval as supporting spans. Everything else is mocked or unbuilt; instrumenting
it now would trace placeholders, adding noise, not signal.

---

## The hole in the "just instrument at the provider layer" idea

It's tempting to thread the Langfuse handler through `src/llm/providers/anthropic.ts`
once and have every consumer inherit tracing. **That doesn't work today**, for three
concrete reasons found in the code:

1. **The provider factory is off the hot path.** Nobody outside `src/llm/` and tests
   imports `createLLMProvider` / `createLLMProviderFromEnv`. The real workflows
   instantiate `new ChatAnthropic(...)` **directly**:
   - `research-supervisor.ts:82`
   - `utils/domain-inference.ts:187`
   - `filter.ts:154,163`, `distiller.ts:105,114`
   So instrumenting the provider would trace *nothing that currently runs*.
2. **The provider interface can't carry a handler.** `InvokeOptions`
   (`llm/types.ts:85`) has `temperature`, `tools`, `toolHandler`, … but **no
   `callbacks`/`handler` field.** Threading Langfuse through it is itself a small API
   change, not a free hook.
3. **The CLI provider isn't a LangChain call at all.** `claude-cli.ts` spawns a
   subprocess. Its LangChain-callback auto-capture (tokens/model) doesn't apply; it
   has to be traced manually as a span. So even a "provider chokepoint" wouldn't be
   uniform across providers.

This is the crux: **there is no single chokepoint to hook today.** The decision is
therefore three-way, not two-way.

---

## The three options

### Option A — Per-workflow `startTrace` (what the pipeline already does)
Add a `startTrace` at each workflow entry point; thread the handler into that
workflow's LangChain calls; manual spans for non-LLM steps.

- **Pros:** zero new abstraction; matches the documented pattern; ships the
  Research Supervisor trace immediately; no risk to existing code paths.
- **Cons:** each new workflow re-wires it by hand; direct-`ChatAnthropic` sites must
  each accept and pass a handler.
- **Effort:** S–M per workflow.

### Option B — Build a real provider chokepoint, then instrument it once
First route the live workflows through the `LLMProvider` factory (or have the
provider emit traces), add a `callbacks`/handler to `InvokeOptions`, and trace there.

- **Pros:** future agents get tracing for free; consolidates token accounting
  (`anthropic.ts` already accumulates usage — Langfuse would replace the bespoke
  counter); one place to enforce the no-PII rule.
- **Cons:** it's a **refactor of how every workflow constructs models**
  (research-supervisor, domain-inference, filter, distiller all bypass the factory
  today). Higher blast radius; touches working code; CLI provider still needs
  separate span handling.
- **Effort:** L. Should be its own issue with its own review.

### Option C — Lean on LangGraph-native callback propagation (Research Supervisor only)
LangGraph propagates `callbacks` passed to `graph.invoke(state, { callbacks: [h] })`
down to child runnables. For the *supervisor specifically*, one handler at
`graph.invoke` may auto-capture the node-level `ChatAnthropic` calls without
threading a handler into each node — **if** those models are invoked within the
graph's runnable context (needs a live verification; the planner is a plain
`ChatAnthropic.invoke`, which usually does inherit graph callbacks).

- **Pros:** minimal wiring for the highest-value target; gives the nicest trace tree
  (graph → nodes → generations) for free.
- **Cons:** propagation must be **verified live**, not assumed; doesn't help
  non-graph sites (domain inference) or the pipeline.
- **Effort:** S (plus a verification step).

---

## Recommendation & sequencing

1. **Now (closes #126):** smoke-test the pipeline. No instrumentation expansion.
2. **Next (Issue 3 — Research Supervisor):** use **Option A**, and *attempt* Option C
   inside it — wrap the supervisor entry in `startTrace`, pass the handler to
   `graph.invoke({ callbacks: [handler] })`, and verify in Langfuse whether the four
   nodes' LLM calls nest automatically. If they do, great (Option C for free); if
   not, thread the handler into `generatePlanNode` explicitly (Option A). Either way
   it's one small PR and it covers the demo path.
3. **Cheap add:** instrument `domain-inference.ts` (Option A) — one `startTrace`,
   turns "this is expensive" into a measured LLM-fallback rate and cost.
4. **Later, deliberately (new issue, not under #126):** **Option B** — route live
   workflows through a single instrumented provider and add `callbacks` to
   `InvokeOptions`. Do this *after* there are ≥3 real LLM call sites so the
   consolidation clearly pays for its blast radius. Until then, per-workflow wiring
   is the lower-risk choice.

**Why not B first:** B is a refactor of working code (every workflow bypasses the
factory today) for a payoff that only materializes once there are several agents to
amortize it across. With exactly two real non-pipeline sites today, A/C ship value
this week at a fraction of the risk; B becomes worth it when Dev/QA supervisors land.

## Constraints any option inherits
Passive observer · no-op when `LANGFUSE_ENABLED=false` · **SDK v3 not v5** (v5 drops
non-LLM spans) · trace input = identity only, no PII · follow the `startTrace`
pattern in `docs/observability.md`.
