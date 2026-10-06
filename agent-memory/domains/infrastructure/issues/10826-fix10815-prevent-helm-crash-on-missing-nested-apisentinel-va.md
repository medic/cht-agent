---
id: cht-core-10815
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 10815
issueUrl: https://github.com/medic/cht-core/issues/10815
title: Prevent Helm upgrade crash when api/sentinel blocks are missing from older 5.1 values.yaml files
lastUpdated: '2026-10-05'
summary: 'Values files taken from 5.1 instances that lack `sentinel:` or `api:` blocks crashed `helm upgrade` of the in-repo chart at scripts/build/helm with a nil-pointer error on `.Values.sentinel.node_env` (a read added by PR #10758). Fixed by wrapping every api/sentinel value read in the api and sentinel templates in an empty-dict fallback, for example `(default (dict) .Values.sentinel).node_env`, and adding a backwards-compatibility render case.'
services:
  - api
  - sentinel
techStack:
  - helm
  - kubernetes
  - yaml
  - go-templates
  - bash
tags:
  - helm
  - helm-upgrade
  - backwards-compatibility
  - nil-safety
  - deployment
  - regression-test
  - kubernetes
related_workflows: []
source_pr: medic/cht-core#10826
source_sha: f5332b358942b949224d4832538b6778e300bbb2
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - scripts/build/helm/templates/api/deployment.yaml
  - scripts/build/helm/templates/api/service.yaml
  - scripts/build/helm/templates/sentinel/deployment.yaml
  - scripts/build/helm/tests/backwards-compat.yaml
  - scripts/build/helm/validate-templates.sh
concepts:
  - Helm Go-template nil-safe value access
  - default value fallback
  - chart backwards compatibility
  - upgrade lifecycle
  - regression test fixtures
related_issues:
  - cht-core-10754
  - cht-core-10357
stale: false
---

## Problem

Before this PR, running `helm upgrade` against the in-repo chart at scripts/build/helm on master with a values file extracted from a 5.1 instance failed: the render hit a nil pointer evaluating `.Values.sentinel.node_env` in scripts/build/helm/templates/sentinel/deployment.yaml. Such values files can lack the `sentinel:` or `api:` blocks that the templates at this PR's parent assumed were present; the 5.1 releases' scripts/build/helm/values/base.yaml had an `api:` block (only `service.type`) and no `sentinel:` block.

## Root Cause

At this PR's parent, scripts/build/helm/templates/sentinel/deployment.yaml read `.Values.sentinel.node_env` (from PR #10758) and `.Values.sentinel.log_level` (from PR #10583); scripts/build/helm/templates/api/deployment.yaml read `.Values.api.node_env` (PR #10758), `.Values.api.log_level` (PR #10583) and `.Values.api.port`; and scripts/build/helm/templates/api/service.yaml read `.Values.api.service.type`. The last two date from PR #10051, which added the chart. When the parent `api:` or `sentinel:` block is absent from the values file, the Go template evaluates the parent to nil and reading a field on nil fails the render. scripts/build/helm/values/base.yaml defines both blocks at this PR's parent, so renders that layer it did not hit the crash.

## Solution

Wrapped every `api`/`sentinel` value read in scripts/build/helm/templates/sentinel/deployment.yaml, scripts/build/helm/templates/api/deployment.yaml and scripts/build/helm/templates/api/service.yaml in an empty-dict fallback — for example `(default (dict) .Values.sentinel).node_env`, `(default (dict) .Values.api).port`, and, two levels deep in the service template, `(default (dict) (default (dict) .Values.api).service).type` — so a missing parent block falls back to an empty dict and the read's existing `| default` value applies instead of the render crashing. The image line in scripts/build/helm/templates/sentinel/deployment.yaml gained the missing `| default "public.ecr.aws/medic"` fallback, for parity with scripts/build/helm/templates/api/deployment.yaml. The existing scripts/build/helm/validate-templates.sh gained a backwards-compatibility render case, fed by a new fixture, scripts/build/helm/tests/backwards-compat.yaml.

## Code Patterns

Nil-safe nested Helm value access: in `(default (dict) .Values.sentinel).log_level | default "info"` the parenthesised part evaluates to an empty dict when the `sentinel:` block is omitted, so the field resolves to empty and the trailing `| default` supplies the value instead of the render crashing. Two levels deep it nests, as in `(default (dict) (default (dict) .Values.api).service).type | default "ClusterIP"` in scripts/build/helm/templates/api/service.yaml. Applied in scripts/build/helm/templates/api/deployment.yaml, scripts/build/helm/templates/api/service.yaml and scripts/build/helm/templates/sentinel/deployment.yaml, and still in place on master. Image registry fallback: `{{ .Values.upstream_servers.docker_registry | default "public.ecr.aws/medic" }}`.

## Design Choices

Followed the `default`-dict idiom already present in scripts/build/helm/templates/haproxy/deployment.yaml, which passes pre-filled dicts (`(default (dict "port" "5984") .Values.haproxy).port`). This PR's api and sentinel templates use an empty `(dict)` instead, since every wrapped read already ends in its own `| default` fallback. The issue thread had proposed Helm's built-in `dig` instead (`dig "sentinel" "node_env" "production" .Values`), and a maintainer agreed to that plan; the PR description gives matching the existing haproxy convention as the reason for the `default`-dict form. Locked in the behavior with a dedicated regression fixture rendered without scripts/build/helm/values/base.yaml, which defines both blocks and would otherwise mask the crash.

## Related Files

- scripts/build/helm/templates/api/deployment.yaml
- scripts/build/helm/templates/api/service.yaml
- scripts/build/helm/templates/sentinel/deployment.yaml
- scripts/build/helm/tests/backwards-compat.yaml (added)
- scripts/build/helm/validate-templates.sh

## Testing

The new fixture scripts/build/helm/tests/backwards-compat.yaml sets no `api:` or `sentinel:` sections (its header comment calls it a pre-5.1 values file). The existing scripts/build/helm/validate-templates.sh gained a "Backwards compat (no api/sentinel sections) - K3s-K3d" `run_validation` case that renders `-f values/deployment-single.yaml -f values/platform-k3s-k3d.yaml` plus the fixture (paths relative to scripts/build/helm), leaving out `values/base.yaml`; none of those three files defines an `api:` or `sentinel:` block. With it the script runs 13 `run_validation` cases, as it still does on master.

## Related Issues

- #10815: "Existing helm chart fails after recent changes on helm chart" — this draft's issue; a values file extracted from a 5.1 instance failed `helm upgrade` against master's scripts/build/helm on `.Values.sentinel.node_env`.
- PR #10758: "fix(#10754): set NODE_ENV to production in Docker images" — source of the `.Values.api.node_env` and `.Values.sentinel.node_env` reads that this PR made nil-safe; it also put `node_env` defaults in scripts/build/helm/values/base.yaml.
- PR #10583: "fix(#10357): prevent DEBUG logs from appearing in production" — source of the `.Values.api.log_level` and `.Values.sentinel.log_level` reads, also made nil-safe here; it also gave scripts/build/helm/values/base.yaml its `sentinel:` block.

## Domain Rationale

**Fit:** strong

This is a Helm chart fix addressing a nil-pointer crash during the `helm upgrade` lifecycle. Helm/deploy/upgrade-lifecycle work is canonically infrastructure, not configuration.
