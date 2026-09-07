# Learned Rules

Training specific rules tied to current life shape. Read on every invocation. Stable training conventions live in [SKILL.md](SKILL.md); rules that need updating as the season, plan, or body changes go here. Pruned 2026-08-05 at the block reshape; FPL era rules (long run pace budgets, route shortlist, Mon flex, vert co-equality, mileage budget math) live in git history.

## The Recomp Block Shape (2026-08-05, reshaped 2026-08-19)

- **The skeleton is held loosely.** Every session is a default, not a law. Lifts and yoga move freely; place yoga against the actual Movement schedule each week rather than assuming the skeleton.
- **Swimming is retired (2026-08-18).** Congress Park closed ahead of Labor Day, pulling the September seam forward from W37 to W34. Laps did not move indoors; both held slots went to deep work. Do not propose swims, do not grade them, and do not offer to reopen the modality. High Noon consolidated onto Monday 12:00, so there is no Tuesday or Thursday recovery meeting to schedule around.
- **4K Friday alternates, seeded 2026-08-28.** Every other Friday 06:00 to 08:00, Golden, with the Tootsies / Sexy Pace crew, conversational, with 🚙 drive flanks at 05:30 and 08:00. On a 4K week the Friday deep work window curtails to 08:30, and Morning Routine plus its transition come off that day. The Friday lift lands at 15:30 either way.
- **Yoga is four standing holds** (2026-08-19): Tue Align and Flow 16:30, Thu Alignment 16:30, Sun Hatha 09:30, Sun Yin 16:15. Hatha and Yin are no longer opportunistic. Traveling still means skip without guilt; `n/a` in retros when away, never a miss. Week planning sits at 11:15, behind Hatha's return flank.
- **Heel guardrail: intensity is the trigger, not volume.** The heel flares after hard efforts (the 6:27 DRC mile, 2026-08-04), not easy miles. Conversational is the default; at most one hard effort a week; skip hard efforts entirely the week after any flare; any heel signal drops the next hard or trail effort. PT is a named focus of the block, form is the fix.
- **Scale trend is directional.** Sunday reads only for the log; single reads are noise. A 2 to 3 lb rebound through mid August is glycogen and water, not failure; the trend restarts from the first standard Sunday reads.
- **All three lifts sit at 15:30** (Mon, Wed, Fri, Movement RiNo), moved out of the midday on 2026-08-19 for consistency. Strength is always the late afternoon.
- **Fitbod programs the strength work; do not program it here.** Three sessions a week, core every session, emphasis on upper body and core, lower body on maintenance after the run block. The block doc holds the emphasis and the session count, nothing more. A short lived experiment in Claude owned programming ran 2026-08-05 to 2026-08-10 and was retired as a distraction; do not propose reviving it, and do not offer to build tooling around lift delivery or logging.

## Calendar Mechanics

- **30 min alignment for travel blocks**: drive events use 30 minute increments aligned to 30 minute blocks (06:30 to 07:00, not 06:15 to 07:00). Transitions default to 30 minutes (size, not alignment).
- **Always create both drive flanks**: a trailhead run without a paired `🚙 <Trailhead>` and `🚙 Home` is incomplete. Create all three together.
- **Edit training events on the Life calendar only** (🌱 Life, `mattforni@gmail.com`). Surfaced 2026-06-07.
- **A split recurring series can't have its start time changed; recreate it.** When a recurring event's ID ends in `_R<timestamp>`, the Calendar API rejects a start time change with `400 Invalid start time`. Delete and insert fresh. Plain recurring masters shift fine via a full `gws calendar events update` (GET, bump, PUT); a bare `events patch` of start/end fails the same way. Surfaced 2026-06-07.
- **Do not silently create missing recurring events**: surface them; the user may have skipped intentionally.

## Constraint Hygiene

- **Cold plunge after strength**: 4 to 6 hour gap, non-negotiable when contrast therapy returns. Sauna (heat only) is fine after strength.
- **Thursday morning is protected**: SPRC at 06:00 displaces all morning practices on Thursday.
- **Transitions are ALWAYS 30 minutes. Never 15.** Move the adjacent block instead of shrinking the transition. Forni, 2026-07-19: "always 30 minutes for transitions always, always, always."

## Retro Evaluation

- **Retro precedes scheduling.** Never schedule the current week without knowing what happened last week; drift compounds. Codified 2026-05-18 after Wk 2 of the FPL block was scheduled over an unexamined slip.
- **Strava is the source of record for ALL movement; never ask the user to confirm sessions.** Lifts, yoga, runs, all of it. A session absent from Strava did not happen, for retro purposes. Forni, 2026-08-02: "Strava will tell you if lifts or yoga happened. You do not need to ask me again."
- **Tally by sport_type, not distance alone.** Filter activities by type before counting; walks and yoga get miscounted otherwise. The native connector's `list_activities` carries `sport_type`; prefer it. Codified 2026-06-26.
- **Strava distances are metric; convert.** miles = meters / 1609.34, feet = meters * 3.28084.
- **Interrogate significant deltas, don't just record them.** The cause drives the adjustment more than the numbers do; ask category, then leave room for detail. Codified 2026-05-18 (the Wk 2 heel injury read as "fell off" until interrogated).
- **PAH is transit, not training.** The Wednesday bike commute to Project Angel Heart is logistics; mark PAH `n/a` in coverage. Codified 2026-05-25.
- **Coverage misses drive schedule repair, not target step downs.** There is no volume ladder in this block; a missed session means the slot needs moving or shrinking, and only a two week weight stall touches nutrition (the 18:30 close lever, proposed not imposed).

## Reference Library

- **Settled research lives in `reference/` beside this skill; consult it before re researching.** `reference/tapering.md` (2026-07-19) is archived FPL material; still authoritative if a race block returns. The `coach` agent (`~/.claude/agents/coach.md`) reads the same block doc and references; delegate retro reads and load questions to it.

## Weekly Summary

- **Every training pass ends with the one look weekly summary before anything else gets discussed**: sessions by modality, which Friday it is (4K or deep work), and the weight trend in one line, then the day by day table. Surfaced 2026-07-19; reshaped 2026-08-05 from mileage to modality. It is presented, not written: the week banner stopped carrying it 2026-09-07 ("I don't look in the banner for the training block").

## Retro Weight (2026-08-24)

- **Retros are a light dialogue, not a written artifact.** With the trail run mesocycle over, do not write Wk N retro subsections into the block doc, and do not use block relative week numbering at all; weeks are named by the ISO year calendar (W35, never "Wk 2"). The retro that matters is the conversational check inside weekly planning: the Strava pull, the coverage glance, the heel check, and the carry forward. Write a subsection only when something genuinely needs the record, and ask first. Forni: "We can deprioritize training. We can evaluate weeks according to the year calendar... I don't think I'll ever take a look at it now that we're out of the trail run training mesocycle."
- **The guardrail proposes; Forni decides.** The heel guardrail's "any signal drops the next hard or trail effort" is a proposal to surface, never an auto action: on 2026-08-24 he kept the first 4K Friday with tenderness noted. Surface the tension plainly, then follow his call.
