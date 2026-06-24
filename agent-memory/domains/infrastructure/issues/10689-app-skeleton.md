---
id: cht-core-10689
category: feature
domain: infrastructure
domainFit: strong
issueNumber: 10689
issueUrl: https://github.com/medic/cht-core/issues/10689
title: 'Scaffold new admin-tool Angular application: build config (Angular CLI/webpack/Karma), routing, shell/header/sidebar components, theming, and stub feature modules'
lastUpdated: '2026-06-22'
summary: 'Introduces the initial skeleton for a new Angular-based admin-tool application: build tooling (Angular CLI, custom webpack, Karma), LESS theming, the app/shell routing structure with header and sidebar, environment/polyfill setup, and stub feature modules (each a component plus routes) for authorization, backup, display, export, forms, images, message-queue, sms, targets, upgrade, and users.'
services:
  - admin
techStack:
  - typescript
  - angular
  - webpack
  - less
  - karma
tags:
  - scaffolding
  - admin-tool
  - angular
  - skeleton
  - build-tooling
  - routing
  - monorepo-subapp
related_workflows: []
source_pr: medic/cht-core#10689
source_sha: d2ea48fbd1845c124692b5629631efa25f32d8e9
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - admin-tool/angular.json
  - admin-tool/custom-webpack.config.js
  - admin-tool/package.json
  - admin-tool/src/ts/app-routing.module.ts
  - admin-tool/src/ts/app.component.ts
  - admin-tool/src/ts/modules/shell/main-layout.component.ts
  - admin-tool/src/ts/components/header/header.component.ts
  - admin-tool/src/ts/components/sidebar/sidebar.component.ts
  - admin-tool/tests/karma/karma-unit.conf.js
concepts:
  - Angular application scaffolding
  - monorepo sub-application (standalone package.json/angular.json within cht-core)
  - module-per-feature routing with separate .routes.ts files
  - shell/main-layout composition (header + sidebar)
  - custom webpack layered over Angular CLI
  - environment split (dev/prod) and Karma unit-test harness
related_issues: []
stale: false
---

## Problem

There was no standalone, modern Angular foundation for the new admin-tool; the admin interface needed a fresh, consistently-structured scaffold (build config, routing, shell layout, theming, test harness) before any feature work could begin. This is foundational scaffolding rather than a defect fix.

## Root Cause

Not a bug — the admin-tool application did not yet exist as a standalone Angular project. The change establishes the architectural baseline: a monorepo sub-app with its own build tooling and a uniform feature-module structure so subsequent admin features have a place to live.

## Solution

Created a new Angular app under admin-tool/ comprising: build/config (angular.json, custom-webpack.config.js, package.json/lock, .npmrc), LESS theming (common/main/theme/variables.less), the root app component + app-routing.module.ts, header and sidebar components, a shell main-layout component wiring them together, environment files (environment.ts/environment.prod.ts) and polyfills, a Karma unit-test harness (base + env conf, test.ts), and one stub feature module per domain area — each with a <module>.component.ts and <module>.routes.ts for authorization, backup, display, export, forms, images, message-queue, sms, targets, upgrade, and users.

## Code Patterns

Uniform feature-module scaffold: each folder under admin-tool/src/ts/modules/<feature>/ pairs <feature>.component.ts with <feature>.routes.ts, all wired through admin-tool/src/ts/app-routing.module.ts (supports lazy routing and clear separation). Shell pattern: admin-tool/src/ts/modules/shell/main-layout.component.ts(.html) composes components/header and components/sidebar. Build customization via admin-tool/custom-webpack.config.js (@angular-builders/custom-webpack). Karma config split into tests/karma/karma-unit.base.conf.js + karma-unit.conf.js with test.ts as the entry.

## Design Choices

Built as a standalone Angular sub-application within the cht-core monorepo (its own package.json, .npmrc, angular.json) rather than folding the admin UI into the existing webapp; organized by feature-module-with-routes for separation and lazy-loading; layered a custom webpack config over the Angular CLI for build flexibility; split dev/prod environments. Reviewer noted this is a strong starting point with some AI-generated over-eagerness trimmed back during review ('cleaning up claude being careless or overzealous').

## Related Files

- admin-tool/angular.json
- admin-tool/package.json
- admin-tool/custom-webpack.config.js
- admin-tool/src/ts/main.ts
- admin-tool/src/ts/app.component.ts
- admin-tool/src/ts/app-routing.module.ts
- admin-tool/src/ts/modules/shell/main-layout.component.ts
- admin-tool/src/ts/components/header/header.component.ts
- admin-tool/src/ts/components/sidebar/sidebar.component.ts
- admin-tool/src/css/theme.less
- admin-tool/tests/karma/karma-unit.base.conf.js
- admin-tool/tests/karma/karma-unit.conf.js

## Testing

Scaffolded a Karma unit-test harness (tests/karma/karma-unit.base.conf.js, karma-unit.conf.js, test.ts) to establish the unit-testing infrastructure; as a skeleton PR it stands up the test tooling rather than substantial coverage. The change was also reviewed via a full manual read by dianabarsan, who left cleanup comments.

## Related Issues

_none_

## Domain Rationale

**Fit:** strong

The PR is net-new build tooling and application scaffolding (Angular CLI config, custom webpack, package.json/lock, Karma harness, routing skeleton, shell/theme) for a brand-new admin-tool app; build tooling/scaffolding is canonically infrastructure. It deliberately spans many functional areas via stub modules (users, sms, forms, targets, etc.) without implementing any one of them, so no single functional domain applies — infrastructure is the principled bin, not a catch-all.
