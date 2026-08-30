---
id: cht-core-9552
category: bug
domain: tasks-and-targets
issueNumber: 9552
issueUrl: https://github.com/medic/cht-core/issues/9552
title: Handle rules-engine stale state after upgrade
lastUpdated: 2026-07-27
summary: Base PR for issue 9552 — one half of a real duplicate cluster (PR #123).
services:
  - webapp
techStack:
  - rules-engine
source_pr: medic/cht-core#9553
---

## Problem

The base PR of a four-PR cluster (9553/9555/9569/9570) that all resolve issue
9552 and were distilled as separate memories.
