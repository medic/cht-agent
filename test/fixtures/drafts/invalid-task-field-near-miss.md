---
id: cht-core-10802
category: bug
domain: messaging
issueNumber: 10802
issueUrl: https://github.com/medic/cht-core/issues/10802
title: Message stuck in pending state
lastUpdated: 2026-07-27
summary: Real reviewer finding (PR #120) — task.status and the isDue snippet are fabricated.
services:
  - sentinel
techStack:
  - nodejs
source_pr: medic/cht-core#10803
---

## Solution

The scheduled-task sweep now reads the task state directly:

```javascript
if (task.status === 'scheduled' && isDue(task.due_date)) {
  send(task);
}
```

The real field is `task.state`; neither `task.status` nor a `due_date` field
exists on a scheduled task.
