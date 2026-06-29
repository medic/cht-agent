# Test Generation Layer Recommendation Document

**Issues:** [#15](https://github.com/medic/cht-agent/issues/15) (discovery), [#63](https://github.com/medic/cht-agent/issues/63) (implementation, PR [#110](https://github.com/medic/cht-agent/pull/110))
**Status:** Implemented (this document captures the discovery rationale for the now-built layer)

---

## Summary

The Test Generation Layer generates tests that follow CHT conventions, so the agent produces test code that looks and behaves like a CHT contributor wrote it rather than reinventing patterns. This document catalogues the CHT test patterns the layer needs to replicate, evaluates the available tools, records the architecture decisions, lays out the proposed pipeline, distinguishes what we build from what we adopt, and lists the open questions.

> **Note:** the Test Generation Layer is already implemented (issue #63 / PR #110). This document is a faithful conversion of the #15 discovery findings into the same recommendation format as the other layer docs, so the rationale behind the built layer is captured alongside them. It reorganizes the discovery content rather than introducing new analysis.

**Key decision (from the ticket):** Test Generation is a **separate layer from Code Generation**. If code gen and test gen are combined, the model may "defend" its own code and fail to write proper negative tests. Separation ensures independent validation.

---

## CHT Test Patterns (Reference for the Agent)

These are the patterns the test generation layer needs to replicate. They are what matters for the agent's context.

### Unit tests (Mocha + Chai + Sinon + nyc)

- Locations: `api/tests/mocha/`, `sentinel/tests/unit/`, `webapp/tests/karma/` and `mocha/`, `shared-libs/*/test/`
- Naming: `*.spec.js` / `*.spec.ts`
- Heavy Sinon stubbing in `beforeEach`, mandatory `sinon.restore()` in `afterEach`
- `rewire` for testing private module functions
- Parameterized tests via `.forEach` for validation and edge cases
- Chai plugins: `deep-equal-in-any-order`, `chai-exclude`

### Integration tests (Mocha + Chai + Rosie factories + real services)

- Locations: `tests/integration/`, `api/tests/integration/`
- Factory pattern via `rosie` (`@factories/cht/contacts/person`, `place`, `users`, `reports/`)
- CHT contact hierarchy: minified parent refs `{ _id, parent: { _id, parent: ... } }`
- Utilities: `saveDocs()`, `createUsers()`, `updateSettings()` with revert support
- Path aliases: `@utils`, `@factories`, `@constants`, `@page-objects`

### E2E tests (WebdriverIO + Mocha + Chai + Page Object Model)

- Location: `tests/e2e/`, naming: `*.wdio-spec.js`
- Page objects in `tests/page-objects/` with CSS selectors using `test-id` attributes
- Chrome headless, Allure reporting

### Config tests (cht-conf-test-harness + Mocha + Chai)

- Location: `config/*/test/`, for partner config projects, not cht-core itself
- Time simulation (`setNow`, `flush`), form completion (`fillForm`, `loadAction`)
- Harness version must match the CHT Core version

---

## CHT Specialist Skills

Reviewed [cht-specialist](https://github.com/inromualdo/cht-specialist). It covers configuration (forms, tasks, targets, contact-summary, cht-conf, deployment) but has **no testing coverage at all**. There are no references for Mocha patterns, stub conventions, factories, or E2E. The test generation layer's agent-memory fills this gap entirely.

---

## Tool Evaluation

### StrykerJS (open-source mutation testing)

[StrykerJS](https://stryker-mutator.io/) answers the question "do these tests actually catch bugs, or just execute code paths?"

- Introduces small code mutations (flip operators, remove conditions, swap values), re-runs the tests, and if the tests still pass, that is a blind spot.
- Would live **inside cht-agent's test generation pipeline** as an internal quality gate, not in cht-core's CI.
- Flow: the LLM generates tests, StrykerJS validates they catch real faults, and weak tests get iterated on before the human ever sees them.
- Meta's research backs this: mutation-guided testing killed 15% of faults versus 2.4% for coverage-only approaches.
- Works with Mocha, supports TypeScript.

### DSPy (AX for us) (prompt optimization)

The same tool flagged for the research layer. It is relevant here because test quality is very prompt-dependent. It could optimize prompts for CHT convention adherence without manual tuning.

---

## Architecture Decisions

These extend or refine what is already in the ticket description.

- **Test layer sees full generated code initially.** Strong prompting tests against requirements rather than mirroring the implementation. Future: tiered visibility (interface-only for unit, full code for integration, requirements-only for E2E).
- **Requirements-mapped checklist as human output.** Non-technical reviewers see which acceptance criteria have tests and what scenario types are covered (happy path, error, edge case, boundary). Code coverage stays an internal gate.
- **Fixture strategy refinement.** Per the ticket, fixtures are left to the end user. In practice, the layer will use existing Rosie factories where applicable, generate minimal inline fixtures for simple cases, and explicitly prompt the user for what it cannot infer. As agent-memory grows, common fixture patterns get reused automatically.
- **Feedback loop on failures.** When generated tests fail, the code gen layer determines whether it is a code fault or a test fault. PoC simplification: all failures route back to code gen first.
- **TDD deferred.** Get the traditional flow (code, then tests) working first, then explore test-first generation as a future mode.

### Decisions captured from the ticket

| Concern | Decision |
|---------|----------|
| **Templates / fixtures** | Left to the end user. No quantifiable way to predetermine them. |
| **Validation** | User review before writing, plus tests must run. |
| **Coverage target (within cht-agent code)** | 90%+ for deterministic code, flexible for LLM-calling code. |

---

## Proposed Pipeline

```
Requirements + Generated Code + CHT Patterns (agent-memory)
        ↓
Test Generation (LLM generates Mocha/Chai/Sinon tests)
        ↓
Basic Gate (compile + pass + increase coverage)
        ↓
[Future] Mutation Gate (StrykerJS, do tests catch introduced faults?)
        ↓
Requirements Checklist (requirement → test scenario mapping)
        ↓
Human Checkpoint #2
```

---

## Build vs. Adopt

| Concern | Build | Adopt | Notes |
|---------|:-----:|-------|-------|
| Test code generation | Yes | | LLM agent with CHT pattern context |
| Prompt optimization | | DSPy/AX | Optimize test gen prompts |
| Mutation quality gate | | StrykerJS | Internal validation, not in cht-core |
| Test execution | | Mocha/nyc | Already in place |
| Requirements checklist | Yes | | Custom output format |

---

## Open Questions

- **StrykerJS timing.** Include it in the PoC or defer it as a later enhancement? It adds confidence but also complexity.
- **Config project scope.** Should the PoC also cover cht-conf-test-harness test generation, or stay focused on cht-core unit/integration/E2E?
- **Tiered code visibility.** How aggressively should we limit what the test layer sees? Full code access is simpler for the PoC, but interface-only might produce better independent tests.
- **Other tools or approaches.** This space is moving fast. Open to suggestions from anyone who has seen something relevant.
