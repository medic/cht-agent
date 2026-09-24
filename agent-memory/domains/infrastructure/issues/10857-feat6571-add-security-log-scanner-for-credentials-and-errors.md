---
id: cht-core-6571
category: feature
domain: infrastructure
domainFit: weak
issueNumber: 6571
issueUrl: https://github.com/medic/cht-core/issues/6571
title: Add secretlint-based credential scanner to CI that fails the build on credential leaks in test server logs
lastUpdated: '2026-06-22'
summary: CHT had no automated guard against passwords/credentials leaking into api and sentinel server logs during CI test runs. This PR adds a secretlint-based scanner that runs after every E2E and integration test job and fails the build if credentials are detected in tests/logs/*.log.
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
related_issues: []
stale: false
---

## Problem

During E2E and integration test runs, api and sentinel stderr/stdout are written to log files that could contain plaintext passwords or credentials when a regression is introduced. There was no automated check to catch such leaks, so a regression writing credentials to logs in plaintext could ship unnoticed.

## Root Cause

Absence of an automated post-test scanning step in CI to inspect server logs for credential leaks. The prior custom approach (scripts/ci/log-scanner.js plus an allowlist) was ad hoc and being replaced, leaving no maintained, declarative gate to fail builds when secrets appeared in logs.

## Solution

Added a secretlint-based credential scanner that runs after every E2E and integration test job in build.yml (with `if: always()`, before Archive Results), scanning tests/logs/*.log and failing the build on a detected leak. The .secretlintrc.json config combines @secretlint/secretlint-rule-preset-recommend with @secretlint/secretlint-rule-pattern carrying CHT-specific patterns: user:pass@host URLs in any scheme including localhost (the preset's basicauth rule requires a dotted domain and misses localhost:5984), credentials in URI query params, JSON key/value secret pairs, and Authorization headers. Safe patterns (Bearer ***, [REDACTED], ***) are excluded via negative lookaheads. The old log-scanner.js and log-scanner-allowlist.json were removed.

## Code Patterns

Declarative secret-detection config with custom regex rules in scripts/ci/.secretlintrc.json, using negative lookaheads to exclude already-redacted/safe tokens; CI step gated with `if: always()` so the scanner runs even when tests fail and is positioned before result archiving in .github/workflows/build.yml; unit-testing a CI config itself by asserting it flags known-bad lines and passes safe lines in webapp/tests/mocha/unit/testingtests/secretlintrc.spec.js.

## Design Choices

Chose the established, maintained secretlint tool over the bespoke log-scanner.js, moving forward with secretlint alone. Custom secretlint-rule-pattern rules fill gaps in the recommended preset (notably localhost basicauth URLs the preset misses). Scope was deliberately narrowed to credential scanning, deferring the 'detect unexpected errors thrown' half of issue #6571 to later, more involved work.

## Related Files

- .github/workflows/build.yml
- scripts/ci/.secretlintrc.json
- scripts/ci/scan-logs.sh
- scripts/ci/README.md
- webapp/tests/mocha/unit/testingtests/secretlintrc.spec.js
- package.json
- package-lock.json

## Testing

Added 18 mocha/chai unit tests in webapp/tests/mocha/unit/testingtests/secretlintrc.spec.js asserting the secretlint config flags known-bad log lines (credential URLs, JSON secrets, pass query params) and does not flag safe patterns (redacted values, Bearer ***, credential-free URLs). Six manual stress-test scenarios covering credential-leak and safe-pattern cases were documented in the PR with passing results.

## Related Issues

- #6571: Fail the CI build when E2E/integration server logs contain plaintext passwords (and, as deferred follow-up, unexpected thrown errors)

## Domain Rationale

**Fit:** weak

Credential-scanning CI tooling (secretlint over collected logs) lives in .github/ and scripts/ci; there is no security or CI domain, so infrastructure is the least-bad home rather than a principled fit.
