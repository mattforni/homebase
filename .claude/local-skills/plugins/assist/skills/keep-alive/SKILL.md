---
name: keep-alive
description: Keep the session's prompt cache warm while Forni steps away, with a self paced loop that wakes every 50 minutes and does nothing else unless given a watch task, then end it the moment he is back. Use whenever Forni says "keep alive", "keep this alive", "keep the cache warm", "I'm heading out", "going for a run", "back in an hour", or invokes "/assist:keep-alive", optionally with something to watch while he is gone ("keep alive and watch the landers").
allowed-tools:
  - Skill
  - ScheduleWakeup
  - Bash(date:*)
---

# Keep Alive

Hold the session open while Forni is away, so nothing has to be rebuilt from a cold cache when he returns. Built on the core `/loop` in dynamic mode; this skill only fixes the interval, the tick, and the ending.

## Before Every Invocation

1. Read this skill's local [learned-rules.md](learned-rules.md). It overrides anything below.
2. Read the plugin wide [learned-rules.md](../../learned-rules.md).

## Start

1. Run `date "+%H:%M %Z"` for the start time.
2. Invoke the `loop` skill with no interval, so it self paces, and this prompt: `keep-alive tick` followed by the watch task if Forni gave one. The tick below is what that prompt means.
3. Tell Forni in one line: the loop is on, it wakes every 50 minutes, and his next message ends it. Name the watch task if there is one.

## Each Tick

- **No watch task:** do nothing. No tool calls, no status. Call `ScheduleWakeup` with `delaySeconds: 3000`, `noop: true`, the same prompt, and a reason of "holding the cache while Forni is away".
- **With a watch task:** run it, post one or two lines only when something changed, then schedule the same way with `noop` false when something changed. A watch task is read only unless Forni's instruction said otherwise; never merge, deploy, send, or write to a client surface on a tick.

50 minutes sits inside the one hour cache lifetime with room for the scheduler's jitter.

## End

**Forni's first message that is not a tick ends the loop,** before anything else in that reply: call `ScheduleWakeup` with `stop: true`, and if a cron job was used instead, `CronDelete` it. Then say in one line that keep alive is off and how long it ran, and carry on with what he asked. A background agent's report or a task notification is not Forni and does not end it.

## Learned Rules

See [learned-rules.md](learned-rules.md).
