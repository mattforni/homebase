# Plan Trip: Learned Rules

Live, mutable rules harvested from real trips. The stable workflow lives in `SKILL.md`; calibrated lessons and corrections accumulate here. Add to this file when a trip surfaces a new gotcha, and prune when one stops being true.

Seeded from two runs: **2026 Summer Camp** (Buena Vista lodge, headcount 15) and **2026 Four Pass Loop** (Snowmass acclimation condo, the boys). Extended by **2026 Aspen Wedding** (solo wedding weekend, offseason Aspen, budget lodging).

## Scoping

- **Think per head, not per night, for group trips.** When a crew splits a house, the per head number is the one they react to and the one that makes a $3,699 house feel cheap. Ask which basis Forni wants, but default to surfacing per head on every option. *Why: the same house reads as expensive nightly and a steal per head; the framing changes the decision.*

- **Find the locked anchor and the floating edge.** Trips usually have one hard date and one soft one ("Sunday arrival is locked, the end date floats"). The floating edge is a cost lever: dropping a night is the cheapest way to lower the total. Pin which is which during scoping. *Why: a floating checkout turned a 7 night quote into a 5 night one and cut the per head cost meaningfully.*

- **Draw out the real location constraint.** The town is often a red herring. "Doesn't have to be Aspen, we want to get Collins elevation" reframes the search from proximity to sleeping altitude and opens better options. Ask what the trip is actually optimizing for. *Why: the best value sat in Snowmass, and a max altitude fallback sat an hour away in Leadville, neither of which a literal "Aspen" search prioritizes.*

- **An event anchored trip scopes itself from the event's own artifacts.** For a wedding: the save the date email, the event page, and the wedding website carry the schedule, venues, dress codes, the RSVP deadline, and the room block rate. The block rate becomes the price anchor that makes every budget option legible. *Why: the Hotel Jerome block at $650 a night made a $438 weekend read as the win it was, and the wedding site surfaced the RSVP deadline as the real time sensitive item.*

- **For a wedding, the location constraint is walk to venue on the reception night.** Price down valley savings against a late night drive home from a reception before presenting them as savings. *Why: Glenwood Springs saved $234 over two nights and cost a 45 minute drive after an evening of drinking; the savings do not survive that math.*

- **Solo flips the defaults, but ask anyway.** Total replaces per head, dorms and hostels enter the option set, and the real preference may sit between tiers. *Why: "private room if possible" put private hostel rooms with a shared bath at the center of the Aspen search, a tier that a dorms versus hotels framing would have missed entirely.*

## Searching

- **Confirm dated availability before presenting anything.** A listings page is not availability. Use the VRBO dated search and the Guesty calendar API and Airbnb dated search from `Adventure/CLAUDE.md`. *Why: presenting a place that is booked for the dates wastes everyone's time and erodes trust in the option set.*

- **Airbnb card prices are pre fee; VRBO totals are usually all in.** When comparing across the two, say so, or the comparison is dishonest. Airbnb adds cleaning and service (figure another 12 to 18%) and the lodging tax at the final screen. *Why: an Airbnb card and a VRBO card showing the "same" price are not the same price.*

- **Cast one town wider than asked.** Search a couple of candidate areas, not just the obvious one. *Why: the acclimation trip's value pick and its altitude fallback both sat outside the named town.*

- **Booking.com is closed to headless browsers; do not spend a fleet agent on it.** It detects automation, strips dated search params, and serves empty landing pages. Google Hotels with dates set is the workable OTA comparison, and its "Stay total" display is genuinely all in. *Why: on the Aspen run one fleet agent burned 20 minutes against Booking's walls and returned nothing, while the Google Hotels agent came back with checkout grade totals for three towns.*

- **On a holiday weekend, search for first come pools, not open sites.** By the day before, every reservable site within two hours is gone; the decision is made by counting `Not Reservable` sites per campground in the recreation.gov data and picking the largest cluster with a fallback chain a few minutes apart. *Why: the 2026-09-05 Labor Day search found zero reservable sites across 30 campgrounds, and Olive Ridge plus Meeker Park Overflow, 57 first come sites five minutes apart, beat every drive up option.*

- **Campground availability runs by the mechanics in `Adventure/CLAUDE.md`, and a captcha wall ends the check.** The rec.gov API, the cpwshop city search, and the ResNexus captcha are recorded there; when an engine puts up a captcha, report it and hand Forni the phone number. *Why: same run; solving a captcha from an agent session is disguise, which the stealth rule below already forbids.*

- **Offseason shoulder weekends cut both ways.** Rates sit at the yearly low, but properties close for the season, amenities shut down, and inventory gets quirky (St. Moritz sells no dorm beds online in offseason). Confirm a property is open for the dates rather than assume it, and treat a budget lodge that is open as a find. *Why: the Aspen closure wave starts about Oct 20, so the wedding weekend was the last open weekend of fall, which is exactly why a $195 a night room existed.*

## Verifying

- **The "all fees included" subtotal is often not the final number.** Lodging and occupancy tax frequently get added at the last checkout screen. State the true all in and flag the tax caveat. *Why: on the Four Pass Loop condo the search card said $2,267 all in, the actual checkout was $2,563. That gap is real money and it is the number the crew should hear.*

- **Never assume the cancellation policy.** "24 hours to refund" is not universal; it depends on the listing tier (Flexible, Moderate, Firm, Strict). Read the actual policy text before Forni commits. At several weeks out he is usually fine, but confirm the safety net rather than guessing it. *Why: the refund window is what makes "book now, decide by EOD" safe, and it is only safe if it is actually there.*

- **A suspiciously cheap result earns a 5 second look at the real page.** Verify town, bedroom count, and reviews before putting it forward. *Why: the cheapest Snowmass 3BR looked too good; a quick check confirmed it was legitimate, and that check is what made it safe to recommend.*

- **When an engine walls the fleet, verify read only through Forni's real browser.** agent-browser attached to his Brave (`--session <name> --cdp 9222`) passes bot checks (Cloudflare Turnstile, headless gates) that block a launched agent-browser session every time. Pin the session to the property tab (`--pin-tab`) and read back its URL before reading availability, since an unpinned session follows whatever tab he focuses. Never escalate headless with stealth or user agent masking; the permission classifier blocks it, and it is disguise. *Why: Tyrolean's WebRez engine was unverifiable headless, and the real browser reached the live availability calendar in under a minute.*

- **Read "no availability" for its cause on the property calendar.** Sold out, seasonally closed, and minimum stay restrictions are different verdicts with different next moves. *Why: Tyrolean's two night search said no availability, but the room calendar showed every room blocked Friday and most open Saturday. Friday sellout, not closure, so no phone call could fix it and the option died cleanly.*

## The Driving Constraint

- **Research the non lodging constraint; it usually matters more than the house.** Weather windows, permit and reservation release dates, access and timed entry rules. Find it, research it with web search, and let it reshape the recommendation. *Why: on the Four Pass Loop, the monsoon dawn start and the June 18 parking drop drove the plan far more than which condo won.*

- **Reservation and permit release dates are time sensitive actions, not notes.** When a trailhead parking or wilderness permit or campground spot releases on a fixed date and sells out fast, put it in Todoist with the exact datetime and a P1, and add a timezone caveat when the source did not state one. Recreation.gov releases are local to the site, so Mountain is the safe read for Colorado. *Why: a permit that opens at 08:00 and sells out by 08:05 is a calendar event, and missing it can sink the objective even with the house booked.*

## Booking and Handoff

- **Tee up the booking; hand off the final click.** Never run Forni's card through an automated browser session, even with his go ahead. Set him up with the prefilled link, the all in number, and the confirmed cancellation policy, then let him press Reserve. *Why: this is a hard boundary on spending his money; the convenience of auto booking is not worth the risk of an unwanted charge.*

- **Match the comms register to the channel.** A casual group text to the boys reads nothing like an email. Tight, warm, no sign off, the per head number up front, the deadline plain. Offer to copy it to the clipboard. *Why: the crew message is the last action and should reflect the final state cleanly; the wrong register lands wrong.*

## Capture

- **Finish the doc before calling it done.** Create the trip README, register it in `Adventure/CLAUDE.md`, propose the follow ups. *Why: the planning value evaporates if it lives only in a chat that scrolls away; the README is the source of truth the next session reads.*

- **Propose Todoist follow ups; never create them unprompted.** List the candidate tasks and create them on Forni's yes. An explicit prior directive to track something counts as the yes. *Why: both unprompted tasks from the Aspen wedding run were wrong, since the RSVP was already in and the Sunday decision was deliberately unscheduled, and Forni asked to be asked. Mirrors GC's ask before ticketing rule for Linear.*
