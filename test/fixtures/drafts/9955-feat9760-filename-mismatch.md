---
id: cht-core-9735
category: feature
domain: authentication
issueNumber: 9735
issueUrl: https://github.com/medic/cht-core/issues/9735
title: Filename issue token contradicts the frontmatter
lastUpdated: 2026-07-27
summary: Mirrors the real authentication-branch finding — filename says 9760, frontmatter says 9735.
services:
  - api
techStack:
  - oidc
source_pr: medic/cht-core#9955
---

## Problem

The filename encodes issue 9760; the frontmatter claims 9735. One is wrong, and
a consumer deduping on either one gets a different answer.
