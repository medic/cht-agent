# Test Orchestration Layer — Recommendation Document

**Issue:** [medic/cht-agent#18](https://github.com/medic/cht-agent/issues/18)
**Status:** Proposed (future layer, not yet implemented)
**Date:** 2026-03-03

---

## Summary

The Test Orchestration Layer runs the tests and reports the results, after code and tests have been generated and a live environment is available. It sits under the **QA Supervisor**, consumed directly after the **Test Environment Layer** ([#16](https://github.com/medic/cht-agent/issues/16)) has provisioned a healthy CHT instance.

The discovery for this layer surveyed the CHT ecosystem's test infrastructure (frameworks, coverage tools, output formats, npm scripts) and asked one design question: do we need a custom test runner, or just a thin wrapper around what already exists?

**Recommendation:** A thin wrapper around the target project's npm scripts. No custom test runner is needed. CHT already ships a complete test toolchain (Mocha for execution, nyc and karma-coverage for coverage, WebdriverIO plus Allure for e2e), and the layer's job is to invoke those scripts, capture their output, and report pass or fail.

The key discovery finding that shapes everything else: **the entire CHT ecosystem is Mocha-based. There is no Jest usage anywhere.** This narrows the output-parsing surface to a single framework family.

---

## Architectural Placement

The layer sits under the **QA Supervisor**, as the second step of QA work, after the environment exists:

```
QA Supervisor  (runs inside the cht-agent container)
├── Test Environment Layer     ← build/start/seed/health, wire network + volume (#16)
└── Test Orchestration Layer    ← THIS: run tests, capture output, report pass/fail (#18)
```

The Test Environment Layer hands over a healthy, seeded instance and a network handle. This layer reaches into that environment and runs the target project's own test commands against it. This layer is **not yet implemented**; this document captures the discovery findings as the recommendation that precedes that build.

---

## Key Finding: No Jest, All Mocha

Zero Jest usage across the entire CHT ecosystem. Everything is Mocha-based. Coverage is split between nyc (Istanbul) on the server side and karma-coverage on the Angular side. Output is overwhelmingly human-readable terminal text.

| Component | Framework | Coverage Tool | Output Format |
|-----------|-----------|---------------|---------------|
| api (unit) | Mocha + nyc | nyc | `text-summary` (terminal) |
| sentinel (unit) | Mocha + nyc | nyc | `text-summary` (terminal) |
| shared-libs (28 libs) | Mocha + nyc | nyc | `text-summary` (terminal) |
| api (integration) | Mocha | none | `spec` (terminal) |
| tests/integration | Mocha | none | `spec` + `captureFile: tests/results/results.txt` |
| admin (unit) | Karma + Mocha | none | `spec` (terminal) |
| webapp (mocha unit) | Mocha | none | `spec` (terminal) |
| webapp (angular unit) | Karma + Mocha | karma-coverage | html + lcov.info + text-summary |
| cht-form (angular unit) | Karma + Mocha | karma-coverage | html + lcov.info + text-summary |
| e2e / upgrade / visual | WebdriverIO + Mocha | none | `spec` + Allure (XML to HTML) |
| config/default | Mocha | none | `spec` or `progress` |
| cht-conf (unit) | Mocha + nyc | nyc | `html` |
| cht-conf (e2e) | Mocha | none | `spec` + `captureFile` |

The practical consequence: any output parsing the layer does only ever has to understand Mocha reporters (`spec`, `text-summary`, `progress`) plus Allure XML for e2e. There is no second framework to support.

---

## npm Scripts Available

The target projects already expose the full matrix of test commands. The layer shells out to these directly.

**cht-core:**

```
npm test                         # lint + unit + integration-api
npm run unit                     # all unit tests
npm run unit-api                 # api unit (with nyc coverage)
npm run unit-sentinel            # sentinel unit (with nyc coverage)
npm run unit-webapp              # webapp unit (mocha + karma)
npm run unit-shared-lib          # all shared-libs
npm run integration-api          # api integration (starts/stops couch)
npm run integration-all-local    # full integration (builds Docker first)
npm run wdio-local               # e2e tests (builds Docker first)
```

These map cleanly onto the layer's invocations: `exec('npm run unit-api')`, `exec('npm run integration-api')`, and so on. Some scripts (`integration-all-local`, `wdio-local`) build Docker first, which intersects with the Test Environment Layer's bring-up concerns rather than this layer's.

---

## Recommended Orchestration Approach

The Test Orchestration Layer should be a **thin wrapper around npm scripts**.

1. **No custom test runner needed.** Just `exec('npm run unit-api')` and the equivalent for each scope. The target project owns its runner configuration; the layer invokes it.
2. **Output parsing is straightforward.** The Mocha `spec` reporter writes to stdout. Integration tests additionally write to `tests/results/results.txt` via `captureFile`, so that path can be read directly.
3. **Coverage is already configured.** nyc emits `text-summary` for server code; karma-coverage emits lcov for the webapp. The layer reads what those tools already produce rather than instrumenting anything itself.
4. **Allure exists for e2e.** XML reports land in `allure-results/` and can be parsed if e2e results need to be surfaced.

This mirrors the implementation consideration raised in the original ticket: the layer may be as simple as running the script and parsing Mocha output, and the discovery confirms that the simple shape is the right one.

---

## Coverage Tracking Strategy

Coverage is not something this layer computes; it is something this layer reads. Two coverage tools are already wired into the target projects:

- **nyc (Istanbul)** for api, sentinel, shared-libs, and cht-conf unit tests, emitting `text-summary` to the terminal (cht-conf emits `html`).
- **karma-coverage** for the Angular webapp and cht-form units, emitting html, `lcov.info`, and `text-summary`.

The layer's coverage responsibility is to capture the summary these tools already produce and forward it. Coverage thresholds are a property of the target project, not of cht-agent, so the layer does not impose its own gate.

---

## Implementation Approach: Thin Wrapper vs Custom Agent

**Recommendation: thin wrapper, not a custom agent.** There is no LLM involvement in test execution. The layer shells out to npm scripts, captures stdout and any `captureFile` output, reads the coverage summaries the existing tools produce, and reports structured pass or fail back to the QA Supervisor. This is deterministic and fast.

The original ticket sketched the minimal shape, and the discovery supports keeping it:

```typescript
async function runTests(testFiles: string[]): Promise<TestResult> {
  const output = await exec('npm test');
  return parseMochaOutput(output);
}
```

The design decisions that frame the layer:

| Decision | Choice |
|----------|--------|
| Custom agent? | No. Shell out to npm scripts. |
| Flaky tests? | Prompt to re-run on timeout-related failures. |
| Coverage threshold? | Dependent on the target project, not cht-agent. |
| Results presentation? | Forward the Mocha output directly. |
| Test scope? | Run everything. Catches unintended side effects. |

---

## Future Enhancements

The three enhancements below are not part of the initial thin-wrapper build. Each is framed by its implementation complexity and the value it adds, so they can be prioritized later.

### 1. Structured Test Results with CTRF

Today all test output is human-readable terminal text (the `spec` reporter). The agent would have to regex-parse it to understand results. With [CTRF (Common Test Report Format)](https://ctrf.io/), the agent gets structured JSON instead.

**Without (today):**

```
  Auth
    ✓ should return 401 for invalid credentials (45ms)
    ✗ should handle expired tokens (12ms)
      AssertionError: expected 401 to equal 403
        at Context.<anonymous> (api/tests/mocha/auth.spec.js:45:12)

  5 passing (252ms)
  1 failing
```

The agent has to regex match pass and fail counts, extract test names from indentation, and parse stack traces from freeform text. Fragile.

**With CTRF:**

```json
{
  "results": {
    "summary": { "tests": 6, "passed": 5, "failed": 1 },
    "tests": [
      {
        "name": "Auth should handle expired tokens",
        "status": "failed",
        "duration": 12,
        "message": "expected 401 to equal 403",
        "trace": "AssertionError: expected 401 to equal 403\n    at Context.<anonymous> (api/tests/mocha/auth.spec.js:45:12)"
      }
    ]
  }
}
```

The agent can just filter by `status === 'failed'` and get the exact test name, error, and stack trace. No parsing.

**Implementation complexity:**

- **WebdriverIO:** very low. `wdio-ctrf-json-reporter` exists, add one line to the reporters array.
- **Mocha:** low to medium. `mocha-ctrf-json-reporter` exists, needs `@mochajs/multi-reporter` to keep `spec` output alongside CTRF.
- **Karma (webapp/admin):** high. No `karma-ctrf-json-reporter` exists. Defer this.

**Enhancement level: high.** It fundamentally changes how the agent understands test results.

### 2. Test Impact Analysis with dependency-cruiser

Today the agent runs the entire test suite on every change. With [dependency-cruiser](https://github.com/sverweij/dependency-cruiser), the agent can determine which tests are actually affected by a code change.

**Without (today):**

```bash
$ npm run unit
# Changes shared-libs/lineage/src/lineage.js
# Runs ALL 2847 tests, takes 4+ minutes
```

**With dependency-cruiser:**

```bash
$ npx depcruise --output-type json --reaches shared-libs/lineage/src/lineage.js
# Returns: contacts, transitions, user-management, api/controllers/people, sentinel/transitions/registration
# Agent runs only 127 affected tests, takes 18 seconds
```

**Implementation complexity: medium to high.** cht-core is a monorepo with 5 modules plus 32 shared-libs, two module systems (CommonJS plus TypeScript/Angular), and no existing dependency-analysis config. The CommonJS modules (api, sentinel, shared-libs) would be straightforward; the Angular webapp with path aliases needs extra configuration.

**Enhancement level: medium.** It only matters when test execution time becomes a bottleneck. For quick unit tests it is overkill; for integration and e2e it is valuable.

### 3. Changed-Line Coverage with nyc-diff

Today nyc reports project-wide coverage as a single summary line. With [nyc-diff](https://github.com/codefeathers/nyc-diff), the agent reports coverage only for the lines that were added or modified.

**Without (today):**

```
Statements: 82.45% (4521/5484)
```

There is no way to know whether the new code is covered.

**With nyc-diff:**

```
shared-libs/lineage/src/lineage.js
  Lines changed: 12    Covered: 11    Missed: 1    (91.7%)
  Uncovered line: 145  (else branch of handleOrphanedContact)
```

The agent can tell the user exactly which new lines lack test coverage.

**Implementation complexity: low.** A thin utility that runs after nyc.

**Enhancement level: medium.** Useful for PR-level feedback but not critical for the agent to function.

---

## Summary of Recommendations

| Area | Recommendation |
|------|----------------|
| Test runner | Thin wrapper around the target project's npm scripts. No custom runner. |
| Framework support | Mocha only. No Jest exists in the CHT ecosystem. |
| Coverage | Read what nyc and karma-coverage already emit. Thresholds belong to the target project. |
| Results | Forward Mocha output directly; capture `captureFile` paths and Allure XML where present. |
| CTRF (future) | High value, mixed complexity. Easy for WebdriverIO, medium for Mocha, deferred for Karma. |
| dependency-cruiser (future) | Medium value, medium to high complexity. Worthwhile only when suite runtime is a bottleneck. |
| nyc-diff (future) | Medium value, low complexity. Useful for PR-level coverage feedback. |
