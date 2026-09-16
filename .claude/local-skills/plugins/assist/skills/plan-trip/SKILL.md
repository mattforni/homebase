---
name: plan-trip
description: Group trip and getaway planning. Scope the trip, pull live lodging availability, present options with per head cost, verify before booking, research the constraint that actually drives the trip (weather windows, permit and reservation release dates, access rules), hand off the booking, then capture a trip doc and schedule the time sensitive follow ups. Use this skill whenever Forni mentions planning a trip, a getaway, a group house, a cabin or Airbnb or VRBO for a crew, a basecamp for a race or hike or backpacking objective, finding lodging for friends, splitting a house, acclimation lodging, or asks "where should we stay", "find us a place", or "book the house" for an upcoming adventure. Also trigger for "/assist:plan-trip", "plan the Aspen trip", "find a house for the boys", or "we need a place for the loop weekend". Trip records live under `~/Eudaimonia/Craft/Adventure/`; this skill is the workflow counterpart to the Adventure planning conventions documented there.
argument-hint: "[scope | search | present | verify | book | doc]"
allowed-tools:
  - Bash
  - WebSearch
  - WebFetch
  - Read
  - Edit
  - Write
  - AskUserQuestion
---

# Plan Trip Assist

Help Forni plan a group trip end to end: from a vague "we need a place" to a booked house, a captured trip doc, and the follow ups scheduled. The skill is a pipeline, but it is enterable at any phase. If the house is already booked and Forni just wants the doc, jump to Capture. If options are already on the table and he is deciding, jump to Verify.

The whole point is to be a real planning partner, not a search box. The lodging is rarely the hard part. The hard part is the constraint nobody thought to check until it bit: the permit that releases on a fixed date, the afternoon storms that dictate a dawn start, the cancellation policy that is not what everyone assumed. Surfacing those is where this skill earns its keep.

## Before Every Invocation

1. Read [learned-rules.md](learned-rules.md) in this directory. It holds the calibrated gotchas from real trips, and it is the part most likely to save a misstep.
2. Read `~/Eudaimonia/Craft/Adventure/CLAUDE.md`, especially the **Checking real availability for specific dates** section. The live availability mechanics (VRBO dated search, the Guesty calendar API, Airbnb dated search via agent-browser) live there. This skill references them rather than restating them, so the two stay in sync.
3. Skim the existing trip docs under `~/Eudaimonia/Craft/Adventure/` for the house style. `2026 Four Pass Loop/README.md` and `2026 Summer Camp/README.md` are the two worked examples this skill is built from.

## Source of Truth

Trip records live under `~/Eudaimonia/Craft/Adventure/<YEAR Trip Name>/README.md`, registered in `Adventure/CLAUDE.md` as an active trip. The README is the spec and the running log. Booking engines (Airbnb, VRBO, the property's own site) are truth for live availability and price. The crew is truth for who is actually in.

## The Pipeline

### Phase 1: Scope

Nail the parameters before searching. Get these wrong and every option you present is noise. Ask **one question at a time** via `AskUserQuestion`, because each answer reshapes the next question, and because Forni thinks better when not handed a wall of prompts.

The four that matter:

- **Roster and headcount.** Who is actually coming, and does anyone bring a partner, kids, or a dog. This sets the bed count and the floor on bedrooms. "Probably 3ish rooms" is a real answer; pin the range, not a false precision.
- **Budget and its basis.** Ask whether to think in nightly total or **per head**, because for a group splitting a house, per head is usually the number that matters and the one the crew will react to. Do not assume a nightly ceiling; let him frame it.
- **Dates, locked versus floating.** Trips often have one hard anchor and one soft edge ("Sunday arrival is locked, the end date floats"). Find out which is which. The floating edge is a cost lever you can pull later.
- **Location must haves and constraints.** The real driver is often not the town. "Doesn't have to be Aspen, we want to get Collins elevation" reframes the whole search toward sleeping altitude, not proximity. Draw out the underlying need.

### Phase 2: Search

Pull **live, dated availability** for the exact window using the methods in `Adventure/CLAUDE.md`. Do not present a property until you have confirmed it is actually open for those nights; a generic listings page is not availability.

- Search across a few candidate areas when the constraint allows it, not just the obvious town. The acclimation trip's best value sat in Snowmass, not Aspen, and a higher altitude fallback (Leadville) existed an hour away. Casting one town wider than expected is usually worth it.
- Scour both VRBO and Airbnb when Forni asks to "see options". They surface different inventory. Note that Airbnb card prices are the nightly sum **before** cleaning and service fees, while VRBO totals are usually all in. Flag the mismatch so the comparison is honest.
- Filter to genuine bedroom count. Search filters lie; read each card.

### Phase 3: Present

Lay options out as a **tiered table** grouped by the tradeoff that matters (altitude vs proximity vs cost, or value vs premium), with **per head cost** on every row. Collapse the recommendation into the preferred row rather than writing a separate "I recommend" section. Give a short, opinionated read underneath: which one and why, and the one honest cost of that pick.

Keep it scannable. Forni reacts to a table faster than to prose. Link every property inline.

### Phase 4: Verify Before Committing

Before any money moves, verify the three things that are most often wrong:

- **The listing is real and matches.** Right town, right bedroom count, real reviews. A suspiciously cheap result deserves a 5 second look at the actual page before you put it forward.
- **The true all in price.** The "all fees included" subtotal on the search card is often **not** the final number. Lodging and occupancy tax frequently get added at the last checkout screen, and that gap is real (on the Four Pass Loop condo it was the difference between $2,267 and $2,563). State the all in, and note the tax caveat.
- **The cancellation policy.** Never assume "24 hours to refund" is universal; it depends on the listing (Flexible, Moderate, Firm, Strict). Read the actual policy. At several weeks out you are usually fine, but the safety net has to be confirmed, not guessed, before Forni commits.

### Phase 5: Research the Driving Constraint

This is the phase that separates a search from real planning. Almost every trip has one constraint that is not the lodging and that quietly dictates everything else. Find it and research it properly with `WebSearch` and `WebFetch`:

- **Weather windows.** Late summer in the Colorado high country means daily afternoon storms, which forces a dawn start on any exposed objective. The plan bends around the weather, not the other way around.
- **Permit and reservation release dates.** Trailhead parking, wilderness permits, and campground spots often release on a fixed date and sell out fast. These are time sensitive in a way lodging is not. Find the exact release date and time, and treat it as an action with a deadline.
- **Access rules.** Timed entry, shuttle requirements, road closures, vehicle restrictions. The thing that turns a clean plan into a scramble at 04:00.

When you surface one of these, say plainly that it matters more than the house, and let it reshape the recommendation. On the Four Pass Loop, the June 18 parking drop and the monsoon dawn start mattered more than which condo.

### Phase 6: Booking Handoff

**Never run Forni's card through an automated browser session.** Even with his go ahead to book, the final Reserve and payment click is his. This is a hard boundary, not a courtesy. Set him up so it is one click: the direct listing link with dates and guests prefilled, the all in number, and the confirmed cancellation policy so he knows the safety net before he commits. Then hand off.

If he wants the crew told, draft the message in the right register: a casual group text reads nothing like an email. The register rule and the comms tone notes live in [learned-rules.md](learned-rules.md). Offer to copy it to his clipboard with `pbcopy`.

### Phase 7: Capture

Finish the artifact before you call it done.

1. **Create the trip README** at `~/Eudaimonia/Craft/Adventure/<YEAR Trip Name>/README.md` using the structure below.
2. **Register it** in `Adventure/CLAUDE.md` under Current Trips with a Key Files row, so future sessions pick it up.
3. **Propose the time sensitive follow ups** and create them in Todoist only on Forni's yes. Reservation drops and refund deadlines are the classic ones. Put the exact datetime on the task, and add a timezone caveat when the source did not state one (recreation.gov releases are local to the site, so Mountain is the safe read for Colorado). Details go in a task comment per the Todoist conventions.

Trip README structure (adapt section names to the trip; this is the worked shape, not a rigid template):

```markdown
# <YEAR Trip Name>

<One paragraph: what the trip is, the objective, the shape.>

## Status
<What is locked, what is booked, what is still open. The first thing a future session reads.>

## Crew
<Table: person, status, notes. Who is in, who is maybe, who is out and why.>

## Dates
<What is hard locked vs floating. The lodging window. The objective day.>

## Lodging
<Booked place: link, where and why, the place, dates, all in cost and per head, cancellation policy.>

## The Plan (or The Attempt)
<The objective and how it gets done. The driving constraint and the strategy around it.>

## Logistics / Access
<Permits, reservations, timed entry, the release dates, the open knots.>

## Options Considered
<Tiered table of what was evaluated and why the pick won. Saves re deriving it.>

## Open Items
<Checklist. What is done, what is still live.>
```

## Booking Boundary, Restated

The one rule worth repeating because it is the one with real downside: tee up the booking, hand off the final click. You set the table; Forni eats.

## Learned Rules

See [learned-rules.md](learned-rules.md) for the live, mutable gotchas harvested from real trips. Stable workflow lives in this file; calibrated lessons and corrections go there.
