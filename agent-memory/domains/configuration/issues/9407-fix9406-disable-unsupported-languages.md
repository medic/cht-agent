---
id: cht-core-9407
category: bug
domain: configuration
domainFit: strong
issueNumber: 9407
issueUrl: https://github.com/medic/cht-core/issues/9407
title: Disable unsupported languages in default and demo app_settings configuration
lastUpdated: '2026-06-23'
summary: Unsupported (incompletely translated/non-official) languages were selectable to users via the app_settings language configuration; this PR disables them in the default and demo app_settings.json so only supported languages are offered.
services:
  - api
  - webapp
techStack:
  - json
  - javascript
  - webdriverio
tags:
  - languages
  - locales
  - translations
  - i18n
  - app-settings
  - login
  - language-selector
related_workflows: []
source_pr: medic/cht-core#9407
source_sha: 54ea136a3c693b0cbc33ed6879488e54a085f52a
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - config/default/app_settings.json
  - config/demo/app_settings.json
  - tests/e2e/default/login/login-logout.wdio-spec.js
concepts:
  - locale configuration
  - internationalization (i18n)
  - language selection
  - app settings
related_issues: []
stale: false
---

## Problem

Languages that are not fully supported (incomplete or unofficial translations) were enabled in the language list and shown as selectable options to users on the login page and within the app, leading to a degraded, partially-untranslated experience.

## Root Cause

The default and demo app_settings.json configurations marked these unsupported locales as enabled in the languages/locales list, so they surfaced in the language selector served on the login page and the webapp.

## Solution

Updated config/default/app_settings.json and config/demo/app_settings.json to disable the unsupported language entries (toggling their enabled flag off) so they no longer appear as selectable options, and updated the login-logout WebdriverIO e2e spec to reflect the reduced set of available languages.

## Code Patterns

Disabling a locale from the language selector is done purely at the configuration layer by setting the entry's enabled flag to false in the languages list of config/*/app_settings.json — no application code change is required.

## Design Choices

Disabling rather than removing the language entries keeps the configuration intact so a locale can be re-enabled once its translations are complete, and confining the fix to app_settings.json avoids touching application code.

## Related Files

- config/default/app_settings.json
- config/demo/app_settings.json
- tests/e2e/default/login/login-logout.wdio-spec.js

## Testing

Updated the existing login-logout WebdriverIO e2e spec (tests/e2e/default/login/login-logout.wdio-spec.js) to assert the corrected, reduced set of languages available in the login-page language selector.

## Related Issues

- #9406: disable unsupported languages

## Domain Rationale

**Fit:** strong

The change edits the default and demo app_settings.json locale/language configuration to disable unsupported languages; app settings, translations, and locale config are canonically the configuration domain. The login-logout e2e spec was only touched because the language selector lives on the login page, not because the fix concerns authentication.
