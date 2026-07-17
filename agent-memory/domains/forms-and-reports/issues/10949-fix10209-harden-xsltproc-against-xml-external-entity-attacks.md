---
id: cht-core-10209
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 10209
issueUrl: https://github.com/medic/cht-core/issues/10209
title: Harden xsltproc XForm transformation against XML External Entity (XXE) attacks
lastUpdated: '2026-06-22'
summary: The api generate-xform service piped admin-uploaded XForm XML to xsltproc with no restriction on external entity resolution, letting an admin exfiltrate arbitrary api-container files via an XXE payload (CWE-611). Fixed by rejecting XForms that declare a DOCTYPE/ENTITY and passing --nonet to xsltproc.
services:
  - api
techStack:
  - javascript
  - nodejs
  - xsltproc
  - xslt
  - xml
  - mocha
tags:
  - security
  - xxe
  - cwe-611
  - xsltproc
  - xform
  - input-validation
  - defence-in-depth
  - hardening
related_workflows: []
source_pr: medic/cht-core#10949
source_sha: 3775e36dfecd9d8b0f27b1cd7c355f26949248ee
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/generate-xform.js
concepts:
  - XML External Entity (XXE) prevention
  - input validation allowlist
  - defence in depth
  - child process / external XML processor hardening
  - XForm-to-HTML transformation pipeline
related_issues: []
stale: false
---

## Problem

CHT api forwards admin-uploaded XForm XML to xsltproc (via stdin) to render form HTML and the XForm model. xsltproc was invoked with no restriction on external resource resolution, so an admin able to upload a form could embed an XXE payload that read arbitrary files from the api container filesystem and exfiltrated them into the resulting form HTML (OWASP XXE / CWE-611).

## Root Cause

In api/src/services/generate-xform.js the xsltproc child process was spawned without --nonet or any other restriction on external DTD/entity resolution, and no validation rejected XForms declaring a DOCTYPE or external ENTITY before the tainted XML reached the XML/XSLT processor.

## Solution

Two complementary defences in generate-xform.js: (1) a strict input allowlist that rejects any XForm declaring a DOCTYPE or external ENTITY before spawning, stripping XML comments first so benign comments mentioning the literal text <!DOCTYPE / <!ENTITY are not flagged; (2) passing --nonet as the first argument to xsltproc so libxml2 refuses to resolve external resources (DTDs, entities, stylesheets) over the network. Validation runs before childProcess.spawn, so tainted input never reaches xsltproc.

## Code Patterns

Validate/reject untrusted XML against an allowlist before spawning an external XML processor; strip XML comments prior to scanning for forbidden constructs (<!DOCTYPE/<!ENTITY) to avoid false positives on benign content; pass --nonet to xsltproc/libxml2 invocations to disable external resource resolution. All in api/src/services/generate-xform.js.

## Design Choices

An input allowlist (reject DOCTYPE/ENTITY) was chosen as the primary, cheapest, and most reliable fix because legitimate CHT XForms never need those constructs; --nonet adds defence-in-depth for any future code path that might slip a DTD past the input check. Comments are stripped first to prevent false-positive rejections. The team's threat assessment in #10209 treated this as defence-in-depth since only an authenticated admin (with the medic password and access to the open-source container) can reach the code path.

## Related Files

- api/src/services/generate-xform.js
- api/tests/mocha/services/generate-xform.spec.js

## Testing

npm run unit-api on generate-xform.spec.js: 46 existing tests pass unchanged, plus 4 new tests — (a) --nonet is the first argument on every xsltproc spawn, (b) XForms with <!DOCTYPE> are rejected with a clear error and xsltproc is never spawned, (c) XForms with <!ENTITY> are rejected the same way, (d) XForms whose comments merely mention the literal text <!DOCTYPE/<!ENTITY> are still accepted (no false positives). npm run lint clean on both files; it was confirmed locally that a malicious form can no longer be uploaded.

## Related Issues

- #10209: XXE vulnerability — authenticated admins can read arbitrary files from the api server filesystem by uploading malicious XForm files

## Domain Rationale

**Fit:** strong

The change hardens api/src/services/generate-xform.js, the service that transforms admin-uploaded XForm XML into the rendered form HTML and XForm model. XForm definition and rendering are core forms-and-reports functionality; the admin/security angle does not make it authentication (no roles/permissions logic changes) nor infrastructure (no CI/build/deploy work).
