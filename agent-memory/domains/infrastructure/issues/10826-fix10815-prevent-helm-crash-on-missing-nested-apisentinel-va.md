---
id: cht-core-10815
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 10815
issueUrl: https://github.com/medic/cht-core/issues/10815
title: Prevent Helm upgrade crash when api/sentinel blocks are missing from older 5.1 values.yaml files
lastUpdated: '2026-06-22'
summary: 'Older 5.1 `values.yaml` files lacking `api:` or `sentinel:` blocks caused a nil-pointer crash during `helm upgrade` after PR #10758. Fixed by switching the affected templates to the nil-safe `(default (dict) .Values.block).key` access pattern.'
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
related_issues: []
stale: false
---

## Problem

Installing/upgrading with an existing 5.1 Helm `values.yaml` on latest master failed with `Error: UPGRADE FAILED` (nil pointer crash). 5.1 values files do not contain `sentinel:` or `api:` blocks, which newer templates assumed were present.

## Root Cause

Changes from PR #10758 introduced unsafe nested value access (e.g. `.Values.api.key` / `.Values.sentinel.key`) in the api and sentinel templates. When the parent `api:` or `sentinel:` block is absent from the values file, the Go template evaluates the parent to nil and dereferencing a key on nil crashes the render.

## Solution

Replaced unsafe nested access in the sentinel and api templates with the `(default (dict) .Values.block).key` pattern (already used by the haproxy templates), so a missing parent block safely falls back to an empty dict instead of crashing. Added the missing `| default "public.ecr.aws/medic"` image fallback in sentinel/deployment.yaml for parity with the api templates. Added a `tests/backwards-compat.yaml` fixture and updated validate-templates.sh to reproduce the regression.

## Code Patterns

Nil-safe nested Helm value access: `(default (dict) .Values.block).key` falls back to an empty dict when the parent block is omitted, so the key resolves to nil/empty rather than crashing the render — applied in scripts/build/helm/templates/api/*.yaml and scripts/build/helm/templates/sentinel/deployment.yaml. Image registry fallback: `<value> | default "public.ecr.aws/medic"`.

## Design Choices

Reused the existing `(default (dict) .Values.block).key` convention from the haproxy templates rather than adding helper functions or forcing users to backfill the missing blocks, keeping upgrades transparent and backwards compatible. Locked in the behavior with a dedicated 5.1-style regression fixture instead of relying on base.yaml.

## Related Files

- scripts/build/helm/templates/api/deployment.yaml
- scripts/build/helm/templates/api/service.yaml
- scripts/build/helm/templates/sentinel/deployment.yaml
- scripts/build/helm/tests/backwards-compat.yaml
- scripts/build/helm/validate-templates.sh

## Testing

Added `scripts/build/helm/tests/backwards-compat.yaml`, a fixture mimicking a 5.1 values file with no `api:`/`sentinel:` blocks, and updated `validate-templates.sh` to render templates without `base.yaml` so it reproduces the original regression. All 13 template-validation tests pass.

## Related Issues

- #10815: helm upgrade from a 5.1 values.yaml fails with a nil-pointer crash due to missing api/sentinel blocks
- #10758: prior PR that introduced the unsafe nested api/sentinel value access

## Domain Rationale

**Fit:** strong

This is a Helm chart fix addressing a nil-pointer crash during the `helm upgrade` lifecycle. Helm/deploy/upgrade-lifecycle work is canonically infrastructure, not configuration.
