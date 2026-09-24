---
id: cht-core-8773
category: bug
domain: data-sync
issueNumber: 8773
issueUrl: https://github.com/medic/cht-core/issues/8773
title: Draft keyed to its own merge PR
lastUpdated: 2026-07-27
summary: The round-1 defect signature — issueNumber holds the PR number, not the issue.
services:
  - api
techStack:
  - nodejs
source_pr: medic/cht-core#8773
---

## Problem

`issueNumber` equals this draft's own `source_pr` number. Schema validation
cannot see this because `/issues/8773` silently redirects to `/pull/8773`.
