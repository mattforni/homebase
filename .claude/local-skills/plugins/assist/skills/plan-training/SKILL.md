---
name: plan-training
description: Training plan scheduling, weekly retrospectives, and training adjacent constraint validation. Use this skill whenever the user mentions training, lifts, runs, swims, the 4K Friday, yoga placement, recovery days, the recomp block, asking to schedule a training session, or asking to look back / retrospect on a past training week. Also trigger for "/assist:plan-training", "schedule my training", "what does training look like this week", "how did last week go", "training retro", "this week's lifts", or any request that touches the block plan in `Constitution/Fitness/`. Independently usable, and also called by `/assist:plan-week` during Monday planning.
argument-hint: "[week | move | retro]"
allowed-tools:
  - Bash
  - mcp__claude_ai_Strava__*
  - WebSearch
  - WebFetch
  - Read
  - Edit
  - Write
  - AskUserQuestion
---

# Plan Training Assist

Help Forni schedule the week's training from the active block plan, run the weekly retro, and move sessions safely with constraint validation. The skill is independently invocable, and also gets called by `/assist:plan-week` during Monday planning before triage and slotting.

## Before Every Invocation

1. Read [learned-rules.md](learned-rules.md) in this directory
2. Read the canonical training context:
   - `~/Eudaimonia/Constitution/Fitness/2026-recomp-block.md` — active block (target, weekly shape, strength emphasis, guardrails, checkpoints, weigh-in log)
   - `~/Eudaimonia/Constitution/Fitness/CLAUDE.md` — training conventions
   - `~/Eudaimonia/schedule.md` — weekly skeleton (held loosely by design)
3. Determine the target week. Default to the current ISO week. Use `date +"%G-W%V"` for the week identifier.

The FPL block (`2026-training-plan.md`) is closed and read only for history.

## Source of Truth

The block plan lives at `Constitution/Fitness/2026-recomp-block.md`. The weekly skeleton lives at `schedule.md` and is a default, not a law. Google Calendar holds the live scheduled reality.

**For scheduling decisions** (what's on the calendar this week, what conflicts with what): the calendar is truth.

**For retrospective decisions** (what actually happened last week): Strava is truth for all movement, lifts and yoga included. Calendar events are scheduled intent, never evidence of completion.

**Strength programming is Fitbod's, not this skill's.** The block doc holds the emphasis and the session count; exercise selection, weights, and reps live in Fitbod and are not planned, targeted, or graded here.

## Training Constraints

These constraints exist for real physiological and practical reasons. They are not suggestions.

**Heel guardrail**: conversational pace is the default for every run. Hard efforts are rationed to at most one per week and skipped entirely the week after any flare. Any heel, calf, or foot signal drops the next hard or trail effort, no pushing through.

**Cold plunge timing**: no cold water immersion within 4 to 6 hours after strength training. Sauna (heat only) is fine after strength. (Dormant while sauna is homeless; keep for its return.)

**Thursday mornings**: no prayer, meditation, or journaling on Thursdays. That time is reserved for getting to SPRC at 06:00, which rotates locations.

**Fasting window adjacency**: last meal 19:30, first meal 07:30. The 18:30 close is the named first lever if the weight trend stalls two consecutive weeks; propose it, never impose it.

## Calendar Event Conventions

The named label table and title formats live in `~/Eudaimonia/Admin/Tools/google-calendar.md`; calendar reads and writes go through the `gws` CLI (`~/Eudaimonia/Admin/Tools/gws.md`) with `eventLabelVersion: 1` on every write. Events are colored via named labels (`eventLabelId`), never the legacy `colorId`. Training specific use:

- Training events use the 🍏 Constitution label: runs, lifts, yoga, body care
- 4K Friday: `🏃 4K Friday` with paired `🚙 <Trailhead>` and `🚙 Home` drive flanks (🚙 Travel label), 30 minute increments aligned to 30 minute blocks
- Every change of location needs flanking transition or travel events

## Mode: week (default)

The Monday morning training pass. Runs as part of `/assist:plan-week` plan mode (Phase 5), or standalone.

### Phase 1: Retrospective on the Previous Week

The emailed retro (the runner's `YYYY-Www Retro`, consumed by `assist:plan-week` Review Week) is the coverage read: lifts, social runs, the 4K, and yoga against the block doc, plus the takeout count. Add only what it cannot see, the Sunday weigh in and how the heel and body felt, collected in Review Week's blind spot ask. Retro precedes scheduling, always; drift compounds otherwise. Mode: retro below is the standalone form for a direct ask; do not rerun it here.

### Phase 2: Detect Existing Placeholders

Fetch the week's calendar events (Monday through Sunday). Do not overwrite or duplicate; only create what is missing for this specific week.

| Cadence | Items | Action |
|---------|-------|--------|
| Recurring (assumed on calendar) | Mon/Wed/Fri lift 15:30, Tue Fun Run 08:00, Tue DRC 18:00, Thu SPRC 06:00, Tue Align and Flow 16:30, Thu Alignment 16:30, Sun Weigh In 05:45, Sun Hatha 09:30, Sun Yin 16:15 | Skip if present; surface if missing (may be intentional) |
| Alternating (check which week) | 4K Friday (every other week) + drive flanks | Create on 4K weeks |
| Opportunistic / optional | A fourth lift, extra mobility, an added social run | Surface as options, never auto create |

### Phase 3: Week Shape

Determine which Friday this is (4K or deep work) from the alternation, then lay out the week as one small table: day, session, purpose. Place yoga against the actual Movement schedule for the week (the skeleton is a default; studio schedules change). Verify the studio still holds the assumed slots when in doubt.

**The one look weekly summary is the deliverable**: sessions by modality against the block doc's What This Block Asks For paragraph (`Constitution/Fitness/2026-recomp-block.md`, the one statement of the targets; never restate the numbers here), which Friday it is, and the weight trend in one line. Present it in the terminal; it is not written anywhere. (The week banner used to carry it; retired 2026-09-07 since Forni never read it there. The banner belongs to `assist:plan-week` and this skill never writes to it.)

### Phase 4: Special Week Handling

- **Last Thursday of the month**: the 16:00 Liz session replaces Alignment Yoga. Clear the yoga instance and both of its transition flanks; do not schedule around a collision that should not exist.
- **Travel weeks**: skeleton sessions become opportunistic, not graded.
- **Block close (W45, week of Nov 8)**: composition read plus the winter shape conversation.

## Mode: move

Move or swap a training event with constraint validation.

1. User describes what to move
2. Fetch the relevant events
3. Validate against training constraints: heel guardrail (no stacking hard efforts), Thu SPRC protection, cold plunge sequencing when sauna returns, transition flanks on any location change
4. Present the proposed change with downstream impacts
5. Execute after confirmation

When moving recurring events for one week, modify only that occurrence. Permanent changes update the series and flag that `schedule.md` and the block doc may need updating. **Never modify existing events without explicit permission.**

## Mode: retro

Look back on a completed week. Compare planned vs actual coverage and the weight trend. Append the result as a new `### Wk N` subsection under a **Weekly Retrospectives** section of `2026-recomp-block.md` (create the section on first use, immediately before References), chronological order, `####` inner headings.

### Phase 1: Determine the Target Week

Default: the most recently completed ISO week. Natural cadence is Monday morning, after Sunday's weigh-in. Heading format: `### Wk N: ISO YYYY-WNN (Mon Date to Sun Date)`, numbering from the block start (2026-W33 = Wk 1).

### Phase 2: Gather Data

1. **Block doc**: the weekly shape and any week specific notes (which Friday, checkpoints).
2. **Strava**: pull the week's activities via `mcp__claude_ai_Strava__list_activities` with `range_start`/`range_end`. Filter by `sport_type`. Strava is the sole source of record for all movement; never ask the user to confirm sessions, never infer from calendar.

### Phase 3: Build the Coverage Table

One row per planned session: Mon lift, Tue Fun Run, Tue DRC, Tue Align and Flow, Wed lift, Thu SPRC, Thu Alignment, Fri (4K or deep work) + Fri lift, Sun Hatha, Sun Yin. Mark `✅` (hit), `❌` (missed), `↪️` (shifted), `n/a` (not applicable). Sessions skipped while travelling are `n/a`, never misses, and Alignment Yoga is `n/a` on the last Thursday of the month, when Liz replaces it. A session that moved days but happened is a hit; the skeleton is a default.

### Phase 4: The Numbers

| Metric | Source |
|---|---|
| Lifts | count vs 3 |
| Runs | sessions + total miles (informational, no target) |
| Yoga | count vs 4 standing holds |
| Weight | Sunday weigh-in, trend vs the 0.5 to 0.7 lb/wk arc |

Run mileage carries no target and no ceiling; it is context, not a grade. Mileage and vert ceilings retired with the FPL block.

### Phase 5: Load Check

Reshaped for the recomp block; run every retro:

1. **Hard effort count.** More than one hard run effort in the week is a flag (heel guardrail). Any hard effort the week after a flare is a flag.
2. **Clustering.** Two big days (over 8 mi or over 1,000 ft) within 48 hours is a flag; the pattern to catch is a Saturday adventure stacked on a 4K Friday.
3. **Heel signal.** Any reported heel, calf, or foot signal drops the next week's hard and trail efforts.
4. **Recovery read.** Only when runs look hot: check easy day HR vs the Z2 ceiling via `get_activity_performance`.

### Phase 6: Interrogate Significant Deltas

When coverage shows meaningful misses (a modality at zero, two consecutive weeks of the same miss, weight trend off arc), interrogate cause before writing: injury or body, schedule or life, motivation or state, conditions. One focused question, then room for detail. Medical causes prompt for provider notes worth capturing.

### Phase 7: Write the Retro Subsection

Skeleton: Coverage, Numbers, Load Check, The Read (2 to 4 short paragraphs, direct, no effusive praise), Carry Forward, Open Items. Present the draft and confirm via one `AskUserQuestion` before saving.

### Phase 8: Adjustment Check

Coverage misses drive schedule repair (move the slot, shrink the commitment), not target step downs; there is no volume ladder in this block. A weight trend stall of two consecutive weeks triggers the nutrition lever proposal (18:30 close). A load check flag tightens the next week's run shape. Skip only when the week landed clean.

### Phase 9: Surface Trends

Scan the prior 1 to 2 retros for patterns: repeated misses, weight trend drift, a modality quietly fading. One or two sentences, only when the data is there.

## Retired with the FPL Block

The long-run mode (Friday mountain long run workflow, route selection, vert budgets, mileage ceilings) retired 2026-08-05 with the FPL block. Route taste and the vetted shortlist are archived in git history and `reference/`; a future mountain objective reopens them as adventure planning, not weekly training.

## Key Locations

| Name | Address |
|------|---------|
| Movement RiNo | 3201 Walnut St #107, Denver, CO 80205 |

## Learned Rules

See [learned-rules.md](learned-rules.md) for live, mutable training rules. Stable conventions live in this file; corrections and current life shape rules go there.
