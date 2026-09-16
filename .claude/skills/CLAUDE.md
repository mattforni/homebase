# Local Skills

This directory contains standalone Claude Code skills loaded directly from `~/.claude/skills/`.

Skills here use the flat `<name>/SKILL.md` discovery pattern. They do not require plugin installation.

## Skills

| Skill | Path | Purpose |
|-------|------|---------|
| gws-gmail | `gws-gmail/` | Gmail: send, read, and manage email |
| gws-gmail-triage | `gws-gmail-triage/` | Gmail: unread inbox summary |
| gws-gmail-send | `gws-gmail-send/` | Gmail: send an email |
| gws-gmail-read | `gws-gmail-read/` | Gmail: read a message |
| gws-gmail-reply | `gws-gmail-reply/` | Gmail: reply to a message |
| gws-gmail-reply-all | `gws-gmail-reply-all/` | Gmail: reply all |
| gws-gmail-forward | `gws-gmail-forward/` | Gmail: forward a message |
| gws-calendar | `gws-calendar/` | Google Calendar: manage events |
| gws-calendar-agenda | `gws-calendar-agenda/` | Google Calendar: upcoming events |
| gws-calendar-insert | `gws-calendar-insert/` | Google Calendar: create an event |
| gws-shared | `gws-shared/` | gws CLI: shared patterns |
| chatroom | `chatroom/` | Role diverse multi round agent debate (runs the `chatroom` named workflow) |

## Assist Namespace (Plugin)

The `assist:*` skills (emails, schedule, learn, job-apply) live in the `local-skills` marketplace at `.claude/local-skills/plugins/assist/`. They are installed via `claude plugin install assist@local-skills`. See that directory for details.
