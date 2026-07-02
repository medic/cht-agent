---
id: cht-core-8026
category: bug
domain: configuration
domainFit: strong
issueNumber: 8026
issueUrl: https://github.com/medic/cht-core/issues/8026
title: Validate empty branding doc to prevent exception in admin branding controller
lastUpdated: '2026-06-22'
summary: An empty branding JSON uploaded via the cht tool caused the admin branding controller to throw because it assumed certain keys existed when populating $scope; the fix checks for key existence and scaffolds the minimal set of keys the template needs.
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

The controller now checks whether the expected keys exist on the branding doc and, when they are missing, creates a minimal set of keys on the $scope objects so the template can still render; the template was adjusted accordingly. A new unit test spec was added for the previously untested controller.

## Code Patterns

Guard branding-doc property access with existence checks and initialize a minimal default object shape before binding to $scope (admin/src/js/controllers/images-branding.js), so the template (admin/src/templates/images_branding.html) renders safely against empty/partial docs.

## Design Choices

Rather than failing on incomplete branding docs, the controller defensively scaffolds the minimum keys the template requires — tolerating empty/partial input from external tooling (cht-conf) instead of assuming a fully-populated document.

## Related Files

- .gitignore
- admin/src/js/controllers/images-branding.js
- admin/src/templates/images_branding.html
- admin/tests/unit/controllers/images-branding.spec.js

## Testing

Added a new unit test file (admin/tests/unit/controllers/images-branding.spec.js) for the previously untested controller, following conventions of existing controller tests, exercising the empty-branding-doc scenario. A reviewer noted one related case not covered by the fix.

## Related Issues

- #8026: admin branding controller throws an exception when an empty branding doc is uploaded via the cht tool

## Domain Rationale

**Fit:** strong

The PR concerns the app branding document (logos, app name/title) edited through the admin UI and uploadable via cht-conf — branding is canonically part of the configuration domain alongside app settings and translations.
