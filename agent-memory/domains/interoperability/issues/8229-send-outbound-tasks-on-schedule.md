---
id: cht-core-8229
category: improvement
domain: interoperability
subDomain: outbound-push
issueNumber: 8229
issueUrl: https://github.com/medic/cht-core/issues/8229
title: Send outbound tasks on a schedule
lastUpdated: 2023-10-21
summary: By default, sentinel greedily pushes outbound tasks as soon as documents are received. Some deployments need to batch outbound pushes at specific times (e.g. midnight aggregations, avoiding peak hours for external APIs). This feature added a cron-style scheduling configuration to outbound push targets so deliveries happen only at configured times.
services:
  - sentinel
techStack:
  - javascript
  - nodejs
---

## Problem

Outbound push by default fires as soon as a matching document reaches sentinel (since the immediate-push optimization in 3.9.0). For some integrations this is undesirable:

- External APIs may rate-limit or charge per-call, making batch delivery cheaper
- Downstream analytics systems may prefer a nightly ETL push rather than continuous updates
- Data agreements for some deployments only allow data transfers at certain hours

There was no way to defer outbound pushes to a scheduled time window. Community users raised this limitation on the CHT forum (linked in the issue) after being unable to configure time-windowed delivery.

## Root Cause

The outbound configuration schema only supported enabling/disabling a push target and defining `relevant_to` / `mapping`. There was no scheduling concept. All documents that reached sentinel and passed `relevant_to` would be attempted immediately or queued for the next scheduler tick (every ~5 minutes by default) — there was no way to say "only send between 00:00 and 01:00 UTC".

## Solution

Added a `cron` configuration option to individual outbound push configs (shipped in CHT 4.5.0, merged Oct 21 2023 via PR #8387). The cron rule is a standard cron expression parsed by `later.js`:

```json
"outbound": {
  "my-nightly-push": {
    "cron": "0 0 * * *",
    "relevant_to": "...",
    "destination": { ... },
    "mapping": { ... }
  }
}
```

When `cron` is set, the `execute()` function in the outbound scheduler filters configured pushes upfront — building a `dueConfiguredPushes` map that only includes configs whose cron is within the current 5-minute window (`isWithinTimeFrame`). Configs not yet due are skipped entirely for that scheduler tick; documents still accumulate in the queue and are processed when the next cron window opens. The `mark_for_outbound` transition was also updated to skip queuing an immediate push attempt when a cron is defined and the current time is not within the window.

## Code Patterns

- The `cron` property is optional on each outbound config; omitting it preserves the existing immediate-push behavior
- Filtering happens **upfront in `execute()`** by reducing `configuredPushes` into `dueConfiguredPushes` — only configs where `!config.cron || isWithinTimeFrame(config.cron, FIVE_MINUTES)` pass through; this means the interval is calculated once per config, not once per queued document
- `isWithinTimeFrame(cron, frame)` uses `later.js` (`later.schedule(later.parse.cron(cron)).next()`) to find the next scheduled time, then checks if `Date.now()` falls within `[nextTime - frame, nextTime + frame]`
- The same `isWithinTimeFrame` utility is shared with `mark_for_outbound` transition, which also skips the immediate realtime push attempt when a cron is configured and the window is not active
- Pattern: filter at the config level (not per-document) so the cron window check executes O(configs) times instead of O(queued docs) times

## Design Choices

- Used `cron` as the config property name (over `schedule`) because it directly maps to the `later.js` cron parser and makes the expected format unambiguous for configurers
- Filtering upfront in `execute()` (rather than inside the per-document reduce) was chosen based on reviewer feedback from @dianabarsan: it avoids recalculating the time window for every document in the queue, and keeps the outbound batch loop simpler
- Readable/maintainable code was preferred over micro-optimizing the per-document filter, since the backlog is typically in the hundreds to low thousands, not tens of thousands
- The cron gate is per-outbound-config, so different targets can have different send windows independently

## Related Files

- sentinel/src/schedule/outbound.js
- sentinel/tests/unit/schedule/outbound.spec.js
- shared-libs/transitions/src/transitions/mark_for_outbound.js

## Testing

- Unit tests verify that a config with `cron: "0 0 * * *"` does not trigger a push during the day, but does at midnight
- Verified backward compatibility: configs without `cron` continue to push immediately

## Related Issues

- #6306: Send outbound push without delay (the immediate-push optimization this feature optionally defers)
- #6419: Allow configuring outbound to send the same record multiple times
