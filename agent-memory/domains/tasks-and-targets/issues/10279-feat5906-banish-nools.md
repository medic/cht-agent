---
id: cht-core-5906
category: improvement
domain: tasks-and-targets
domainFit: strong
issueNumber: 5906
issueUrl: https://github.com/medic/cht-core/issues/5906
title: 'Banish Nools from the rules engine: remove the Nools emitter/dependency and make declarative (JavaScript) rules config mandatory'
lastUpdated: '2026-06-22'
summary: The rules engine carried two parallel rule-emitter implementations (legacy Nools-based and the newer declarative JavaScript emitter). This PR removes the Nools emitter and library entirely, leaving the declarative emitter as the only path and throwing an error when legacy Nools-format config is supplied.
services:
  - webapp
techStack:
  - javascript
  - typescript
  - nools
  - pouchdb
tags:
  - rules-engine
  - nools
  - declarative-config
  - tasks
  - targets
  - breaking-change
  - technical-debt
related_workflows:
  - task-scheduling
source_pr: medic/cht-core#10279
source_sha: a0334f9de6338536e7a1157b76a9a604733d5942
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/rules-engine/src/rules-emitter/emitter.nools.js
  - shared-libs/rules-engine/src/rules-emitter/emitter.javascript.js
  - shared-libs/rules-engine/src/rules-emitter/index.js
  - shared-libs/rules-engine/src/provider-wireup.js
  - shared-libs/rules-engine/src/index.js
  - config/default/app_settings.json
concepts:
  - rules engine emitters
  - declarative rules configuration
  - legacy code and dependency removal
  - tasks and targets generation
  - fail-fast config validation
related_issues: []
stale: false
---

## Problem

The rules engine maintained two rule-emitter implementations: the legacy Nools-based emitter (a Rete-algorithm rules library) and the newer declarative JavaScript emitter. Supporting Nools required carrying the nools npm dependency and a duplicate emitter/code path that split maintenance and testing across two engines, while the project (issue #5906) wanted to standardize on declarative config.

## Root Cause

shared-libs/rules-engine/src/rules-emitter/index.js selected between emitter.nools.js and emitter.javascript.js based on the rules config format, and provider-wireup.js/index.js wired up the chosen emitter. The Nools branch kept the nools library and a second emitter implementation alive purely for backwards compatibility with the old rules-string format.

## Solution

Removed emitter.nools.js and the nools dependency from package.json/package-lock.json (and webapp/package-lock.json), leaving emitter.javascript.js as the sole emitter. Updated rules-emitter/index.js and provider-wireup.js to drop the Nools selection path and instead throw an explicit error when a Nools-format rules config is supplied, recompiled config/default/app_settings.json to the declarative format, and updated unit/integration/e2e tests to match.

## Code Patterns

Emitter selection consolidated to a single declarative path in shared-libs/rules-engine/src/rules-emitter/index.js; legacy-format detection now throws an explicit error rather than silently falling back to a second engine — a fail-fast pattern for removing a deprecated configuration format.

## Design Choices

Rather than deprecating Nools gradually, the PR removes it outright and fails fast (throws) on legacy Nools config, forcing configurers to migrate to declarative tasks.js/targets.js. This eliminates a runtime dependency and a duplicate code path at the cost of a breaking change for any config still using the old rules format (documented as a backwards-incompatible change).

## Related Files

- shared-libs/rules-engine/src/rules-emitter/emitter.nools.js
- shared-libs/rules-engine/src/rules-emitter/emitter.javascript.js
- shared-libs/rules-engine/src/rules-emitter/index.js
- shared-libs/rules-engine/src/provider-wireup.js
- shared-libs/rules-engine/src/index.js
- config/default/app_settings.json
- package.json
- package-lock.json
- webapp/package-lock.json
- webapp/tests/karma/ts/services/rules-engine.service.spec.ts

## Testing

Updated rules-engine unit/integration tests (integration.spec.js, provider-wireup.spec.js, rules-emitter.spec.js, mocks.js) to drop Nools cases and assert the error thrown on legacy config; updated the webapp karma rules-engine.service.spec.ts; and aligned e2e specs across tasks (due-dates), targets (target-accuracy, aggregates-helper-functions), contacts, enketo contact-summary, analytics, and translations with the declarative-only engine, including the recompiled default config via tests/utils/cht-conf.js.

## Related Issues

- #5906: Make declarative rules config mandatory / banish Nools from the rules engine

## Domain Rationale

**Fit:** strong

The PR removes the Nools rule emitter from the shared rules-engine — the engine that compiles configured rules into tasks and targets — with nearly all source and e2e changes living under shared-libs/rules-engine, tests/e2e/default/tasks, and tests/e2e/default/targets. The compiled app_settings recompile is a downstream artifact, not a configuration-schema change, so this is squarely the tasks-and-targets engine rather than the configuration domain.
