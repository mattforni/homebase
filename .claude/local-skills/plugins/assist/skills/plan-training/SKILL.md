---
name: plan-training
description: Training scheduling from the weekly skeleton in `schedule.md`, the weekly training look back, and training adjacent constraint validation. Use when Forni mentions lifts, runs, or recovery days, or says "schedule my training" or "training retro".
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

Help Forni schedule the week's training from `schedule.md`, look back on the week just closed, and move sessions safely with constraint validation. The skill is independently invocable, and also gets called by `/assist:plan-week` during Monday planning before triage and slotting.

## Before Every Invocation

1. Read [learned-rules.md](learned-rules.md) in this directory
2. Read the canonical training context:
   - `~/Eudaimonia/Constitution/Fitness/CLAUDE.md` — training conventions
   - `~/Eudaimonia/schedule.md` — weekly skeleton (held loosely by design)
3. Determine the target week. Default to the current ISO week. Use `date +"%G-W%V"` for the week identifier.

## Source of Truth

The weekly skeleton lives at `schedule.md` and is a default, not a law. Google Calendar holds the live scheduled reality.

**For scheduling decisions** (what's on the calendar this week, what conflicts with what): the calendar is truth.

**For retrospective decisions** (what actually happened last week): Strava is truth for all movement, lifts and yoga included. Calendar events are scheduled intent, never evidence of completion.

**Strength programming is Fitbod's, not this skill's.** Exercise selection, weights, and reps live in Fitbod and are not planned here.

## Training Constraints

These constraints exist for real physiological and practical reasons. They are not suggestions.

**Heel guardrail**: conversational pace is the default for every run. Hard efforts are rationed to at most one per week and skipped entirely the week after any flare. Any heel, calf, or foot signal drops the next hard or trail effort, no pushing through.

**Cold plunge timing**: no cold water immersion within 4 to 6 hours after strength training. Sauna (heat only) is fine after strength. (Dormant while sauna is homeless; keep for its return.)

**Thursday mornings**: no prayer, meditation, or journaling on Thursdays. That time is reserved for getting to SPRC at 06:00, which rotates locations.

**Fasting window adjacency**: last meal 19:30, first meal 07:30.

## Calendar Event Conventions

The named label table and title formats live in `~/Eudaimonia/Admin/Tools/google-calendar.md`; calendar reads and writes go through the `gws` CLI (`~/Eudaimonia/Admin/Tools/gws.md`) with `eventLabelVersion: 1` on every write. Events are colored via named labels (`eventLabelId`), never the legacy `colorId`. Training specific use:

- Training events use the 🍏 Constitution label: runs, lifts, yoga, body care
- Every change of location needs flanking transition or travel events

## Mode: week (default)

The Monday morning training pass. Runs as part of `/assist:plan-week` plan mode (Phase 6), or standalone.

### Phase 1: Retrospective on the Previous Week

The emailed retro (the runner's `YYYY-Www Brief`, consumed by `assist:plan-week` Review Week) is the coverage read: bare counts of lifts, social runs, and yoga, plus the takeout count. Add only what it cannot see, how the heel and body felt, collected in Review Week's blind spot ask. Retro precedes scheduling, always; drift compounds otherwise. Mode: retro below is the standalone form for a direct ask; do not rerun it here.

### Phase 2: Detect Existing Placeholders

Fetch the week's calendar events (Monday through Sunday). Do not overwrite or duplicate; only create what is missing for this specific week.

| Cadence | Items | Action |
|---------|-------|--------|
| Recurring (assumed on calendar) | Mon/Wed/Fri lift 15:30, Tue DRC 18:00, Thu SPRC 06:00 (Tue Diego retired 2026-11-09), Tue Align and Flow 16:30, Thu Alignment 16:30, Sun Hatha 09:30, Sun Yin 16:15 | Skip if present; surface if missing (may be intentional) |
| Opportunistic / optional | A fourth lift, extra mobility, an added social run | Surface as options, never auto create |

### Phase 3: Week Shape

Lay out the week as one small table: day, session, purpose. Place yoga against the actual Movement schedule for the week (the skeleton is a default; studio schedules change). Verify the studio still holds the assumed slots when in doubt.

**The one look weekly summary is the deliverable**: sessions by modality as plain counts. Present it in the terminal; it is not written anywhere. (The week banner used to carry it; retired 2026-09-07 since Forni never read it there. The banner belongs to `assist:plan-week` and this skill never writes to it.)

### Phase 4: Special Week Handling

- **Last Thursday of the month**: the 16:00 Liz session replaces Alignment Yoga. Clear the yoga instance and both of its transition flanks; do not schedule around a collision that should not exist.
- **Travel weeks**: skeleton sessions become opportunistic.

## Mode: move

Move or swap a training event with constraint validation.

1. User describes what to move
2. Fetch the relevant events
3. Validate against training constraints: heel guardrail (no stacking hard efforts), Thu SPRC protection, cold plunge sequencing when sauna returns, transition flanks on any location change
4. Present the proposed change with downstream impacts
5. Execute after confirmation

When moving recurring events for one week, modify only that occurrence. Permanent changes update the series and flag that `schedule.md` may need updating. **Never modify existing events without explicit permission.**

## Mode: retro

Look back on a completed week: what was done, how the heel and body felt, and what carries into scheduling. Present it in the terminal; nothing is written to a file.

### Phase 1: Determine the Target Week

Default: the most recently completed ISO week. Natural cadence is Monday morning.

### Phase 2: Gather Data

Pull the week's activities from Strava via `mcp__claude_ai_Strava__list_activities` with `range_start`/`range_end`. Filter by `sport_type`. Strava is the sole source of record for all movement; never ask the user to confirm sessions, never infer from calendar.

### Phase 3: What Was Done

| Modality | Count |
|---|---|
| Lifts | sessions |
| Runs | sessions + total miles |
| Yoga | sessions |

### Phase 4: Load Check

Run every retro:

1. **Hard effort count.** More than one hard run effort in the week is a flag (heel guardrail). Any hard effort the week after a flare is a flag.
2. **Clustering.** Two big days (over 8 mi or over 1,000 ft) within 48 hours is a flag; the pattern to catch is a big Saturday day on a cold trail base, since no trail running is left on the calendar after 4K Friday retired (2026-09-14).
3. **Heel signal.** Any reported heel, calf, or foot signal drops the next week's hard and trail efforts.
4. **Recovery read.** Only when runs look hot: check easy day HR vs the Z2 ceiling via `get_activity_performance`.

### Phase 5: Heel and Body

Ask how the heel and body felt, in one factual question.

### Phase 6: Carry Forward

A load check flag or a heel signal tightens the next week's run shape. Name what carries into scheduling, then hand it to week mode.

## Key Locations

| Name | Address |
|------|---------|
| Movement RiNo | 3201 Walnut St #107, Denver, CO 80205 |

## Learned Rules

See [learned-rules.md](learned-rules.md) for live, mutable training rules. Stable conventions live in this file; corrections and current life shape rules go there.
