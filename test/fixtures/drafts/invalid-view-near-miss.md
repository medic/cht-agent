---
id: cht-core-10598
category: bug
domain: configuration
issueNumber: 10598
issueUrl: https://github.com/medic/cht-core/issues/10598
title: Fix admin languages service DB request
lastUpdated: 2026-07-27
summary: Real reviewer finding (PR #130) — the CouchDB view docs_by_type does not exist.
services:
  - admin
techStack:
  - couchdb
concepts:
  - docs_by_type (CouchDB view)
source_pr: medic/cht-core#10604
---

## Root Cause

The service queried the `docs_by_type` view. The real view is `doc_by_type`
(singular), used by `languages.service.ts`.
