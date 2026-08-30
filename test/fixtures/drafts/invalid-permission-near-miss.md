---
id: cht-core-8730
category: bug
domain: authentication
issueNumber: 8730
issueUrl: https://github.com/medic/cht-core/issues/8730
title: Fix permission checks for the contact FAB using con_create_people
lastUpdated: 2026-07-27
summary: Real reviewer finding (PR #131) — the permission con_create_people does not exist.
services:
  - webapp
techStack:
  - angular
tags:
  - con_create_people
source_pr: medic/cht-core#8738
---

## Problem

The fast-action button did not check `con_create_people` before offering the
create-person action.

## Solution

`fast-action-button.service.ts` now consults `con_create_people`. The real
permission is `can_create_people`; every occurrence here is fabricated, and it
leaks into `title` and `tags` as well as the prose.
