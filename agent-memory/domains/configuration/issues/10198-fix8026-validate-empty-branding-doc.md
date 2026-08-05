---
id: cht-core-8026
category: bug
domain: configuration
domainFit: strong
issueNumber: 8026
issueUrl: https://github.com/medic/cht-core/issues/8026
title: Validate empty branding doc to prevent exception in admin branding controller
lastUpdated: '2026-07-30'
summary: An empty branding JSON uploaded via the cht tool caused the admin branding controller to throw because it assumed certain keys existed when populating $scope; the fix guards those reads, scaffolds an empty `resources` object so the submit path has something to write to, and makes the template skip the images that are missing.
services:
  - admin
techStack:
  - javascript
  - angularjs
  - html
tags:
  - branding
  - validation
  - error-handling
  - defensive-programming
  - admin-ui
  - unit-tests
related_workflows: []
source_pr: medic/cht-core#10198
source_sha: d9b2ef57501162427db35c3ad9655a0ac6cd5393
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - admin/src/js/controllers/images-branding.js
  - admin/src/templates/images_branding.html
concepts:
  - defensive key-existence checking
  - AngularJS controller $scope initialization
  - branding configuration document
  - minimal default scaffolding for templates
related_issues: []
stale: false
---

## Problem

When an empty (or partial) branding JSON document was uploaded via the cht/cht-conf tool, the admin branding controller threw an exception because it assumed certain keys were present in the branding doc while populating $scope objects, breaking the branding admin page.

## Root Cause

images-branding.js read keys off the branding document and populated $scope objects without guarding for their absence, so a branding doc lacking those keys (e.g. an empty one pushed via cht-conf) produced an undefined-access exception.

## Solution

The controller now scaffolds a single empty `resources` object on `$scope.doc` when it is absent, guards the `$scope.favicon`/`$scope.icon` assignments behind `if (doc._attachments && doc.resources)` so they stay undefined rather than being faked, extends the submit guard to reject a doc with no `resources`, and moves the initial fetch into `this.$onInit`. Template safety comes from new `ng-if="favicon"` / `ng-if="icon"` attributes on the two `<img>` tags, not from scaffolded keys. A new unit test spec was added for the previously untested controller.

## Code Patterns

Guard branding-doc property access with existence checks rather than faking the missing values: leave `$scope.favicon`/`$scope.icon` undefined when the doc has no attachments or no `resources` (admin/src/js/controllers/images-branding.js), and let the template skip those elements with `ng-if` (admin/src/templates/images_branding.html). The one thing that is scaffolded is an empty `resources` object, because the submit path writes into it. Pairing an undefined-tolerant controller with `ng-if` in the template keeps a partial doc renderable without inventing data for it.

## Design Choices

Rather than failing on incomplete branding docs, the controller tolerates them: missing image keys stay undefined instead of being given placeholder values, and the template hides the corresponding elements. Only `resources` is scaffolded, and only because the submit path needs an object to write into — the submit guard still refuses a doc without it. The effect is that empty/partial input from external tooling (cht-conf) renders rather than throwing, without the page implying images that do not exist.

## Related Files

- .gitignore
- admin/src/js/controllers/images-branding.js
- admin/src/templates/images_branding.html
- admin/tests/unit/controllers/images-branding.spec.js

## Testing

Added a new unit test file (admin/tests/unit/controllers/images-branding.spec.js) for the previously untested controller, following conventions of existing controller tests, exercising both the empty-branding-doc and null-resources scenarios.

## Related Issues

- #8026: admin branding controller throws an exception when an empty branding doc is uploaded via the cht tool

## Domain Rationale

**Fit:** strong

The PR concerns the app branding document (logos, app name/title) edited through the admin UI and uploadable via cht-conf — branding is canonically part of the configuration domain alongside app settings and translations.
