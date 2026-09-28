---
id: cht-core-9552
category: bug
domain: tasks-and-targets
issueNumber: 9552
issueUrl: https://github.com/medic/cht-core/issues/9552
title: Migrate stale target state for interval turnover
lastUpdated: 2026-07-27
summary: Backport of the same issue 9552 — the other half of the duplicate cluster.
services:
  - webapp
techStack:
  - rules-engine
source_pr: medic/cht-core#9570
---

## Problem

A backport distilled as a second memory for one issue. Both files claim
`medic/cht-core#9552`, so a consumer deduping by issue id sees two answers.
