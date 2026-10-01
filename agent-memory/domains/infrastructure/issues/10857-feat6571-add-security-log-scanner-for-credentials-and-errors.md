---
id: cht-core-6571
category: feature
domain: infrastructure
domainFit: weak
issueNumber: 6571
issueUrl: https://github.com/medic/cht-core/issues/6571
title: Add secretlint-based credential scanner to CI that fails the build on credential leaks in test server logs
lastUpdated: '2026-10-01'
summary: 'CHT had no automated guard against passwords/credentials leaking into api and sentinel server logs during CI test runs. This PR adds a secretlint-based scanner that runs after the tests in the tests and tests-k3d CI jobs and fails the build if credentials are detected in tests/logs/*.log. On master both scanner steps are commented out (PR #11134) after false positives in CouchDB logs.'
services:
  - api
  - sentinel
  - webapp
techStack:
  - secretlint
  - github-actions
  - nodejs
  - bash
  - javascript
  - mocha
  - chai
tags:
  - security
  - ci
  - credential-scanning
  - log-scanning
  - secretlint
  - regression-detection
  - static-analysis
related_workflows: []
source_pr: medic/cht-core#10857
source_sha: b44e99886942d263b4d40afb83db19e8adc003db
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - scripts/ci/.secretlintrc.json
  - scripts/ci/scan-logs.sh
  - .github/workflows/build.yml
  - webapp/tests/mocha/unit/testingtests/secretlintrc.spec.js
concepts:
  - CI security gate
  - credential-leak detection
  - declarative scanner configuration
  - 'post-test verification step (if: always())'
  - regression detection in CI
  - static log analysis
related_issues:
  - cht-core-11117
stale: true
---

> **Disabled on master after landing (`stale-as-written`):** PR #11134 ("ci(#11117): disables log scanner", merged 2026-06-03) commented out both `Scan logs for credential leaks` steps in `.github/workflows/build.yml`, disabling the scanner until false positives in CouchDB logs (#11117, still open) are solved. `scripts/ci/scan-logs.sh`, `scripts/ci/.secretlintrc.json` and the `scan-logs` npm script remain on master, where the config also disables `@secretlint/secretlint-rule-vercel` in the recommended preset (master commit `9af78c7a1`).

## Problem

During E2E and integration test runs, api and sentinel stderr/stdout are written to log files that could contain plaintext passwords or credentials when a regression is introduced. There was no automated check to catch such leaks, so a regression writing credentials to logs in plaintext could ship unnoticed.

## Root Cause

Before this PR, the CI test jobs collected server logs under `tests/logs/` and archived them, but no step scanned them, so nothing could fail a build when a credential appeared in a log.

## Solution

Added a `Scan logs for credential leaks` step (`if: always()`, `run: npm run scan-logs`) after the test run and before `Archive Results` in the `tests-k3d` and `tests` jobs of `.github/workflows/build.yml`; the `upgrade` job, which also runs WebdriverIO tests, did not get it. The root `package.json` gains the `scan-logs` script and the `secretlint`, `@secretlint/secretlint-rule-preset-recommend` and `@secretlint/secretlint-rule-pattern` dev dependencies. `scripts/ci/scan-logs.sh` exits 0 when there is no `tests/logs/*.log`, copies each log to a temp directory without the CouchDB lines matching `OS Process #?Port|OS Process .* Input ::` (debug dumps that legitimately log user-creation doc bodies with passwords), and runs `./node_modules/.bin/secretlint --secretlintrc scripts/ci/.secretlintrc.json` over the copies, so a detected leak fails the step. The .secretlintrc.json config combines @secretlint/secretlint-rule-preset-recommend with @secretlint/secretlint-rule-pattern carrying CHT-specific patterns: user:pass@host URLs in any scheme including localhost (the preset's basicauth rule requires a dotted domain and misses localhost:5984), credentials in URI query params, JSON key/value secret pairs, and Authorization headers. Safe patterns (Bearer ***, [REDACTED], ***) are excluded via negative lookaheads.

## Code Patterns

Declarative secret-detection config with custom regex rules in scripts/ci/.secretlintrc.json, using negative lookaheads to exclude already-redacted/safe tokens; pre-filtering known-noisy log lines before scanning in scripts/ci/scan-logs.sh; CI step gated with `if: always()` so the scanner runs even when tests fail and is positioned before result archiving in .github/workflows/build.yml; unit-testing a CI config itself by asserting it flags known-bad lines and passes safe lines in webapp/tests/mocha/unit/testingtests/secretlintrc.spec.js.

## Design Choices

Uses the maintained secretlint tool, its recommended preset plus declarative regex rules, instead of custom scanning code. Custom secretlint-rule-pattern rules fill gaps in the recommended preset (notably localhost basicauth URLs the preset misses). Scope was deliberately narrowed to credential scanning, deferring the 'detect unexpected errors thrown' half of issue #6571 to later, more involved work.

## Related Files

- .github/workflows/build.yml
- scripts/ci/.secretlintrc.json (added)
- scripts/ci/scan-logs.sh (added)
- scripts/ci/README.md (added)
- webapp/tests/mocha/unit/testingtests/secretlintrc.spec.js (added)
- package.json
- package-lock.json

## Testing

The added webapp/tests/mocha/unit/testingtests/secretlintrc.spec.js runs the real secretlint binary against one-line log files. It has 15 `it(` call sites that expand to 67 cases, because the query-parameter and JSON rules loop over seven keywords and three safe values; they assert the secretlint config flags known-bad log lines (credential URLs, JSON secrets, query-parameter secrets, Authorization headers, single-asterisk pseudo-masks) and does not flag safe patterns (redacted values, Bearer ***, credential-free URLs).

## Related Issues

- #6571: "Detect logged passwords and errors" — this draft's issue; it asked to fail the build when the e2e server logs contain passwords or unexpected errors, and this PR covers only the passwords half.
- #11117: "CI logs security scanner reports false positives in couchdb logs" — open follow-up: the CouchDB debug-line filtering in scripts/ci/scan-logs.sh is not reliable, so the scanner reports false positives.
- PR #11134: "ci(#11117): disables log scanner" — commented out both scanner steps in .github/workflows/build.yml on master.

## Domain Rationale

**Fit:** weak

The diff is CI tooling only: two steps in `.github/workflows/build.yml`, the added `scripts/ci/scan-logs.sh`, `scripts/ci/.secretlintrc.json` and `scripts/ci/README.md`, secretlint dev dependencies in the root `package.json`, and a Mocha spec under `webapp/tests/mocha/unit/testingtests/`, with no API or Sentinel code changes. Its purpose is detecting credential leaks in server logs, a security concern rather than build/deploy operations, so infrastructure is the least-bad home rather than a principled fit.
