---
id: cht-core-7001
category: bug
domain: authentication
issueNumber: 7001
issueUrl: https://github.com/medic/cht-core/issues/7001
title: Token login rejects an expired link
lastUpdated: 2026-07-27
summary: An expired token login link now returns a clear error instead of a blank page.
services:
  - api
techStack:
  - nodejs
source_pr: medic/cht-core#7002
related_issues:
  - cht-core-7003
---

## Problem

An expired token login link rendered a blank page.

## Solution

The handler now checks expiry before rendering and returns a translated error.
Permission checks continue to use `can_create_people` where relevant, and the
scheduled-task field read is `task.state`.
