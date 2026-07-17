---
id: cht-core-8551
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 8551
issueUrl: https://github.com/medic/cht-core/issues/8551
title: Reimplement cht-deploy from Python to Node.js for feature parity, plus deploy-time validation, completion-URL output, and a get-all-logs troubleshooting command
lastUpdated: '2026-06-23'
summary: 'The cht-deploy tool was written in Python (tasks.py), forcing a Python runtime alongside the Node.js toolchain used by the rest of cht-core, and it lacked input validation, completion feedback, and a log-collection helper. It was reimplemented in Node.js with feature parity (modular src/), Python removed, tests added, and three bundled bug fixes/features: catch missing values, print the instance URL on completion, and a get-all-logs troubleshooting script.'
services:
  - api
techStack:
  - nodejs
  - javascript
  - python
  - helm
  - kubernetes
  - bash
  - eslint
tags:
  - cht-deploy
  - deployment
  - python-to-node-migration
  - helm
  - kubernetes
  - tooling
  - troubleshooting
  - feature-parity
related_workflows:
  - observability
source_pr: medic/cht-core#9074
source_sha: 4692ee77ad92e4a474506429840a1394749c55da
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - scripts/deploy/cht-deploy
  - scripts/deploy/src/install.js
  - scripts/deploy/src/certificate.js
  - scripts/deploy/src/config.js
  - scripts/deploy/src/error.js
  - scripts/deploy/src/prepare.sh
  - scripts/deploy/troubleshooting/get-all-logs
  - scripts/deploy/tasks.py
concepts:
  - deployment tooling
  - language migration (Python to Node.js)
  - feature-parity reimplementation
  - Helm-based Kubernetes deployment
  - CLI tooling
  - argument/config validation
  - centralized error handling
  - TLS certificate generation
  - log collection for troubleshooting
related_issues: []
stale: false
---

## Problem

cht-deploy was implemented in Python (scripts/deploy/tasks.py), requiring a separate Python toolchain on top of the Node.js stack the rest of cht-core uses, increasing setup/maintenance burden. It also lacked validation for missing config values (#8604), gave no completion feedback (the resulting instance URL was not shown, #8605), and offered no convenient way to gather all logs when troubleshooting a deployment (#8608).

## Root Cause

The deploy script lived in Python (tasks.py), diverging from cht-core's Node.js toolchain, and had no argument/config validation layer, no end-of-run user feedback, and no bundled log-gathering tooling.

## Solution

Rewrote cht-deploy as a Node.js CLI (scripts/deploy/cht-deploy) delegating to modular sources (src/install.js, src/certificate.js, src/config.js, src/error.js) for feature parity with no major refactoring, and deleted tasks.py. Added .eslintrc, .gitignore, package.json wiring, and prepare.sh. Bundled fixes: validation that catches missing values (#8604), printing the instance URL on completion (#8605), and a new troubleshooting/get-all-logs script to collect deployment logs (#8608). Added test coverage per reviewer feedback.

## Code Patterns

Node CLI entry point (scripts/deploy/cht-deploy) delegating to focused src/ modules; centralized error handling in src/error.js; argument/config validation covered by tests/validate-arguments.test.js and src/config.js; bash troubleshooting helper (scripts/deploy/troubleshooting/get-all-logs) for collecting Kubernetes/Helm deployment logs; package.json validation via tests/package-json-validate.test.js.

## Design Choices

Chose Node.js to align cht-deploy with cht-core's existing Node.js toolchain and eliminate the Python dependency. Deliberately targeted feature parity over refactoring (#8551) to limit migration risk. Added tests in response to reviewer (nydr) request that even a basic import/function test be present to catch syntax errors and ease future test additions; reviewer (mrjones-plip) also requested security changes to the new get-all-logs script.

## Related Files

- package.json
- scripts/deploy/cht-deploy
- scripts/deploy/package.json
- scripts/deploy/.eslintrc
- scripts/deploy/.gitignore
- scripts/deploy/src/install.js
- scripts/deploy/src/certificate.js
- scripts/deploy/src/config.js
- scripts/deploy/src/error.js
- scripts/deploy/src/prepare.sh
- scripts/deploy/tasks.py
- scripts/deploy/troubleshooting/get-all-logs
- scripts/deploy/tests/helm.test.js
- scripts/deploy/tests/package-json-validate.test.js
- scripts/deploy/tests/validate-arguments.test.js

## Testing

Added JS test suite under scripts/deploy/tests: helm.test.js, package-json-validate.test.js, and validate-arguments.test.js, introduced after reviewer (nydr) asked for at least a module-import/basic-function test to catch syntax errors and seed future tests. Reviewer (mrjones-plip) confirmed both sad-path and happy-path are well covered and verified that issue #9076 was fixed by the latest changes.

## Related Issues

- #8551: Remove Python from cht-deploy and establish feature parity in Node.js (no major refactoring)
- #8604: Catch missing values (deploy-time input/config validation)
- #8605: Show the instance URL when execution completes
- #8608: Add a get-all-logs troubleshooting command
- #9076: Bug confirmed fixed by the latest changes in this PR (per review)

## Domain Rationale

**Fit:** strong

cht-deploy is deployment tooling that provisions a CHT instance to Kubernetes via Helm; re-implementing the deploy script (Python→Node.js) plus adding deploy-time validation, completion feedback, and a log-gathering command is operational-lifecycle/deploy work, which is squarely infrastructure.
