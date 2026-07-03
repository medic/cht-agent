# Implementation spec: instrument the Research Supervisor with Langfuse

**This is the "Issue 3" follow-up made concrete.** Depends on #126 (the `startTrace`
primitive). Implements **Option A + attempt Option C** from
`126-langfuse-instrumentation-strategy.md`.

**Goal:** one Langfuse trace per `ResearchSupervisor.research()` run, showing the
LangGraph nodes nested under it with token/cost capture on the planner LLM call —
ideally for free via LangGraph callback propagation, with an explicit fallback if
propagation doesn't reach the node.

---

## Integration points (verified against current code)

| What | Where | Today |
|---|---|---|
| Public entry | `research-supervisor.ts` — `async research(issue)` (~line 565) | starts the workflow |
| Graph execution | `research-supervisor.ts:593` — `await this.graph.invoke(initialState)` | **where the handler attaches** |
| Planner LLM call | `research-supervisor.ts:288` — `this.plannerModel.invoke(prompt)` (inside `generateOrchestrationPlan`) | the real generation to capture |
| Planner model | `research-supervisor.ts:82` — `new ChatAnthropic(...)` (direct, not via `LLMProvider` factory) | — |
| CLI entry | `cli/display-helpers.ts:205` — `new ResearchSupervisor({...})` then `.research()` | session boundary lives here |
| MCP retrieval (optional spans) | `code-context-agent.ts` (OpenDeepWiki, real), `documentation-search-agent.ts` (Kapa, mocked) | trace as spans, not generations |

---

## Target trace shape

```
trace: research-supervisor   (Langfuse-generated id; input {issueTitle, domain, components}; tags [research-supervisor, domain])
├── span: documentation-search   (MCP — optional; output: refs count, confidence)
├── span: code-context-search    (MCP — optional; output: findings count)
├── span: analyze-context        (rule-based; output: similarity scores)
└── generation: generate-plan    (ChatAnthropic — model + tokens; ideally auto-captured)
    score: research-outcome       (1 = plan generated, 0 = error/empty)
```

Session: one UUID per CLI invocation (set in `display-helpers.ts`), matching the
pipeline's per-run session convention.

---

## Implementation steps

### 1. Accept a session id + start a trace at the entry point
In `research(issue)`, before `graph.invoke`:

```typescript
import { startTrace, getLangfuse } from '../observability';

const { trace, handler } = startTrace({
  name: 'research-supervisor',
  sessionId: this.sessionId,                 // passed via constructor; see step 4
  input: {
    issueTitle: issue.issue.title,
    domain: issue.issue.technical_context.domain,
    components: issue.issue.technical_context.components,
  },
  tags: ['research-supervisor', issue.issue.technical_context.domain],
});
```
**No PII:** input is issue *identity* only — never the full issue body or scraped
context. (Same rule as the pipeline.)

### 2. Attach the handler at `graph.invoke` (Option C — try this first)
```typescript
result = await this.graph.invoke(initialState, { callbacks: [handler] });
```
LangGraph propagates `callbacks` to child runnables. **Verify in Langfuse** whether
the `generate-plan` node's `this.plannerModel.invoke(prompt)` (line 288) shows up as
a nested generation automatically.

- **If yes** → done; you got the node generation for free.
- **If no** (the planner is a bare `ChatAnthropic.invoke`, which *usually* inherits
  graph callbacks but verify) → **Option A fallback:** thread the handler into the
  planner call. Pass `handler` down to `generateOrchestrationPlan(...)` and change
  line 288 to:
  ```typescript
  const response = await this.plannerModel.invoke(prompt, { callbacks: handler ? [handler] : undefined });
  ```

### 3. Manual spans for non-LLM nodes (optional but recommended)
The doc-search / code-context / analyze nodes don't make LLM calls (MCP + rule-based),
so callbacks won't capture them. Wrap each node body in a `trace.span(...)` to get
latency + retrieval-size visibility. Keep span output to counts/scores — never the
retrieved document text.

### 4. Score, set output, flush
At the end of `research(issue)` (both success and error paths):
```typescript
trace.score({ name: 'research-outcome', value: result.currentPhase === 'error' ? 0 : 1 });
trace.update({ output: { phase: result.currentPhase, hasPlan: !!result.orchestrationPlan } });
await getLangfuse().flushAsync();
```
**Flush on the error path too** — the current `catch` at line 594 returns early;
ensure the score/update/flush run in a `finally` or before each return.

### 5. Session id from the CLI
In `display-helpers.ts:205`, generate one `randomUUID()` per `runResearchWorkflow`
invocation and pass it into the supervisor constructor (mirror how `runPipeline`
makes one session per run). Add `sessionId?: string` to the constructor options and
store it as `this.sessionId`.

---

## Tests

Follow the proxyquire pattern from `test/scripts/run-pipeline.spec.ts` and
`test/observability/index.spec.ts`:

- Stub `../observability` so `startTrace` returns `{ trace: noopTrace, handler: undefined }`
  and `getLangfuse` returns `{ flushAsync: async () => {} }`. (`noopTrace` needs
  `span`/`score`/`update`.)
- Existing supervisor tests must pass unchanged — the handler is optional and
  defaults to a no-op, so behavior is identical with tracing off.
- If you take the Option A fallback (step 2), assert the planner is invoked with a
  `callbacks` option when a handler is present.
- Keep `LANGFUSE_ENABLED=false` (CI default) — no live calls in tests.

## Acceptance criteria

- [ ] A `research()` run with real keys produces **one** `research-supervisor` trace
      in Langfuse with the planner call captured as a generation (tokens + cost).
- [ ] Non-LLM nodes appear as spans (if step 3 done); MCP retrieval latency visible.
- [ ] `research-outcome` score set on both success and error paths; trace flushed
      even when the graph throws.
- [ ] Trace input is identity-only (no issue body / no retrieved docs).
- [ ] All existing supervisor tests pass; new tests cover the handler-present path.
- [ ] Coverage maintained; `LANGFUSE_ENABLED=false` keeps tests offline.

## Out of scope (defer)
- Routing the supervisor through the `LLMProvider` factory (that's Option B — a
  separate refactor; see the strategy note).
- Instrumenting the mocked Doc Search Agent (Kapa) — wait until it makes real calls.
- Prompt versioning / dashboards / eval datasets — separate follow-ups.

## Verify the propagation assumption before building
LangGraph callback propagation to a node-level `ChatAnthropic.invoke` is *expected*
but not guaranteed across versions. Before committing to Option C, run the supervisor
once with a real Langfuse key and confirm the `generate-plan` generation nests under
the trace. If it doesn't, the Option A fallback (step 2) is the safe path and costs
one extra parameter thread-through.
