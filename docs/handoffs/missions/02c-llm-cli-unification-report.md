# Mission 02c report — LLM provider unification (claude-cli everywhere)

Date: 2026-07-02. Session: m02c workbench session (worktree `.claude/worktrees/m02c`).

## Branches produced

| Branch | Base | Tip | Commits |
|---|---|---|---|
| `feat/llm-provider-unification` | `main` (ed07177) | `c5d14d8` | `c172bdc` feat(llm): route research planner and domain inference through claude-cli provider; `c5d14d8` fix(llm): review-pass cleanups |

No merges performed; no conflicts encountered. The integration branch was not touched.

## What was rerouted (exactly)

When `LLM_PROVIDER=claude-cli`, two call sites — the only `ChatAnthropic` users in the
research flow (verified: the documentation-search, code-context, and context-analysis
agents are LLM-free) — now go through the existing claude-cli provider via
`createStructuredCliChain` (`claude -p`, `disableTools`, `maxTurns: 1`, zod-validated):

1. **Research Supervisor planner** (`src/supervisors/research-supervisor.ts`).
   The `plannerModel: ChatAnthropic` field became a file-local invoke-only
   `PlannerInvoker` selected at construction time (`createCliPlanner()` vs
   `createApiPlanner(options.modelName)`). Constructor-time selection is required:
   `ChatAnthropic` throws at construction without a key, so CLI mode must never
   construct it, and API mode keeps the original constructor-throw timing. The CLI
   path wraps the free-text plan in a JSON envelope (`planSchema =
   z.object({ plan: z.string().min(1) })`, shape `{"plan": "<...>"}`) because
   `parsePlanResponse` only consumes the text as the plan summary; all deterministic
   plan fields (phases, risks, complexity, effort) are provider-independent, and a
   parity test pins that.
2. **Domain/component inference** (`src/utils/domain-inference.ts`). `inferUsingLLM`
   branches after prompt build: CLI mode routes through `createStructuredCliChain`
   with `inferenceSchema = z.object({ domain: z.enum(CHT_DOMAINS),
   components: z.array(z.string()).optional(), reasoning: z.string().optional() })`
   (same taxonomy source as the API path's `VALID_DOMAINS` check), returning
   `{ domain, components: parsed.components ?? [] }`.
3. **CLI guard relaxation** (`src/cli/display-helpers.ts`). `validateEnvironment`
   early-returns (with an info line) when `isUsingCLIProvider()`; the
   `ANTHROPIC_API_KEY` check and exit path are byte-identical otherwise.
   `src/cli/research.ts` needed no change.
4. **Docs** (`.env.example`): purely additive block documenting that the research
   flow honors `LLM_PROVIDER=claude-cli`, with model/effort flowing via
   `ANTHROPIC_MODEL` + `CLAUDE_CODE_EFFORT_LEVEL` (read by the `claude` binary
   itself), and that the API path (default when `LLM_PROVIDER` unset) still requires
   `ANTHROPIC_API_KEY`. `OPENROUTER_API_KEY` does not apply to the research flow.

Both rerouted modules import `{ createStructuredCliChain, isUsingCLIProvider }` from
`src/llm/structured-cli` — the same pattern as `src/scripts/filter.ts` /
`distiller.ts`. `src/llm/providers/claude-cli.ts`, `src/llm/factory.ts`, and
`src/llm/types.ts` are untouched, as is the supervisor's graph structure and its
`codeContextFindings` wiring.

## Default-path guarantee

No behavior change when `LLM_PROVIDER` is unset: same `ChatAnthropic` constructor
args (`modelName || 'claude-sonnet-4-20250514'`, temperature 0.3 planner / 0.2
inference), same throw timing, same string-or-JSON content normalization, same
`parseLLMResponse` error messages. Verified hunk-by-hunk against `main` by an
independent review pass, and pinned by no-regression tests.

## Tests

25 tests added (suite: 558 → 583 passing, 0 failing):

- `test/utils/domain-inference.spec.ts` — new CLI-provider-path describe (8 tests)
  using an integration-grade loader (real `structured-cli` composed over a fake
  `invokeForJSON` provider, plus a throwing-`ChatAnthropic` tripwire), covering
  routing, prompt integrity, one-shot options, zod domain rejection, components
  defaulting/strictness, `enrichIssueTemplate` merge, and the ticket short-circuit;
  plus an explicit API-selection no-regression describe (2 tests). Also removed the
  stale "can't mock ESM" comment and added mandatory `LLM_PROVIDER`
  snapshot/delete/restore hygiene to the existing mocked-LLM block.
- `test/supervisors/research-supervisor-llm-routing.spec.ts` (new, 10 tests) — stubs
  only `@langchain/anthropic` and `../llm/structured-cli` (real langgraph, real
  mock-MCP agents): CLI-mode constructor never touches `ChatAnthropic` even with a
  key present, schema/shape contract (incl. empty-plan rejection), routing, prompt
  integrity, CLI/API plan parity, chain-rejection → error node; API-default ctor
  args, `modelName` override, invoke + summary truncation, non-string content
  coercion.
- `test/cli/display-helpers.spec.ts` (new, 5 tests) — the guard's full truth table
  (unset/no key exits 1; key set passes; `claude-cli` without key passes with info
  line; explicit `anthropic` without key still exits; `claude-cli` + key passes).

All new tests were mutation-checked (reverting each source hunk fails its tests) and
verified hermetic under a hostile env (`LLM_PROVIDER=claude-cli`,
`ANTHROPIC_MODEL=claude-x-bogus`, no key → 44/44 relevant tests pass).

## Gates (final, on `c5d14d8`)

- `npm ci` — clean (Node 22).
- `npm run build` (tsc) — clean.
- `npm test` — **583 passing, 0 failing** (with `ANTHROPIC_MODEL` unset; see
  environment note below).
- `npm run lint` (eslint) — clean. No nested template literals or assertion-less
  tests introduced (SonarCloud gates).

## Live end-to-end verification

Ran the compiled research flow in this container with `LLM_PROVIDER=claude-cli` and
`ANTHROPIC_API_KEY` deleted (mock MCP, real `claude -p` on the workbench OAuth
session, `ANTHROPIC_MODEL=claude-fable-5`):

- Domain inference classified an SMS-reminder ticket as `messaging` via one real
  `claude -p` call.
- `ResearchSupervisor.research()` ran the full graph to `currentPhase: 'complete'`
  with 0 errors; the planner call went through the CLI provider (2,418-char prompt,
  tools disabled, maxTurns 1, ~39 s) and produced a real orchestration plan.

## Deviations from the mission

- The mission says the "Opus/Fable sampling-param fix and `RESEARCH_MODEL` handling
  stay intact for the API path" — **neither exists on `main`** (grep for
  `RESEARCH_MODEL` and sampling special-casing: zero hits). There was nothing to
  preserve; the API path was left untouched, which satisfies the intent. If that fix
  lands on another branch, this diff does not conflict with it structurally (the
  `ChatAnthropic` construction moved into `createApiPlanner` in the same file).
- No matching upstream issue number exists for this work, so commits use
  `feat(llm):` / `fix(llm):` scope style (precedent: `chore(tickets):` on `main`)
  rather than `type(#NN):`.

## Limitations

- The CLI planner adapter is **invoke-only** (no streaming/callbacks), as the
  mission allows. This costs nothing today: the API path was already a plain
  `.invoke()`, and `parsePlanResponse` only uses the text for the summary.
- CLI mode deliberately diverges on two edges (both tested/documented): a
  non-array `components` from the model **rejects** via zod instead of being
  coerced to `[]`, and an **empty plan** rejects (`min(1)`) → supervisor error node,
  instead of the API path's degraded `'...'` summary. An explicit error beats a
  junk plan; flip to coercion if upstream review prefers exact parity.
- `modelName` (and `runResearchWorkflow`'s hardcoded `claude-sonnet-4-20250514`)
  only affect the API path; in CLI mode the model comes from `ANTHROPIC_MODEL`.

## Follow-ups discovered

- `test/layers/code-gen/code-gen-registry.spec.ts:290` ("should default to
  documented model name") is not hermetic: it reads ambient `ANTHROPIC_MODEL`, which
  the workbench container exports (`claude-fable-5`), making the test fail in any
  environment that sets that var. Pre-existing on `main`, unrelated to this branch;
  gates here were run with `ANTHROPIC_MODEL` unset. Worth a one-line env
  snapshot/delete/restore fix upstream.
- `test/scripts/filter.spec.ts` similarly fails under ambient
  `LLM_PROVIDER=claude-cli` (pre-existing; untouched by this diff).
- Mocha gotcha for future sessions: `.mocharc.json`'s `spec` glob is concatenated
  with positional file args, so `npx mocha <file>` runs the whole suite; scope with
  a `--config` that omits `spec`, or `--grep`.
