---
id: cht-core-6100
category: improvement
domain: contacts
issueNumber: 6200
issueUrl: https://github.com/medic/cht-core/issues/6300
title: Identity fields disagree with each other
lastUpdated: 2026-07-27
summary: id, issueNumber and issueUrl each name a different issue — a partial relink.
services:
  - webapp
techStack:
  - angular
source_pr: medic/cht-core#6400
---

## Problem

Three identity fields, three different numbers. Each is individually well-formed,
so `validate-schema` passes.
