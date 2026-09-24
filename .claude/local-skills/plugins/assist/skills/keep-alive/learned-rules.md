# Keep Alive Learned Rules

Corrections to how `assist:keep-alive` runs. Overrides SKILL.md. Read on every invocation.

- **Self paced, not cron.** Fifty minutes does not divide an hour, so a cron expression either fires unevenly or has to round to thirty. `ScheduleWakeup` at 3000 seconds holds the exact interval. The first hand run, on 2026-09-24, used cron at thirty minutes for that reason.
