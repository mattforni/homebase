---
name: report-unemployment
description: File the weekly Colorado unemployment payment request in MyUI+ from the activities ledger in the Pinole work API. Builds the reportable activity slate for the just ended claim week, drives MyUI+ through agent-browser attached to Forni's real Brave, walks the weekly payment request screens, and stops hard at both certifications for Forni's explicit yes. Use whenever Forni says "report unemployment", "request UI payment", "file the weekly claim", "MyUI+", mentions the Monday payment request task, or invokes /assist:report-unemployment. The claimer agent carries this method for background dispatch.
---

# Report Unemployment

The weekly motion that turns the activities ledger into a filed MyUI+ payment request. The ledger is already kept in audit shape (date, kind, employer, position, channel on every activity); this skill moves the week into the state system and stamps the confirmation trail back onto each activity. The `claimer` agent runs this method in the background and bails to Forni at every gate; run it inline when Forni wants to drive together.

## Where Truth Lives

- **The activities ledger**: the Pinole work API through the `pinole` CLI. The slate is `pinole work activities list --week <YYYY-Www> --table` for the claim week; the confirmation goes back with `pinole work activities report --confirmation <code> <id> [<id>...]` on every included activity id, and an activity left off the slate gets `pinole work activities exclude <id> --reason <text>` so the ledger records why. The table renders Id, Date, Kind, Employer, Position, Channel, Reported, and Notes; the report and exclude verbs take the Id. `--reported false` narrows a listing to what has not been stamped yet.
- **The claim**: `~/Eudaimonia/Constitution/Financial/FY27-unemployment.md`. Claimant ID, effective date, benefit year end.
- **The task**: Todoist "💰 Request UI Payment in MyUI+", recurring every Monday at 17:00. Completing it after submission is the last step.
- **The site**: the [MyUI+ claimant portal](https://myui.clouduim.cdle.state.co.us/Claimant/Core/Login.ASPX), sign in via ID.me. System hours 04:00 to 19:00 MT, nightly processing 22:00 to 03:00 MT.

## The Slate

Claim weeks run Sunday through Saturday; the Monday task files for the week that ended two days earlier. Pull the claim week with `pinole work activities list --week <YYYY-Www> --table` (the `--week` filter expands to the Sunday through Saturday claim week containing that ISO week's Monday) and keep only what was genuinely completed:

- **Applications** (kind `application`) report as job applications with outcome Applied.
- **Supporting activities** (kinds `listings_review`, `registration`, `registration_maintenance`, `resume_submission`) report with outcome No Decision.
- **Excluded**: anything still in flight, a `follow_up` with no reportable activity of its own, and anything that would not survive an audit. Every activity left off gets `pinole work activities exclude <id> --reason <text>` so the ledger says why; a posting that closed before anything went out or a role declined on fit never became an activity and needs nothing.
- The cadence targets five activities (three applications plus two supporting, per the FY27 plan). Fewer than five is reported honestly, never padded.

**Sweep forward before trusting the count.** The claim week's own rows are not the whole slate. An activity that was *committed to* in an earlier week and *happened* during the claim week is often recorded only on the earlier activity, as a note reading "call booked for <date>" or "interview scheduled", and never logged on the day it actually landed. Reading the claim week alone therefore undercounts. Before settling the count:

1. List the two preceding weeks (one `pinole work activities list --week <YYYY-Www> --table` call each) and scan their notes for any future date falling inside the claim week.
2. Confirm each against the calendar (`gws calendar events list` over the claim week) and the mailbox, which is where a call leaves its real trace. A post call email is the strongest evidence a booked call was actually held.
3. Anything confirmed is a genuine activity: log it on the day it happened (`pinole work activities log --on <date> --kind interview --employer <name> --posting <id>`, or `--kind networking` for a call that was not an interview) before the slate is settled, so the stamp lands on it with the rest. That backfill is the inline path's, exactly like the confirmation stamp: a background run never writes the API, and instead returns the confirmed rows in its report for the main session to log.

Codified 2026-08-25, when the week of 08-16 read as three applications and was actually four. A True Search intro call sat in the week of 08-09 as "Call booked 2026-08-18", the calendar showed it at 14:30 that Tuesday, and Forni's own "Great chatting, Nick" email an hour later proved it happened. Forni had to supply it from memory because neither the skill nor the agent thought to look one week back.

## Browser Mechanics

The agent-browser bundled Chromium cannot pass the ID.me Cloudflare challenge, headed or not; the check spins forever on the automation fingerprint. Attach to Forni's real Brave instead:

1. Quit Brave gracefully (`osascript -e 'quit app "Brave Browser"'`) and wait for the process to exit.
2. Relaunch with the port: `open -a "Brave Browser" --args --remote-debugging-port=9222 --restore-last-session`.
3. Verify the port with `curl -s http://localhost:9222/json/version`, then confirm Brave itself owns it with `lsof -nP -i :9222 | grep LISTEN`. Do not check the JSON's `Browser` field: Brave is Chromium and reports `Chrome/<version>` there, never its own name, so that test can only ever fail. A listener that is not Brave means a stale process holds the port, so stop rather than attach. Then `agent-browser --session myui connect 9222`.
4. Open MyUI+ in a new tab and pin it (`tab new <url>`, `tab list`, `tab <id> --pin-tab`). Unpinned, the session follows whatever tab Forni focuses.

If a fresh ID.me login or MFA is needed, hand the keyboard to Forni and wait. An existing session redirects the login URL straight into the claimant flow.

## The Flow

Drive every control by DOM id, and read the section and error state rather than trusting a reported success. Snapshot ref clicks do fire on this site, but refs shift on every postback, so a stable id is the safer target. Ids and the entry path are in [learned-rules.md](learned-rules.md).

1. **Confirm the week.** Start from My Claim Status and open the specific week row whose dates match the slate, not a generic start button. Only one week is ever certifiable, and the next week's row shows the date it opens.
2. **Basic Questions are Forni's answers** (work, earnings, offers, able, available). Inline, walk them with him; a background run bails to the main session the moment the section is not already Complete, per the agent contract. Forni may hand the whole section over ("I trust you to answer these"), and most of it genuinely is derivable from the record: offers, refusals, quits, discharges, layoffs, holidays, able, available, and work search all follow from the ledger and the week. **Two never are, no matter how broad the authorization: whether he worked (self employment counts, so any Atelic work is work) and whether he received severance, retirement pay, 401(K), or pension.** Only he knows those, a wrong answer is a false certification under penalty of perjury, and a blanket yes does not create knowledge. Ask those two, answer the rest, and say which is which.
3. **Activity count**: select the radio matching the slate size (Five or More at cadence).
4. **One form per activity**, saved individually. Field ids, dropdown mapping, and the ASPX gotchas live in [learned-rules.md](learned-rules.md). Verify each save by the numbered activity list growing.
5. **Work Search Plan** checkboxes describe the coming week's intent: inquire online, apply online, interview online and by phone, other activities.
6. **GATE: work search certification.** Checkbox plus initials (MGF), then FINISH. Requires Forni's explicit yes in that moment.
7. **Summary readback.** Read every section back to Forni in full: Basic Questions answers, all activities, the plan.
8. **GATE: penalty of perjury certification and Submit.** Requires Forni's explicit yes in that moment. Two gates, two yeses; never batch them.
9. **Capture and close.** Record the confirmation number, submitted week, and timestamp. Inline, stamp every included activity with `pinole work activities report --confirmation <code> <id> [<id>...]` (one call, every id from the slate); a background run reports the number and the ids and leaves the stamp to the main session. Complete the Todoist task and report the number.

## Activity Type Mapping

| Activity `kind` | MyUI+ type of activity option |
|---|---|
| `application` | Completed a job application in person, by mail, or online with an employer who may reasonably be expected to have openings for suitable work. |
| `listings_review` | Reviewed job listings on the internet, newspapers or professional journals. |
| `registration` | Used online job matching systems, including Connecting Colorado, to submit applications/resumes, search for matches or request referrals, and/or apply for jobs. |
| `registration_maintenance` | Used online job matching systems (the same option as `registration`). |
| `resume_submission` | Used online job matching systems (the same option as `registration`). |
| `networking` | Networked with colleagues or friends. |
| `interview` | Interviewed with a potential employer in person or by telephone. |
| `follow_up` | Not reportable on its own. It stays folded into the application it follows and never gets a form of its own. |

Contact method comes from the activity's `channel` (Online for the standard motion). Contact information takes the activity's `url`. Position and platform go in Additional Information; the form has no position field.
