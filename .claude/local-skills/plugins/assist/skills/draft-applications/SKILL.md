---
name: draft-applications
description: Drain the work search queue. Turn each queued posting in the Pinole work API into a complete application package, one role at a time, and mark it applied once Forni confirms submission. Use when Forni says "apply to the queue", "run the applications", or "apply to <company>".
---

# Draft Applications

The back half of the work search pipeline. The `recruiter` agent fills the queue; this skill drains it, one role at a time. Forni always submits the application himself; this skill produces everything he needs to do that in one sitting.

## Where Truth Lives

Read before drafting; none of this is duplicated here:

- **The queue and ledger of record**: the Pinole work API through the `pinole` CLI. `pinole work postings list --status queued --table` is the work; widen it to `--status queued,shortlisted,flagged` when Forni is picking from the sweep rather than draining a queue he already set. The table renders Id, Seen, Company, Title, Status, Board, Key, and Verdict; the update and log verbs take the Id. Every status change lands on the posting the day it happens (`pinole work postings update`), and every submitted application is logged as an activity (`pinole work activities log`), which is the Colorado UI audit shape.
- **The rubric**: `~/Eudaimonia/Craft/Vocation/role-rubric.md`. Hard filters, dimensions, thresholds, shared with the recruiter.
- **The profile**: `~/Eudaimonia/Craft/Vocation/README.md`. Background, compensation expectations, role fit tiers. The source for every credential claim in a cover letter.
- **The plan**: `~/Eudaimonia/Craft/Vocation/Plans/FY27-H2.md`. The positioning frame (Mission Growth Engineering) and the weekly cadence the queue serves.
- **Voice and email practices**: the life level voice core is `~/Eudaimonia/VOICE.md`, overlaid in register order by `~/Eudaimonia/Admin/Tools/email.md` and `~/Eudaimonia/Craft/Vocation/CLAUDE.md` (Vocation Email Practices, Negotiation Philosophy). Job search notes carry no sign off line at all (Follow Up Email below), unlike the email.md default.
- **The outreach template**: `~/Eudaimonia/Craft/Vocation/templates/07-job-posting-cold-outreach.md` for the follow up email's mechanics; the Follow Up Email section below supersedes it on the note's shape, close, and sign off.
- **The standing form answers**: the Standing Form Answers table in `~/Eudaimonia/Craft/Vocation/work-history.md` holds the eligibility screeners and voluntary self identification answers every ATS form asks. Fill from it, and ask only when a form's wording departs from the question as written there.

## The Motion (One Role at a Time)

Work a single role to a finished package before touching the next; Forni processes serially.

Bracket the drain with the session timer per Session Timers in `~/Eudaimonia/Admin/Tools/toggl.md`: project `💼 Vocation`, description `🔎 Work Search` (the weekly block retired 2026-11-02 with the unemployment claim, so the timer names the work, not a block). Start before the first role; stop when the drain ends, whether the queue is empty or Forni stops early.

1. **Pull the next queued posting** (`pinole work postings list --status queued`, oldest first), or the posting Forni names.
2. **Fetch the live posting.** Confirm it is still open and still passes the rubric's hard filters (full remote or Denver metro, Senior+ IC). If a hard filter fails, reject it with the reason on the posting: `pinole work postings update <id> --status rejected --notes "<which filter and why>"`. If the posting is gone, close it (a shortlisted or flagged posting cannot move to closed; record it rejected with a "Closed:" note instead): `pinole work postings update <id> --status closed --closed-reason filled`. Either way, tell Forni and move on.
3. **Sanity check the fit score** the sweep assigned. Re-score from the rubric only on disagreement, and say why.
4. **Check for a warm path.** Open the company's LinkedIn people page in agent-browser on the personal Chrome identity (`--identity personal`; mechanics in `~/Eudaimonia/Admin/Tools/agent-browser.md`), filtered to first and second degree connections, and ask Forni one question: does he know anyone there, or anyone who would? When a path exists, a referral ask replaces the cold follow up in step 8. The method was proven by hand on 2026-09-08; its first run inside the pass is W38.
5. **Draft the cover letter** (250 to 350 words, structure below).
6. **Draft responses** to every application question the posting asks.
7. **Find the hiring manager** (search order below).
8. **Draft the follow up email** from template 07, with the note shaped per the Follow Up Email section below, as a Gmail draft (`gws gmail +send --draft --html`), then add the label `🛠️ Craft/💼 Vocation` with `users messages modify` on the draft's message id, since a draft refuses labels at create (the July 2026 taxonomy; the old Craft and RYLLC labels no longer exist). The draft carries no Gmail signature; `~/Eudaimonia/Admin/Tools/gws.md` has the recipe. **Draft only, never send:** outbound email to any human requires Forni's explicit approval of the exact final artifact, every time.
9. **Present the package** and stop. Forni reviews, submits in the portal, and says so.
10. **On his confirmation only**, two calls in this order: log the application activity, `pinole work activities log --on <date> --kind application --employer "<Company>" --position "<Role>" --url <posting url> --posting <id> --channel "Online (<ATS>)"`, then mark the posting applied, `pinole work postings update <id> --status applied` (the API stamps `applied_on` itself). An email only application takes `--channel Email` instead. A hiring manager becomes a HubSpot contact only when a real relationship forms.

## Cover Letter

Four paragraphs: mission resonance and why this company; the one or two most relevant experience threads (Gremlin CTO, QuitCarbon Head of Engineering) tied to their specific technical challenge; what Forni wants next and why this role is that; a warm close. Principles: every sentence specific to this company, no resume bullet recitation, no metrics bragging (experience over accomplishments), technical credibility through naming their actual stack or problem, genuine over polished.

## Application Question Responses

Structure per question type: "Why here" gets mission resonance, then technical excitement, then experience alignment, two sentences each. "Recent accomplishment" questions get the Zero Homes funnel story (instrumented and automated the acquisition funnel, speed to lead from days to hours, $1M in the first 90 days); "hardest technical challenge" questions get the Gremlin reliability scoring system. Recency questions never get answered with Gremlin; it is four years back. "Salary expectations" reads the README's compensation section and states a range with flexibility framing. Keep every answer concrete, technical, and free of therapy speak.

## Hiring Manager Search

In order: LinkedIn (company plus engineering leadership titles), the posting itself (reports-to lines, recruiter connections), the company site's team page, the company GitHub org. Size the target by company stage: under 50 people expect the CTO or a founder, 50 to 200 a VP or Head of Engineering, 200 to 500 a Director, above that a Director or Senior EM.

## Follow Up Email

Policy (set 2026-07-29): follow up on every application where a real hiring manager is identifiable; skip when the only option is a generic inbox. Verify the person on LinkedIn before any send (current at the company, owns the team); only the email address may be guessed (firstname@, then firstname.lastname@; stop after a second bounce). One ask, the role. **No fractional pitch while the unemployment claim is active**; that framing belongs to Atelic cold outreach, not W2 follow ups. Send only after the application is in. No automatic bump follow ups for now.

The note's shape (proven on the EnergyHub send, 2026-07-29; Forni called it fantastic), 110 to 120 words, four short paragraphs:

1. **Open:** "I recently applied to your [role, linked] opening and wanted to put a face on the application," then the forward request ("If there is someone else who would be better to chat with about the role, I would appreciate you forwarding this along to them").
2. **One sentence of credentials, compressed.** The career domain plus the single strongest credential (six years as CTO and co-founder of Gremlin). No customer name lists, no second credential; the resume carries those.
3. **The middle belongs to the mission.** "Since Gremlin I've felt drawn to mission driven work," with the mission roles as proof, then one sentence connecting this company's actual work to what it serves. Make that mission sentence the longest in the email, on purpose.
4. **Close:** "I hope we get a chance to chat soon. Either way, I appreciate your time and [the work you are doing to ...]." No scheduling link (set 2026-10-19).

Title Case subject (just the role and company, e.g. "Software Architect at EnergyHub"). The note ends on the close: no "Cheers and chat soon!" and no name (set 2026-10-19, for every job search note).

**One warm touch a week** (a reconnect, a referral ask, or a recruiter check in) is a standing supporting activity: the pass drafts it and, once it has happened, logs it with `pinole work activities log --on <date> --kind networking --employer "<Company or person>" --channel "<Email, LinkedIn, or Phone>" --notes "<what was asked>"`, never as an application. The channel is what the weekly claim reports as the contact method, so it is never left off.

## Guardrails

- One role per company per weekly pass (the rubric owns this rule).
- Never run `pinole work postings update <id> --status applied` or log the application activity without explicit confirmation the application went in; the ledger is audit evidence, not intent.
- Weak fit per the rubric means recommend not applying, even for a queued row; the queue is not a mandate, the rubric is.
- Consult `learned-rules.md` in this skill directory before starting, and append to it when a real application teaches something durable.
