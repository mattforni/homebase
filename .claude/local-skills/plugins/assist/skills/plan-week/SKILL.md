---
name: plan-week
description: Weekly planning, calendar management, and Monday planning session task slotting. Use this skill whenever the user mentions weekly planning, the Monday planning session (07:00, first thing in the deep work block; it ran on Sundays until 2026-08-30), slotting tasks, finding free time, checking what their week looks like, moving or swapping calendar events, or wants help fitting something into their week. Also trigger when the user asks about V2MOM measure coverage. Training plan scheduling lives in `assist:plan-training`; this skill calls into it during the weekly planning session.
argument-hint: "[plan | week | slot | move]"
allowed-tools:
  - Skill
  - Bash
  - mcp__claude_ai_Strava__*
  - Read
  - Edit
  - Write
  - AskUserQuestion
---

# Plan Week Assist

Help Forni plan his week: review the calendar, slot Todoist tasks into open time, and make calendar adjustments while respecting training and recovery constraints.

## Before Every Invocation

1. Read this skill's local [learned-rules.md](learned-rules.md) for prior corrections about how Forni wants planning to run
2. Read the plugin-wide [learned-rules.md](../../learned-rules.md) for any schedule-specific corrections
3. Read the weekly template: `~/Eudaimonia/schedule.md`
4. Determine the ISO week being planned: the week that holds the coming planning Monday, which is today's week when the session runs on its Monday morning and the week starting tomorrow when it runs a day early on a Sunday. The session runs Monday 07:00 to 08:00, first thing in the deep work block (moved off Sunday mornings 2026-08-30), so the ISO week that closed most recently is the retro's subject (Review Week) and the week ahead is the planning target
5. **Cut and enter a `wk-<ISO week>` worktree** in each repo the session will touch (Eudaimonia for planning artifacts, homebase for skill or config edits). Planning runs in an isolated worktree, never on a shared branch, so a branch switch in another terminal cannot move the ground under the session. All planning edits land in the worktree copy.
6. **Start the session timer** per Session Timers in `~/Eudaimonia/Admin/Tools/toggl.md`: project `🗺️ Planning`, description `🗺️ Weekly Planning`.
7. **Find the emailed retro.** The retro runner (homebase `runners/retro/`, a Cloud Run Job fired Monday 05:00 Denver; `~/Eudaimonia/Admin/Tools/cloud-run.md`) mails `YYYY-Www Retro` from `Claude <claude@atelic.me>` to the personal mailbox, where `YYYY-Www` is the week that closed yesterday (Review Week's subject from step 4), not the planning target. Find it by subject (`GWS_FORCE_PROFILE=personal gws gmail users messages list` with `q` set to `subject:"YYYY-Www Retro" from:claude@atelic.me`; the explicit override, because a Bash shell inherits whichever profile launched it) and read it with `GWS_FORCE_PROFILE=personal gws gmail +read --id <id>`. It is Review Week's first pass; when it is missing, or the subject arrives over a failure body, Review Week falls back to its own pulls.

**Calendar access:** reads and writes go through the `gws` CLI via Bash, not a Google Calendar MCP. Find calendar IDs with `gws calendar calendarList list`. Pull with `gws calendar events list`, patch a recurring series with `gws calendar events patch` (only the fields you change), create with `events insert`, delete a whole series by its `recurringEventId`. The `gws` output is prefixed with a `Using keyring backend` line, so strip it before parsing JSON. See `~/Eudaimonia/Admin/Tools/gws.md` for the exact invocation syntax: `calendarId` goes inside `--params`, the event body (and any array fields) go in `--json`.

**The week spans three calendars, and every pull must read all three.** `🌱 Life` (`mattforni@gmail.com`) holds the personal week: training, recovery, community, travel, transitions, appointments. `💻 Atelic` (`matt@atelic.me`) holds the practice's week: the standing blocks, the 🙈 Deep Work and 🔨 Work Block containers, and every named ATE block placed against them (work moved off Life onto Atelic on 2026-08-20). `📝 Todoist` (`e673764afca2f4c2515eae6f102db4fe60e6cb6add06a133e912b7b9032b08c1@group.calendar.google.com`) is the sync feed where every timed Todoist task renders; a pull without it reads slotted tasks as free time, which on 2026-08-30 put a placement board on top of the HSA sale, the UI payment request, and a two hour estate block. Its events carry a foreign UTC offset (`-07:00`, some rows tagged `America/Los_Angeles`), so normalize every `dateTime` to `America/Denver` before reading it; the raw wall clock string is an hour early. The feed is for presence and time; `td` stays the write path and the truth for a task's fields. A pass that reads fewer than all three sees part of the week and will double book the rest, so fetch all three, merge, and reason about free time against the union. The re-pull rule in Learned Rules applies to every calendar.

**Writes route by what the event is, not by which calendar is nearer to hand.** Anything that exists because the practice or the work search exists goes to `💻 Atelic`: deep work containers, work blocks, named ATE blocks, client and prospect calls. Everything else goes to `🌱 Life`. The `personal` gws profile owns Life and holds writer on Atelic, so one profile writes both; no profile switching is needed mid pass.

**Fixing a misplaced event uses `events move`, not delete and recreate**, which preserves the event ID, its label, and its guest list. Two refusals to expect: Google will not move an event Forni does not organize (an invitation copy stays where it is), and it will not move a single instance or split successor out of a recurring family, so the whole family moves or none of it does.

**Event coloring goes through named labels, never `colorId`.** Every event write sets `eventLabelId` in the `--json` body, with `eventLabelVersion: 1` in `--params`. Putting `eventLabelId` in `--params` is silently dropped and the label never applies (bit on insert 2026-07-26). The label table (names, hexes, IDs) lives in `~/Eudaimonia/Admin/Tools/google-calendar.md`. The legacy `colorId` field is a backward compat synthesis that returns different values from different endpoints; never read it, never write it.

## Source of Truth

The weekly template lives at `~/Eudaimonia/schedule.md`. It defines the recurring skeleton: work hours, training sessions, transitions, recovery, and community commitments. The Google Calendar holds the live reality, including one off events and placed work blocks.

When there is a conflict between the template and the calendar, the calendar is the current truth. The template describes what a "normal" week should look like.

## Constraints

These constraints exist for real physiological and practical reasons. They are not suggestions.

**Transitions**: Every movement between locations gets a 30 minute buffer. This is not travel time alone; it includes the mental shift between contexts. Do not schedule events back to back without a transition unless they are at the same location. Transitions are placeholders: when a one off meeting claims part of a transition's time slot that week, shrink that week's instance to fit the remaining gap rather than flagging it as a conflict. This applies only to the single affected instance; the standing transition series is always 30 minutes and is never resized (see `assist:plan-training` learned rules).

**Work hours**: No W2 as of 2026-06-29 and the weekly skeleton is being rebuilt. Treat `~/Eudaimonia/schedule.md` as the source of truth for anchors and do not assume office days.

**Training adjacent constraints**: Cold plunge sequencing (4 to 6 hour gap after strength), sauna timing post strength, and Thursday SPRC morning protection live in the `assist:plan-training` skill. Defer to that skill when validating moves of training, sauna, contrast, or Thursday morning events.

**Personal anchors (not conflicts)**: Forni's last meal cutoff (currently 19:30) and lights out (currently 22:00) live in `~/Eudaimonia/schedule.md` Daily Anchors. These are personal constraints Forni manages himself — do not flag events that push past them as conflicts.

## Mode: plan (default)

The Monday planning session, 07:00 to 08:00, first thing in the deep work block. This is the primary use case. It runs isolated in a worktree and moves through seven phases: look back quietly, then gather, then clean, then place, then show. Every phase that generates work runs before the phase that places work.

**The session is the orchestration layer and the arbiter.** Agents pull and propose in the background; nothing an agent returns reaches Forni raw. The main session reads each board, decides what is genuinely his, and presents one phase at a time, in order, in one short message per phase, with everything else handled under the rules and reported in a line. Forni, 2026-08-30, after three boards landed on him at once: "I need you as the orchestration layer here... to really delegate all of this stuff to the appropriate agents and make sure those agents are using the right models... I need you to be really the arbiter of the data as it all comes back: what is important and what needs to come to me first?"

1. **Review Week** — look back, quietly, before any agents
2. **Set Intention** — theme and banner
3. **Sweep Inbox** — email becomes tasks
4. **Sweep Calendar** — make the calendar true
5. **Plan Training** — every training event placed
6. **Plan Tasks** — work slate first, then personal, then slot
7. **Present Week** — the finished board

### Agent Fan Out (After the Intention, Never Before)

Review Week and Set Intention run solo: no agents are dispatched until both dialogues close and the banner is written. Boards landing mid felt sense question kept interrupting and flooding the session on 2026-08-09, and on 2026-09-07 three completion notices plus three holding lines landed between the intention question and its answer; the quiet comes first. The moment the banner is on the calendar, dispatch the three specialists in parallel **as one foreground wait** (`run_in_background: false`), so the next thing Forni sees is the first phase board and nothing arrives mid question:

- **clerk** (`~/.claude/agents/clerk.md`): pulls the full inbox and returns the proposed disposition board consumed by Sweep Inbox.
- **groomer** (`~/.claude/agents/groomer.md`): triages the Linear queue and returns the work decision slate consumed by Plan Tasks.
- **planner** (`~/.claude/agents/planner.md`): makes the wide pulls (all three calendars with labels and offsets normalized, the Todoist Schedule filter plus the landing Monday pull) and runs the transition and overlap lint on the calendar pull. Strava and the takeout count come from the emailed retro; the planner pulls them only when Review Week fell back.

**Every specialist runs on `sonnet`**, set in its agent file; the coach is dispatched at Plan Training the same way. A `model` override on an Agent call is chosen by failure asymmetry (`~/Eudaimonia/Admin/Tools/claude-code.md`), never to skip a read. The main session's model is the expensive one, and it spends itself on arbitration, not on pulls.

**The planner assembles the unified brief.** When clerk's board and groomer's slate return, resume planner with both; it merges everything into one three tier brief (Decisions, Handled, FYI, per the Signal Contract below) that the rest of the session works from. Agent results never reach Forni as they arrive: no holding lines, no "still waiting" text; fold each result in at the phase that consumes it, and if something lands while a question is open, the turn closes with nothing new so the question stays the last text he sees.

**Dispatch briefs that authorize external writes must quote Forni's authorizing words verbatim, never a paraphrase.** The agent executing a write needs the exact words that granted it; a relayed authorization in the dispatcher's own words tripped the security layer on 2026-08-09.

### Signal Contract

Every phase presents in the same shape, leading with judgment and compressing the rest:

- **Decisions**: judgment calls only, one line each, ranked most consequential first, each carrying a proposed default so a nod is enough.
- **Handled**: the rollup of actions taken under rule cover after the phase nod, grouped with confidence bands:
  - **High**: an exact codified rule covers the action. Group by action type and cite the rule.
  - **Medium**: a rule family applied with interpretation. List each item individually for spot check.
  - **Below medium** is by definition a Decision, never an auto handled action.
- **FYI**: counted one liners (event count, task count, mileage, order count). Detail on ask.

Full boards (every thread, every task, every event) surface only on request. The brief leads with decisions, never inventories.

**How a phase reaches Forni.** One phase per message, in phase order, never two phases in one message. The board is formatted markdown in the terminal (a heading, one line per item, the default bolded) and it is the last text of its turn, closing with a bolded "Needed from you" line; his prose reply is the decision. Never pack a board into an AskUserQuestion, since the dialog collapses every bit of formatting, and never emit a dialog in the same turn as a board, since the board does not render before it; the dialog is for a short fork whose whole context fits in two plain sentences. Every item names what it is in plain words, and the thing itself is shown when the decision depends on it: an email is sender, date, what it says, and its Gmail link; an issue is its key, its title, and one line of what it is. "ATE-472" alone is not a decision he can make. Codified 2026-08-30 after three boards went through raw in one sitting.

**The contract carries hard numeric limits** on how many items ride in one message and how many decisions ride with them. They live in [learned-rules.md](learned-rules.md), they govern every phase's presentation, and they override anything here.

### Phase 1: Review Week

Look back at the week that closed yesterday, read as a **compass, not a verdict**. This phase is a quiet dialogue: the agent fan out waits until it closes, so nothing lands mid question.

**The emailed retro is the first pass.** By 05:00 the runner has pulled Strava, the Gmail takeout tally, and the HubSpot outreach week, graded them against the block doc, and mailed the result (Before Every Invocation, step 7). Forni has read it in his inbox, so the session does not restate its tables. The session's contribution is what the email cannot carry:

- **Name what stands out**, two or three sentences, lightly.
- **Ask the felt sense** as an open prose question, never an option menu (a word or two for the week), and follow the live thread. The email's headline is a grade against the block; the felt sense is the story, and it can turn the grade over (on 2026-08-30 "skipped the plan entirely" was, lived, the first weekend home after a month of racing). The numbers are numbers; his read is the read.
- **Fill the blind spots** the email names for itself (the weigh in, how the heel and body felt, whether Sunday's holds happened) in one factual ask, and carry the answers into Plan Training.
- **Settle the carry forward**, the one thing the week ahead is for; it seeds Set Intention.

**Fallback.** When the email is missing or reports that the run failed, make the two light pulls the runner would have made: Strava for the just closed ISO week (`mcp__claude_ai_Strava__list_activities` with `range_start` and `range_end`; metric in, imperial out, miles = m / 1609.344, feet = m * 3.28084) and the Gmail takeout tally (`GWS_FORCE_PROFILE=personal gws gmail`, matching the planner's pull, with `(Domino OR "Illegal Pete" OR DoorDash OR Grubhub OR "Uber Eats" OR Postmates) after:YYYY/MM/DD before:YYYY/MM/DD`; `before:` is exclusive, so it is the Monday after the week; then confirm each hit is an order). Present them tightly, then run the same dialogue.

Read it all gently. The retro course corrects, it does not grade. Surface anything that should become a planning input (a task, a guardrail, a measure to watch) and carry it into the phases below. When the dialogue closes, move to Set Intention; the fan out waits until the banner is written (see Agent Fan Out above). A deeper dialogue can invoke `assist:reflect` in `week` mode.

### Phase 2: Set Intention

The look forward, the mirror of Review Week. Holding the retro's carry forward as the lens, name **one to three focuses** for the week ahead, and convert each into a concrete planning input:

- An **anchor to protect** (a held block, a wind down ritual)
- A **block to confirm or create** on the calendar
- A **measure to watch** through the week

**Name the week's theme, and write it onto the calendar.** Set Intention produces a short theme for the week, a word or a brief phrase (for example "Presence", or "Point the Energy at the Forge"). The theme is the compass, not a task. Confirm the theme with Forni, then **create the week banner**: an all day event spanning Monday through Sunday, transparency `"free"`, carrying the 🧭 Theme label.

- **Title** is the theme, led by an emoji chosen to match it (for example `🪷 Presence`). The theme owns the title; nothing else sits there.
- **Body** is a one sentence theme framing and nothing else. The training block used to be appended here by `assist:plan-training`; retired 2026-09-07 (Forni: "I don't look in the banner for the training block"). Training lives on the calendar as its events.

This skill owns the banner; nothing else writes to it.

### Phase 3: Sweep Inbox

Turn the inbox into tasks before the task list is loaded, so email follow ups ride the same prioritization and slotting pass as everything else instead of living only in Gmail.

**Clerk was dispatched at the close of Set Intention** (see Agent Fan Out); by this phase its board has landed inside the planner's brief. Clerk pulls EVERY thread in the inbox (not just unread and starred; read but never archived mail is most of the pile), applies the triage rules, and returns one fully specified proposed disposition per thread, marked ✓ (rule backed) or ? (judgment), with account safe Gmail links. Present per the Signal Contract: ? items and anything outbound are Decisions with proposed defaults; ✓ dispositions execute after the phase nod and report in the rollup grouped by disposition with the rule cited. The full board surfaces only on request. Clerk proposes, Forni corrects, and the corrected board is executed (clerk executes its own board on resume; see the agent file). Fall back to the manual parse below only after clerk has failed or returned nothing, never in parallel with it. Adopted 2026-08-02; widened to the full inbox with proposal dispositions the same day; folded into the post retro fan out 2026-08-09.

1. Pull every thread in the inbox via `gws` (Bash), not just unread and starred; read but never archived mail is most of the pile. Yellow and red stars mean the next move is ours (see the star semantics in the assist plugin reference/email-rules.md).
2. Classify each email by the action it implies:
   - **Follow up, not a reply** (schedule something, pay something, chase a vendor, gather documents): create a task in its landing system per GC conventions (Todoist for personal and operational, Linear for development and work search). Emoji prefix, short title linked to the Gmail thread, due today (the planning Monday) so it lands in this pass, priority by judgment, details in a comment per Todoist conventions.
   - **Needs an actual reply**: leave it in the inbox for a proper `assist:triage-inbox` session. Note that it exists; do not draft or send replies during this phase.
   - **No action**: skip it.
3. Confirm task creations with Forni before writing, presented per the Signal Contract, consistent with the ask before acting posture.
4. When nothing actionable surfaces, say so in one line and continue.

### Phase 4: Sweep Calendar

Make the calendar true. Fetch this week's events (Monday through Sunday) via `gws` on all three calendars (Life, Atelic, and the Todoist feed; see the calendars paragraph above), with `eventLabelVersion: 1` so labels come back, and read the weekly template for the recurring skeleton. The planner's calendar pull and lint results seed this phase; verify against them rather than re deriving.

**Free vs busy events**: Check the `transparency` field on each event. Events with `transparency: "transparent"` are "free" (informational only, no action required). Filter them out of the working set. Do not treat free events as conflicts or as consuming time slots. Only `opaque` (busy) events block time.

**Rectify against the template and the frame**: Compare the live calendar against the template and against itself, and also reconcile the template against the current V2MOM frame, since a frame rebuild leaves the skeleton stale. Identify:

- Overlapping busy events (two events claiming the same time)
- One off events that displace recurring template activities (e.g., a party during sauna time)
- Constraint violations (missing transitions, fasting window breaches, training adjacent issues per `assist:plan-training`)
- Stale skeleton: recurring blocks the frame has retired (a closed venue, a dropped commitment) still sitting on the template or calendar

**Standing transition lint**: walk the week's location changes and confirm every one has its 30 minute flank per the transition conventions. A location shift without its flank is a lint finding to surface, never a silent fix. And **re pull the week after any batch of writes, before anything new is slotted**: proposing slots off a stale pull lands them on top of fresh reality (Reclaim backfill first bit 2026-07-26; reaffirmed 2026-08-09 when slots were proposed off a stale pull).

**Label the unlabeled**: any event in the week without an `eventLabelId`, or sitting on a label that no longer fits its meaning, gets its label proposed per the table in `~/Eudaimonia/Admin/Tools/google-calendar.md`. Present in small batches, confirm, patch.

Present all conflicts per the Signal Contract. For each conflict, propose a resolution:

- **Keep one, cut the other** (delete or decline)
- **Move one** to an open slot (check constraints before suggesting)
- **Accept the displacement** (skip the recurring activity this week, or reschedule it to another day)

**Never modify existing events without explicit permission.** Always present the conflict and proposed resolution, then wait for approval before taking any action. This is especially critical for events with other attendees or events booked via Reclaim.ai scheduling links (those were scheduled by other people). Be aware that deleting or moving adjacent events can cause Reclaim to auto reschedule nearby flexible events as a side effect.

Execute only the agreed changes before moving on. The calendar should be clean and conflict free before anything new is placed on it.

### Phase 5: Plan Training

Invoke the `assist:plan-training` skill in `week` mode via the Skill tool. Its retro gate is satisfied by the emailed retro plus the blind spots Review Week collected; the coach agent (`~/.claude/agents/coach.md`, dispatched on `sonnet`) reads the week's shape from the block doc and the calendar pull. The skill detects existing recurring placeholders (Mon/Wed/Fri lifts, Tue Fun Run, Tue DRC, Thu SPRC, the four yoga holds), surfaces what's missing, lays out the week's shape and strength targets, and **places every training event for the week**, including the alternating one offs (4K Friday plus paired drive blocks on 4K weeks), following its own constraint logic. The week leaves this phase with training fully on the calendar, not just shaped. Return here once training scheduling is complete.

### Phase 6: Plan Tasks

Prioritize the full task slate, work first, then place the survivors.

**The work slate leads.** The groomer's decision slate (dispatched at the close of Set Intention, carried in the planner's brief) is the first pass: walk its Decisions, settle the cycle, and carry the placeable issues into slotting. When groomer failed or returned nothing, pull the active cycle inline (`env -u LINEAR_API_KEY linear --workspace atelic issue query --team ATE --cycle active --json`) as the fallback.

**The cycle is the week, and triage has a definition.** The active cycle should hold exactly the work intended for the week being planned; anything unfittable or unowned goes back to Backlog before slotting starts. An issue counts as triaged only when it carries every field named in **`~/Eudaimonia/Admin/Tools/linear.md` (Scheduling, What Counts as Triaged), which is canonical and is not restated here**. Missing any one of them makes it a Decision, not a placeable item, whatever its state says. The drifts to watch live in `sdlc:groom-issues`.

**Work maps INTO the standing deep work and work block calendar series**, not into freshly minted Craft block events (the skeleton series exist as of 2026-08-09). Those series live on `💻 Atelic` (`matt@atelic.me`) as of 2026-08-20, so pull them from there, and place named blocks there too. Assign each issue in the cycle to specific standing blocks sized by its estimate (points are hours). The cycle is the only schedule Linear carries, so the calendar block is what fixes the day and hour. Only when the week's work genuinely exceeds the standing series does a one off 🛠️ Craft block get proposed, through the same decision gate as everything else. Title and splitting conventions live in `~/Eudaimonia/Admin/Tools/google-calendar.md` (Work Holds). Linear issues carry the same 🧠 Sharp / ⚖️ Medium / 🍃 Light cognitive load labels as Todoist tasks, so the estimate sizes the block and the label picks the time of day, exactly as it does on the personal side. The Reclaim Linear sync retired 2026-08-03. Capacity overrides are Forni's to make: when he keeps an overcommitted slate, surface the arithmetic (estimate hours against standing block hours) rather than relitigating the cut (2026-08-09).

**One contiguous block per task, two at the very most.** Contiguity is optimized for ahead of a tidy fit, because a task scattered into three or more slivers across three days is impossible to hold in your head even when the hours add up. When a task will not fit any single container, first hunt for a bigger contiguous window elsewhere in the week: extending a weekend block by 30 minutes is cheaper than splitting the work. Only when no window can be made big enough does the task go into two blocks, and never into three (surfaced 2026-08-10; see Learned Rules).

**Generic containers are placeholders with no standing.** The recurring 🙈 Deep Work and 🔨 Work Block events (titled 🔨 Deep Work before 2026-08-13) live on `💻 Atelic` and exist to reserve capacity for this scheduling pass and nothing else. When named work claims a container's time, delete the container rather than keeping it alongside the work. A week that has been through Plan Tasks carries zero generic Deep Work or Work Block containers on the Atelic calendar. Forni, 2026-08-10: "We also don't need to hold onto Deep Work blocks. Those are placeholders for the scheduling work."

**Then Todoist.** Fetch tasks using the **Schedule filter** via the `td` CLI. There is no saved filter lookup, so pass its raw query directly: `td task list --filter '(!(@⏰ Scheduled | @⏲️ Recurring) | overdue | (@⏰ Scheduled & no time)) & due before: next monday' --json`. That query pulls overdue tasks, non recurring non scheduled tasks due before next Monday, plus Scheduled labeled tasks that never got a time (the label is only honest when a time is attached; see Learned Rules).

**Prioritize.** Prune hard: the filter routinely surfaces far too many items, so default to aggressively deleting notes, deferring the non critical, and combining duplicates rather than slotting everything. This is a collaborative pass through all tasks to:

1. **Identify notes vs tasks**: Forni uses Todoist as a quick notepad. Items that are bookmarks, quotes, links, or ideas get moved to their proper home (Notion, Eudaimonia koans, etc.) and **deleted** from Todoist (not completed, since they were never real tasks). Use Notion MCP for pages like AI Research, and write files to Eudaimonia for things like koans.
2. **Combine related tasks**: When multiple tasks are clearly part of the same effort (e.g., "Rebalance Portfolio" and "Update 1% Donation" both being financial), suggest merging them into a single task with details in a comment. Merge only on Forni's explicit yes to that specific fold; a board reply that addresses the umbrella and not the fold is not a yes (2026-08-30: four house tasks were folded and deleted on such a reply and had to be recreated).
3. **Reprioritize**: Review priorities and flag anything that looks off. Use best judgment, then confirm with the user.
4. **Clear p4**: All p4 tasks either get bumped to a real priority or punted to the next planning Monday. p4 items do not get slotted into the current week.

**Slot.** Re pull all three calendars first (a timed Todoist task is as solid as a meeting), then present the remaining tasks that need scheduling per the Signal Contract. For each task, suggest a time slot based on:

- The task's priority and due date
- Available open slots in the calendar
- **Cognitive load, which decides the time of day**: 🧠 Sharp lands first thing in a protected morning, ⚖️ Medium midday, 🍃 Light late afternoon on low fuel. The estimate decides how long the block is; the label decides when it sits (see Slotting Rules in the plugin learned-rules.md)
- Location: if a task requires being somewhere specific, match it to the right day

Present the proposed slots as a board with corrections invited (the board pattern supersedes the one at a time walk; see Learned Rules). Forni can, per task:

- **Accept** the proposed slot
- **Move** to a different slot
- **Defer** to next week (reschedule in Todoist to the next planning Monday)
- **Skip** for now

**Todoist tasks are scheduled via Todoist, not by creating Google Calendar events.** To slot a Todoist task (all through the `td` CLI; see Todoist Integration below):

1. Set the date and time with `td task reschedule <ref> "2026-03-31T07:00:00"`. Reschedule preserves recurrence, and a date only value drops an existing time, so pass the full date and time form
2. Set the labels with `td task update <ref> --labels`. The flag replaces the entire label set, so pass everything the task keeps in one list: the `⏰ Scheduled` label, exactly one cognitive load label (🧠 Sharp / ⚖️ Medium / 🍃 Light), and any labels already on the task. Move the task out of Inbox into its pillar project with `td task move <ref> --project "<name>"` (see Slotting Rules in the plugin learned-rules.md)
3. The `⏰ Scheduled` label removes the task from the Schedule filter so it does not resurface during prioritization. The duration cannot be set from here: `td` accepts `--duration` on add and update and silently drops it, so the task's length gets set in the Todoist app, and every slotted task goes on the Present Week hand list with its intended length
4. Todoist's calendar integration automatically shows scheduled tasks on Google Calendar

Google Calendar is still used directly for non task events: meetings, transitions, sauna sessions, social events, etc.

**Recurring catch up/call tasks**: When a recurring task (e.g., "📱 Ryan Bruno", every 2 months) gets slotted:

1. Create a new one off Todoist task with the specific date/time, duration, the `⏰ Scheduled` label, exactly one cognitive load label (🧠 Sharp / ⚖️ Medium / 🍃 Light), and its pillar project
2. Complete the recurring task so the next occurrence auto generates on its cycle
3. The one off task is the reminder for this week; the recurrence handles the next one

A recurring catch up that gets deferred instead of slotted lands on the next planning Monday, like every other deferral.

**Email outreach as slotting**: For some recurring catch ups, the right action is not scheduling a time block but sending an email with a scheduling link. Use `GWS_FORCE_PROFILE=personal gws gmail +send` (via Bash) to send outreach. Check previous email threads for tone and format. The gws-gmail-send skill has full usage docs. Always confirm with the user before executing the send command.

**Deferred tasks land on the next planning Monday**: When deferring tasks to next week or further out, schedule them, date only, for the Monday that opens the target week, the morning this session runs. Monday is the landing zone where tasks get triaged during the planning session. (Replaced the Sunday landing zone 2026-08-30 when the session moved; Sunday had replaced Monday on 2026-08-09. The landing zone follows the session.)

### Phase 7: Present Week

The finished board is the Google Calendar week view. Present a link to it (`https://calendar.google.com/calendar/u/0/r/week/YYYY/M/D`). Todoist sync already renders slotted tasks there alongside training, meetings, and events, so do not rebuild the week as prose day lists or summary tables (see the Learned Rules entry).

Supplement the link only with what the calendar cannot show:

- The deferred ledger: any tasks that could not be slotted (no available time)
- Remaining open slots for spontaneous work
- The week's theme
- The short list for his hands: Todoist durations (`td` drops `--duration` silently, on add and update alike, so they get set in the app) and anything the session could not do

Close the session by stopping the timer, per Session Timers in `~/Eudaimonia/Admin/Tools/toggl.md`.

## Mode: week

Quick view of the current or upcoming week. No task slotting, just a clean overview.

1. Fetch calendar events for the requested week
2. Present day by day with times, event names, and locations
3. Highlight open slots
4. Flag any conflicts or constraint violations

## Mode: slot

Slot a specific task or event into the week.

1. User describes what they need to fit in (e.g., "I need 2 hours for Atelic work this week")
2. Fetch the week's calendar
3. Identify available slots that fit the duration
4. Present options via AskUserQuestion
5. Slot into the chosen time:
   - **If it is a Todoist task**: use `td task reschedule` to set the date and time, then `td task update` to set the full `--labels` set (the `⏰ Scheduled` label, exactly one cognitive load label 🧠 Sharp / ⚖️ Medium / 🍃 Light, plus whatever the task already carries, since the flag replaces the whole set), and `td task move` to land it in its pillar project. The duration is set in the app (`td` drops `--duration`), so name the intended length for his hands. Do **not** create a Google Calendar event; Todoist's calendar integration handles visibility automatically.
   - **If it is a non task event** (meeting, transition, sauna session, social event, etc.): propose the event details, confirm with the user, then create a Google Calendar event following the Calendar Event Conventions above.

## Mode: move

Move or swap an existing event.

1. User describes what to move (e.g., "Move my Wednesday sauna to Thursday")
2. Fetch the relevant events
3. Check constraints (transitions, conflicts). Defer to `assist:plan-training` move mode when any of these apply:
   - the target event is training (🍏 Constitution label, training emoji, or session type like sauna / contrast / lift / run / climb)
   - the proposed destination lands in Thursday morning (SPRC window is protected regardless of what is being moved)
   - the move could affect training adjacent sequencing (e.g., a sauna or contrast block landing on a strength day, an event displacing a recurring training session)

   Include cold plunge sequencing and Thursday SPRC protection in that validation pass.
4. Present the proposed change with any downstream impacts
5. Execute after confirmation

When moving recurring events for just one week, modify only that occurrence, not the entire series. When the user wants a permanent change, update the series and flag that schedule.md may need updating.

## Calendar Event Conventions

The named label table (names, hexes, label IDs) and the transition / travel / title conventions live in `~/Eudaimonia/Admin/Tools/google-calendar.md`; the behavioral rule lives in GC `Calendar Preferences`. The conventions below are skill specific additions.

- **Emoji prefix**: All personal events use an emoji prefix (e.g., "🏋️ Strength", "✍️ Writing")
- **Labels, not colors**: every created event carries the `eventLabelId` matching its meaning (🍏 Constitution, 🧠 Contemplation, 🤗 Community, 🛠️ Craft, and the rest of the table)
- **Deep work**: 🙈 Deep Work blocks live on `💻 Atelic` and carry the 🛠️ Craft label (the Heads Down label retired 2026-07-19; deep work is Craft, not its own category). Protected focus, no transitions needed (block stays at current location). The generic block is a capacity placeholder, deleted once named work claims its time (see Phase 6).
- **Week banner**: the all day event spanning Monday through Sunday that carries the week's theme, created by Set Intention with the 🧭 Theme label, transparency `"free"`. Title is emoji + theme only; the body is the one sentence framing. No training block (retired 2026-09-07).

Include the location when the event is at a specific place.

## Training Plan Scheduling

Training event creation lives in the `assist:plan-training` skill. See that skill for the recurring placeholder table, the 4K Friday alternation, strength programming, special weeks (template refresh, September seam, travel), and training adjacent constraints. Plan Training (Phase 5) invokes it during weekly planning. The week banner belongs to this skill alone, created during Set Intention; plan-training never writes to it.

## Key Locations

| Name | Address |
|------|---------|
| Movement RiNo | 3201 Walnut St #107, Denver, CO 80205 |
| Improper City | 3201 Walnut St #107, Denver, CO 80205 |
| Ratio Beerworks | 2920 Larimer St, Denver, CO 80205 |
| Hearth | 2500 Lawrence St, Denver, CO 80205 |
| Project Angel Heart | 4950 Washington St Suite 200, Denver, CO 80216 |
| STEP Denver | 2029 Larimer St, Denver, CO 80205 |
| High Noon (1311 York) | 1311 York St, Denver, CO 80206 |

## Todoist Integration

All Todoist access goes through the `td` CLI via Bash; the MCP connector retired 2026-08-13. The owning doc is `~/Eudaimonia/Admin/Tools/todoist.md` (install, auth, everyday shape, the full gotcha list); this section carries only the operations planning leans on, verified against `td --help` on 2026-08-15:

- `td task list --filter '<query>' --json`: pull tasks with a raw Todoist filter query. There is no saved filter lookup, so pass the Schedule filter's raw query directly (see Phase 6). A date range pull uses `--due` (today, overdue, or YYYY-MM-DD).
- `td task reschedule <ref> "<date>"`: move a task's due date. Always use this instead of `td task update --due` for date changes: reschedule preserves recurrence, while `update --due` replaces the whole due string. A date only value drops an existing time of day, so pass the full form (`2026-08-18T09:00:00`) when a time matters.
- `td task update <ref>`: set task properties (but NOT dates). `--labels` is plural and replaces the entire label set, so always pass every label the task keeps, not just the addition. `--priority` takes `p1` through `p4`. `--duration` is accepted and silently dropped, on `add` and `update` alike (confirmed 2026-08-30 on four freshly slotted tasks); durations are set in the Todoist app.
- `td task move <ref> --project "<name>"`: move a task out of Inbox into its pillar project.
- `td task complete <ref>`: complete recurring tasks to fire the next occurrence (never `--forever`, which kills the recurrence).
- `td task delete <ref> --yes`: delete notes/bookmarks that were never real tasks. Never complete these. The `--yes` flag is required or nothing is deleted.
- `td task add "<title>" --project "<name>" --due "<date and time>" --priority p2 --labels "<a,b>"`: create one off tasks (e.g., a scheduled call from a recurring catch up); pass a full date and time value when the task carries a slot, not a date only value; the duration goes on in the app afterwards.
- `td comment add <ref> --content "<text>"`: add detail to tasks when combining or enriching them.

When slotting tasks, respect Todoist priorities:

- p1 (highest): Slot these first, in prime time
- p2: Important but flexible
- p3: Can go in smaller gaps
- p4 (default): Lowest priority, do not slot into the current week

## Gmail Integration

Use the `gws` CLI tool (via Bash, always with `GWS_FORCE_PROFILE=personal` so the call cannot inherit another profile) for Gmail operations during planning. Common use case: sending scheduling link emails for recurring catch ups. Reference the gws-gmail-send skill for full usage. Always check previous email threads for tone and context before drafting. Confirm with the user before executing send commands.

## Learned Rules

See [learned-rules.md](learned-rules.md).
