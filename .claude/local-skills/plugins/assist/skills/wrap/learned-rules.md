# Wrap Learned Rules

Skill-specific corrections that override SKILL.md. Populate as Forni corrects wrap's judgment over time.

## Loose-end logging

- **Engineering and client work loose ends go to Linear, not Todoist; personal and operational loose ends go to Todoist.** When a session's loose end is code or client work (bugs, tech debt, features, follow-ups from a build session), create or note a Linear ticket (assign Forni), not a Todoist task. The owning rule lives in GC (Linear Ticket Preferences). Steps 4/5/7's Todoist dedupe-and-log path applies only to personal loose ends. Codified 2026-06-23 as a Zero-specific rule after wrap proposed logging a Zero follow-up (the Avoca eval decision) to Todoist; the Zero framing is historical (W2 ended 2026-06-29).

- **Never log a Todoist task for a loose end where the ball is in a counterparty's court.** When the next move belongs to someone else (an email Forni already sent and is awaiting a reply on, a quote a vendor still owes, a decision another party has to make), do not surface it as a triage candidate and do not offer to create a tracking task. These are Step 3's ✅ awaiting-counterparty tier: tracking-only, and for Forni that means no Todoist entry at all. Only log tasks for loose ends where Forni himself is the blocker (⚠️ / 🟡 tiers). Codified 2026-07-17 after wrap offered a task to chase a skylight vendor's scheduling reply; Forni: "The ball is not in my court, so nothing on my side. I don't want to be tracking other people's work."

  **Why:** Tracking other people's obligations creates a false sense of personal load and clutters the queue with items Forni cannot act on. If a counterparty goes quiet, the nudge surfaces naturally when Forni next reviews the thread, not from a self-assigned task.

  **How to apply:** In Step 3, sort ruthlessly by "who owes the next move." Ball on Forni → triage it. Ball on anyone else → mention it in the summary as awaiting-counterparty (✅) for situational awareness, but never route it to Steps 5/7.

## Work search sessions

- **The work search has no Linear issue. Do not open one.** `~/Eudaimonia/Craft/Vocation/FY27-work-search.md` is the log of record, and the cadence lives on the calendar as the recurring 💼 Weekly Work Search block. When a session finishes the week's slate, the applications and supporting activities get rows in that file and nothing else is minted.

  **Why:** a recurring block held in a tracker is a ticket that can never close, which means it is not tracking work, it is holding a cadence, and a calendar already does that better. The record has to survive a tracker anyway, for a MyUI+ audit that will ask for dates, employers, positions, and methods.

  **How to apply:** write the rows, close nothing, open nothing. If a specific piece of work falls out of the search (a profile to finish, a network to register with), that is a real ticket and gets one.

  **Supersedes two earlier rules.** The 2026-07-30 rule had wrap close the ticket and mint the following week's instance (the ATE-428 to ATE-435 to ATE-479 chain); the 2026-08-17 rule replaced that with three permanent standing issues, ATE-479, ATE-480, and ATE-489. Both are gone as of 2026-09-01, when the standing issues were deleted and recurring work moved onto the calendar outright. The outreach roster moved the same way, from the body of ATE-480 to `Outreach/<ISO week>-roster.md` in the Atelic repo.

- **Business follow-ups go to Linear, never Todoist.** Anything in service of
  Atelic (prospect follow-ups, walk-ins, client work, template fixes) is
  tracked as an ATE issue, even when it is an errand rather than code. Todoist
  is for personal and operational tasks only. When the follow-up needs real
  calendar time, hand place a labeled Craft calendar block per
  `~/Eudaimonia/Admin/Tools/google-calendar.md` (the Reclaim label convention
  retired 2026-08-03 with the Linear sync).
  Corrected 2026-07-30 while wrapping the Platform Strength send: the walk-in
  follow-up was offered as a Todoist task and Forni redirected it to Linear.
  Re-corrected the same day when wrap offered Todoist options for a client
  discovery email; Forni: "Nothing related to Atelic goes in Todoist." That is
  the phrasing to hold, now also codified at the point of use in the Atelic
  repo's CLAUDE.md (Execution tracks in Linear bullet). Triage options for any
  Atelic item must offer Linear, not Todoist. The miss happened because this
  file was not read before triage; the SKILL.md body's inline "Learned Rules"
  section is a stale placeholder, so always read this file itself.

## Hand Off

- **No `/rename` in the hand off, and `/compact` is never pasted as a command block; the wrap closes with the line "Compaction ready."** Forni, 2026-09-07: "The rename doesn't actually rename it in the place that I wanted it to so we don't need it anymore. For compact just say compaction ready or something like that. I know how to run compact." The session name survives only as the one pager's H1.
