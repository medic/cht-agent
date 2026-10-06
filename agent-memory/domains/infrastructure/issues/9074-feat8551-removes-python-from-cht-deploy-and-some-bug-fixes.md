---
id: cht-core-8551
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 8551
issueUrl: https://github.com/medic/cht-core/issues/8551
title: Reimplement cht-deploy from Python to Node.js, plus a missing-values-file check, completion-URL output, and a get-all-logs troubleshooting command
lastUpdated: '2026-10-05'
summary: 'Before this PR, cht-deploy was a bash wrapper that pip-installed Invoke and ran scripts/deploy/tasks.py, so deploying needed a Python toolchain beside the Node.js one the rest of cht-core uses; a missing values file ended in a Python traceback, no instance URL was printed on completion, and no helper collected the logs of all pods (scripts/deploy/troubleshooting/view-logs fetched the logs of the first pod of one deployment). This PR reimplemented it in Node.js (scripts/deploy/cht-deploy plus modules under scripts/deploy/src/), deleted the Python script, added mocha tests, and bundled a missing-values-file check, a completion URL message and a scripts/deploy/troubleshooting/get-all-logs script; the Route53 and /etc/hosts steps of the Python script were not ported. The whole scripts/deploy directory was removed on master by PR #10500.'
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
concepts:
  - deployment tooling
  - language migration (Python to Node.js)
  - Python-to-Node.js port aiming at feature parity
  - Helm-based Kubernetes deployment
  - CLI tooling
  - argument and values-file validation
  - custom error classes
  - TLS certificate retrieval into a Kubernetes secret
  - log collection for troubleshooting
related_issues:
  - cht-core-8604
  - cht-core-8605
  - cht-core-8608
  - cht-core-9076
stale: true
---

> **Paths are as of this PR, not as of master.** The scripts/deploy files below that this PR left
> in place were deleted on master by PR #10500 (`1c3277c4e`, 2026-01-12), which removed the whole
> directory and the root package.json `unit-cht-deploy` script this PR added. The one exception,
> scripts/deploy/.eslintrc, had already gone with the ESLint 9 migration, PR #10066 (`da5fe7f73`).
> The chart the tool installed, `medic/cht-chart-4x` from the medic/helm-charts repository, is not
> what master ships: on master the CHT Helm chart lives in-repo at scripts/build/helm (added by
> PR #10051).

## Problem

Before this PR, scripts/deploy/cht-deploy was a bash wrapper that required python3 and pip3, pip-installed Invoke, PyYAML and requests when missing, and ran `invoke install $@` against scripts/deploy/tasks.py, adding a Python toolchain on top of the Node.js stack the rest of cht-core uses. A values file that did not exist ended in a Python traceback (#8604), the resulting instance URL was not shown on completion (#8605), and there was no convenient way to gather all logs when troubleshooting a deployment (#8608).

## Root Cause

The deploy script lived in Python (scripts/deploy/tasks.py), diverging from cht-core's Node.js toolchain. The bash wrapper only checked that `-f` and a path were given, not that the file existed; scripts/deploy/tasks.py printed no instance URL at the end of a run; the only log helper, scripts/deploy/troubleshooting/view-logs, fetched the logs of one deployment's first pod; and scripts/deploy/tasks.py's `check_namespace_exists` wrote a temporary manifest to `os.path.join(script_dir, "helm", "namespace.yaml")`, but the script's directory had no `helm/` subdirectory, so creating a new namespace failed (#9076).

## Solution

Replaced the bash-plus-Python tool with Node.js. The existing scripts/deploy/cht-deploy became a `#!/usr/bin/env node` ES module that runs `validateNodeVersion` and `validateArguments` (which calls `validateFileExists`) and then `install` from scripts/deploy/src/install.js; scripts/deploy/tasks.py was deleted. New modules sit beside it: scripts/deploy/src/install.js, scripts/deploy/src/certificate.js, scripts/deploy/src/config.js and scripts/deploy/src/error.js, while scripts/deploy/prepare.sh moved unchanged to scripts/deploy/src/prepare.sh. The PR also created scripts/deploy/.eslintrc, scripts/deploy/.gitignore and scripts/deploy/package.json (package `@medic/cht-deploy`), and targeted feature parity with no major refactoring.

The root package.json gained a `unit-cht-deploy` script (`cd scripts/deploy && npm test`) that `ci-compile` runs. Bundled fixes: a values file that does not exist is reported by `validateFileExists` as `File not found: ${filePath}` (#8604); `helmInstallOrUpdate` logs `Instance installed successfully: https://${values.ingress.host}` after an install, or `Instance at https://${values.ingress.host} upgraded successfully.` after an upgrade (#8605); the new scripts/deploy/troubleshooting/get-all-logs collects pod logs (#8608); and a missing namespace is now created by passing `'create-namespace': !namespaceExists` to `helm install` rather than by writing a manifest file (#9076). Not every scripts/deploy/tasks.py step was ported: at this PR's parent its `install` task also called `setup_etc_hosts` (when `environment` was `'local'`) and `add_route53_entry`, and neither has a counterpart under scripts/deploy at this PR.

## Code Patterns

At this PR, the Node CLI entry point scripts/deploy/cht-deploy exported `main`, `validateNodeVersion`, `validateArguments`, `validateFileExists` and `runInstallScript`, and ran `main()` only when invoked directly (it compared `import.meta.url` with `process.argv[1]`), so the specs could import it. At this PR, custom error classes `UserRuntimeError` and `CertificateError` lived in scripts/deploy/src/error.js, and env-overridable defaults in scripts/deploy/src/config.js (for example `CERT_API_URL: process.env.CERT_API_URL || 'https://local-ip.medicmobile.org'`), imported by scripts/deploy/src/certificate.js. `validateNodeVersion` checked `process.version` against `engines.node` (`">=20.11.0"`) in scripts/deploy/package.json with `semver.satisfies`. The bash helper scripts/deploy/troubleshooting/get-all-logs took `<namespace> [since]`, saved each pod's current and previous logs, and archived them as `$NAMESPACE-logs_$TIMESTAMP.tar.gz`.

## Design Choices

Chose Node.js to align cht-deploy with the repo's coding standards and eliminate the Python dependency; issue #8551 also gives easier shipping as an npm package as a reason, and at this PR scripts/deploy/package.json named the package `@medic/cht-deploy` with `bin` entries for `cht-deploy` and the six troubleshooting scripts. scripts/deploy/troubleshooting/get-all-logs collected into a `mktemp -d` directory that `trap 'rm -rf "$LOG_DIR"' EXIT` removed, and warned that the logs may contain Personally Identifiable Information (PII).

## Related Files

- package.json
- scripts/deploy/cht-deploy (present at this PR's anchor; removed on master by PR #10500)
- scripts/deploy/package.json (added; removed on master by PR #10500)
- scripts/deploy/.eslintrc (added; removed on master by PR #10066, the ESLint 9 migration)
- scripts/deploy/.gitignore (added; removed on master by PR #10500)
- scripts/deploy/src/install.js (added; removed on master by PR #10500)
- scripts/deploy/src/certificate.js (added; removed on master by PR #10500)
- scripts/deploy/src/config.js (added; removed on master by PR #10500)
- scripts/deploy/src/error.js (added; removed on master by PR #10500)
- scripts/deploy/src/prepare.sh (moved from scripts/deploy/prepare.sh; removed on master by PR #10500)
- scripts/deploy/tasks.py (deleted)
- scripts/deploy/troubleshooting/get-all-logs (added; removed on master by PR #10500)
- scripts/deploy/tests/helm.test.js (added; removed on master by PR #10500)
- scripts/deploy/tests/package-json-validate.test.js (added; removed on master by PR #10500)
- scripts/deploy/tests/validate-arguments.test.js (added; removed on master by PR #10500)

## Testing

At this PR (scripts/deploy was removed on master by PR #10500), three mocha specs were added, run by the `"test": "mocha 'tests/*.js'"` script in scripts/deploy/package.json: scripts/deploy/tests/helm.test.js (6 cases for `helmInstallOrUpdate` and `ensureMedicHelmRepo`, with `child_process.execSync` stubbed by sinon), scripts/deploy/tests/validate-arguments.test.js (5 cases for `validateArguments`, including 'should exit with code 1 if the specified file does not exist') and scripts/deploy/tests/package-json-validate.test.js (4 cases for `validateNodeVersion`). Each spec covers both exit paths and success paths.

## Related Issues

- #8551: "Convert Python Invoke code in the cht-deploy to its JS/TS equivalent" — this draft's issue; it asked for scripts/deploy/tasks.py to be converted to JS/TS to match the repo's coding standards and ease shipping as an npm package.
- #8604: "Catch missing values file in k3d script" — from this PR on, a missing values file stopped scripts/deploy/cht-deploy in `validateFileExists` with `File not found: ${filePath}` instead of a Python traceback.
- #8605: "Show URL when done running k3d script" — from this PR on, `helmInstallOrUpdate` in scripts/deploy/src/install.js showed the instance URL (built from `values.ingress.host`) when an install or upgrade was done.
- #8608: "add a "get all logs" script for k3d deployments" — met by scripts/deploy/troubleshooting/get-all-logs, which archived current and previous pod logs for a namespace; the node and cluster state the issue also asked for was not collected.
- #9076: "CHT Deploy script has error: No such file or directory" — scripts/deploy/tasks.py wrote its namespace manifest into a `helm/` subdirectory of scripts/deploy that did not exist; the Node rewrite created the namespace through `helm install` with `create-namespace` instead, removing that failure path.

## Domain Rationale

**Fit:** strong

cht-deploy was deployment tooling (removed on master by PR #10500) that provisioned a CHT instance to Kubernetes via Helm; re-implementing the deploy script (Python→Node.js) plus adding deploy-time validation, completion feedback, and a log-gathering command is operational-lifecycle/deploy work, which is squarely infrastructure.
