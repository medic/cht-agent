# Observability

CHT Agent uses [Langfuse](https://langfuse.com) for LLM tracing, token cost tracking, and pipeline monitoring.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `LANGFUSE_PUBLIC_KEY` | Yes (for tracing) | Langfuse project public key (`pk-lf-…`) |
| `LANGFUSE_SECRET_KEY` | Yes (for tracing) | Langfuse project secret key (`sk-lf-…`) |
| `LANGFUSE_HOST` | No | API endpoint (default: `https://cloud.langfuse.com`) |
| `LANGFUSE_ENABLED` | No | Set to `false` to disable tracing entirely |

Copy `.env.example` to `.env` and fill in the Langfuse values.

---

## Running Locally with Tracing

1. Add your Langfuse keys to `.env`:
   ```
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   ```
2. Run the pipeline normally — traces appear in the Langfuse dashboard automatically:
   ```bash
   npm run run-pipeline -- --pr 12345
   ```
3. Open [cloud.langfuse.com](https://cloud.langfuse.com) → your project → **Traces** to see the result.

To disable tracing while keeping the keys in `.env`:
```
LANGFUSE_ENABLED=false
```

---

## Disabling Tracing in Tests

All tests run with `LANGFUSE_ENABLED=false`. This is enforced in CI via the `unit_tests.yml` workflow env and locally via proxyquire stubs in `test/scripts/run-pipeline.spec.ts`.

Tests that directly call `filterPR` or `distillPR` are unaffected — those functions only use the `langfuseHandler` opts field, which defaults to `undefined` in tests.

---

## Trace Structure

Each `processSinglePR` call produces **one Langfuse trace** containing:

```
pipeline-pr-medic-cht-core-<prNumber>
├── span: scrape          (no LLM — input: prNum, repo; output: fileCount)
├── generation: filter:triage-llm   (LangChain callback — auto-captured)
└── generation: distill:llm         (LangChain callback — auto-captured)
    score: distill-outcome          (1 = written, 0 = flag-for-human)
```

All traces from a single `run-pipeline` invocation share one **session ID** (a UUID generated at the start of `runPipeline`).

---

## Naming Conventions

Follow these when adding instrumentation to new workflows:

| Concept | Convention | Example |
|---|---|---|
| Trace ID | `<workflow>-<entity>-<id>` | `pipeline-pr-medic-cht-core-42` |
| Session ID | UUID per `runPipeline` invocation | `a3f1…` |
| Span names | `<stage>` or `<stage>:<substage>` | `scrape`, `filter:triage-llm` |
| Score names | `<stage>-outcome` | `distill-outcome` |
| Tags | Always include `env`, `repo`, `pipeline-stage` | — |

---

## Adding Instrumentation to a New Workflow

1. Import from `src/observability`:
   ```typescript
   import { makeLangfuseHandler, createTrace, flushLangfuse } from '../observability';
   ```

2. Create a trace and handler at the entry point of your workflow:
   ```typescript
   const traceId = `research-supervisor-${runId}`;
   const handler = makeLangfuseHandler(traceId, sessionId);
   const trace = createTrace(traceId, sessionId);
   ```

3. Pass `handler` to any LangChain chain invocation via the callbacks option:
   ```typescript
   const callbacks = handler ? [handler] : undefined;
   await chain.invoke(prompt, { callbacks });
   ```

4. Use `trace.span()` for non-LangChain operations:
   ```typescript
   const span = trace.span({ name: 'my-operation', input: { key: value } });
   // ... do work ...
   span.end({ output: { result } });
   ```

5. Score terminal outcomes:
   ```typescript
   trace.score({ name: 'my-outcome', value: success ? 1 : 0 });
   ```

6. Always flush at the end of your workflow:
   ```typescript
   await flushLangfuse();
   ```

7. In tests, mock the observability module with proxyquire:
   ```typescript
   '../observability': {
     makeLangfuseHandler: () => undefined,
     createTrace: () => ({ span: () => ({ end: () => {} }), score: () => {} }),
     flushLangfuse: async () => {},
     '@noCallThru': true,
   }
   ```

---

## No PII in Traces

The same truncation rules applied in `buildPrompt()` (PR body ≤ 4000 chars, linked issue bodies ≤ 500 chars) also apply to Langfuse input metadata. Never log raw PR bodies, diffs, or review comments as trace input.

---

## Future Work

- **Prompt versioning**: migrate distiller and filter prompts to Langfuse Prompt Management for A/B comparison.
- **Dashboards**: cost per PR, filter decision distribution, distill success rate, latency by stage.
- **Alerting**: notify when `flag-for-human` rate or schema validation failures spike.
- **Evaluation datasets**: curate representative PR inputs from the trace store for automated quality evaluation.
- **Agent instrumentation**: apply the same pattern to `ResearchSupervisor` and individual agents once the memory pipeline PoC is validated.
