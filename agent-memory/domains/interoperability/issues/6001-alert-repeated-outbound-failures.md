---
id: cht-core-6001
category: improvement
domain: interoperability
subDomain: outbound-push
issueNumber: 6001
issueUrl: https://github.com/medic/cht-core/issues/6001
title: Alert when outbound pushes are repeatedly failing
lastUpdated: 2020-06-24
summary: When outbound pushes failed, sentinel silently retried every 5 minutes with no way to notify administrators. The issue was closed (Jun 24, 2020) without new code by leveraging the /api/v1/monitoring endpoint introduced in CHT 3.9.0 — specifically the outbound_push.backlog count, where a value greater than zero indicates a push has failed within the last 5 minutes.
services:
  - sentinel
  - api
techStack:
  - javascript
  - nodejs
---

## Problem

When the external server targeted by an outbound push went offline, sentinel would log an error and retry every five minutes — but there was no mechanism to proactively notify a responsible person. For a small number of outbound pushes this was manageable, but at scale (many CHWs, many documents) a silently-failing integration could mean thousands of missed pushes before an administrator noticed via log review. Options discussed included Slack, email, SMS alerts, and cron-based queue scanning.

## Root Cause

No alerting or monitoring hook existed for outbound push failures. The failure information was only surfaced in the sentinel log file. There was also no count or age-based metric exposed outside of sentinel to external monitoring tools.

## Solution

**No new code was written.** The issue was closed by recognising that two changes already shipped in CHT 3.9.0 together provided a minimal but sufficient alerting path:

1. **Monitoring API** (`/api/v1/monitoring`): CHT 3.9.0 introduced a monitoring API endpoint that exposes system health metrics in a structured format. This includes the `outbound_push.backlog` field — the count of queued outbound push tasks.

2. **Immediate push in 3.9.0** (#6306): Because outbound now attempts to push immediately on document creation, a task only ends up in the queue if the immediate attempt failed. Therefore `outbound_push.backlog > 0` directly indicates that an outbound push has failed within the last ~5 minutes.

The recommended approach: connect the monitoring API to existing infrastructure monitoring tooling (Prometheus, Grafana, uptime monitors, etc.) and alert when `outbound_push.backlog > 0`.

Future improvements discussed but not implemented:
- Count tasks with >10 failures separately
- Count tasks with >60 minutes of age (preferred by @SCdF for reducing noise)

## Code Patterns

- `GET /api/v1/monitoring` returns a JSON object; check `outbound_push.backlog` — any value greater than 0 means at least one outbound push is queued (i.e. failed its immediate attempt)
- The monitoring endpoint is the correct integration point for external alerting tools; do not scrape sentinel logs for outbound errors
- Pattern: use the monitoring API as the source of truth for operational health checks — it is a stable, versioned endpoint unlike log formats which can change
- The monitoring API also exposes `outbound_push.last_successful_run` and similar fields useful for more nuanced alerting

## Design Choices

- Chose to close without new code by leveraging the monitoring API already in 3.9.0, rather than building a bespoke alerting mechanism in sentinel (e.g. Slack webhooks, email)
- @garethbowen's rationale: "the minimal solution is fine for now — see how it performs in a real world scenario before trying to improve it"
- Chose `backlog > 0` (simple queue depth) as the alert signal rather than failure count or task age, for simplicity; acknowledged as potentially noisy but acceptable for an initial solution
- A more sophisticated alternative (task age >60 min as signal) was deferred; it would reduce false positives from transient server blips

## Related Files

- api/src/controllers/monitoring.js (or equivalent monitoring API controller)
- api/src/services/monitoring.js

## Testing

- No new tests were written for this issue (no new code)
- The monitoring API endpoint (`/api/v1/monitoring`) has its own existing tests verifying the `outbound_push.backlog` field is accurately populated

## Related Issues

- #6306: Send outbound push without delay (the 3.9.0 change that made backlog > 0 meaningful as a failure signal)
- #6024: The outbound error response logging is needlessly verbose (companion operational visibility improvement)
