---
id: cht-core-10556
category: feature
domain: configuration
issueNumber: 10556
issueUrl: https://github.com/medic/cht-core/issues/10556
title: Add pt-BR translations
lastUpdated: 2026-07-27
summary: Adds Brazilian Portuguese translation files.
services:
  - webapp
techStack:
  - i18n
source_pr: medic/cht-core#10555
---

## Problem

Fixture for the third filename form `<pr>-<type>-<slug>`, which carries NO issue
token. Reading `feat` as an issue number would invent a contradiction, so this
file must produce no `filename-issue-mismatch` finding even though 10555 != 10556.
