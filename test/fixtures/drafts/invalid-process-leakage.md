---
id: cht-core-9951
category: bug
domain: infrastructure
issueNumber: 9951
issueUrl: https://github.com/medic/cht-core/issues/9951
title: Avoid circular call when clearing the deploy-info cache
lastUpdated: 2026-07-27
summary: Real reviewer nitpick (PR #121) — classifier scaffolding left in Domain Rationale.
services:
  - api
techStack:
  - nodejs
source_pr: medic/cht-core#9953
---

## Domain Rationale

Per the classification seeds this is infrastructure: the deploy-info cache is
deployment tooling, so the CI/Docker pitfall does not apply. CI green, all 47
checks pass.
