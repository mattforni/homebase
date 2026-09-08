---
name: draft-applications
description: Drain the work search queue. Consume Queued roles from the FY27 work search log and produce a complete application package per role, one at a time, in this order - fit sanity check, cover letter, application question responses, hiring manager research, follow-up email draft - then move the row to Applied once Forni confirms submission. Use whenever Forni says "apply to the queue", "run the applications", "apply to <company>", or Queued rows exist after a recruiter sweep. Replaces the retired job-apply skill.
---

# Draft Applications

The back half of the work search pipeline. The `recruiter` agent fills the queue; this skill drains it, one role at a time. Forni always submits the application himself; this skill produces everything he needs to do that in one sitting.

## Where Truth Lives

Read before drafting; none of this is duplicated here:

- **The queue and log of record**: `~/Eudaimonia/Craft/Vocation/FY27-work-search.md`. Rows with Status Queued are the work. Every status change lands here the week it happens; the log is Colorado UI audit shape.
- **The rubric**: `~/Eudaimonia/Craft/Vocation/role-rubric.md`. Hard filters, dimensions, thresholds, shared with the recruiter.
- **The profile**: `~/Eudaimonia/Craft/Vocation/README.md`. Background, compensation expectations, role fit tiers. The source for every credential claim in a cover letter.
- **The plan**: `~/Eudaimonia/Craft/Vocation/Plans/FY27-H2.md`. The positioning frame (Mission Growth Engineering) and the weekly cadence the queue serves.
- **Voice and email practices**: the life level voice core is `~/Eudaimonia/VOICE.md`, overlaid in register order by `~/Eudaimonia/Admin/Tools/email.md` and `~/Eudaimonia/Craft/Vocation/CLAUDE.md` (Vocation Email Practices, Negotiation Philosophy). Sign off per email.md ("Cheers and chat soon!", never a name; the Gmail signature handles it).
- **The outreach template**: `~/Eudaimonia/Craft/Vocation/templates/07-job-posting-cold-outreach.md` for the follow-up email.
- **The standing form answers**: the Standing Form Answers table in `~/Eudaimonia/Craft/Vocation/work-history.md` holds the eligibility screeners and voluntary self identification answers every ATS form asks. Fill from it, and ask only when a form's wording departs from the question as written there.

## The Motion (One Role at a Time)

Work a single role to a finished package before touching the next; Forni processes serially.

Bracket the drain with the session timer per Session Timers in `~/Eudaimonia/Admin/Tools/toggl.md`: project `💼 Vocation`, description `🔎 Weekly Work Search` (the block, the Toggl project, and the Toggl doc were all renamed 2026-09-08). Start before the first role; stop when the drain ends, whether the queue is empty or Forni stops early.

1. **Pull the next Queued row** (or the role Forni names).
2. **Fetch the live posting.** Confirm it is still open and still passes the rubric's hard filters (mission, full remote, Staff+ IC). If the posting is gone or a hard filter fails, note it on the row, tell Forni, and move on.
3. **Sanity check the fit score** the sweep assigned. Re-score from the rubric only on disagreement, and say why.
4. **Check for a warm path.** Open the company's LinkedIn people page in agent-browser attached to Forni's real Brave (the attach recipe lives in `assist:report-unemployment` and `~/Eudaimonia/Admin/Tools/agent-browser.md`), filtered to first and second degree connections, and ask Forni one question: does he know anyone there, or anyone who would? When a path exists, a referral ask replaces the cold follow up in step 8. The method was proven by hand on 2026-09-08; its first run inside the pass is W38.
5. **Draft the cover letter** (250 to 350 words, structure below).
6. **Draft responses** to every application question the posting asks.
7. **Find the hiring manager** (search order below).
8. **Draft the follow-up email** from template 07 via the gws CLI as a Gmail draft with the label `🛠️ Craft/💼 Vocation` (the July 2026 taxonomy; the old Craft and RYLLC labels no longer exist). **Draft only, never send:** outbound email to any human requires Forni's explicit approval of the exact final artifact, every time.
9. **Present the package** and stop. Forni reviews, submits in the portal, and says so.
10. **On his confirmation only**, move the row to Applied with the date. A hiring manager becomes a HubSpot contact only when a real relationship forms.

## Cover Letter

Four paragraphs: mission resonance and why this company; the one or two most relevant experience threads (Gremlin CTO, QuitCarbon Head of Engineering) tied to their specific technical challenge; what Forni wants next and why this role is that; a warm close. Principles: every sentence specific to this company, no resume bullet recitation, no metrics bragging (experience over accomplishments), technical credibility through naming their actual stack or problem, genuine over polished.

## Application Question Responses

Structure per question type: "Why here" gets mission resonance, then technical excitement, then experience alignment, two sentences each. "Recent accomplishment" questions get the Zero Homes funnel story (instrumented and automated the acquisition funnel, speed to lead from days to hours, $1M in the first 90 days); "hardest technical challenge" questions get the Gremlin reliability scoring system. Recency questions never get answered with Gremlin; it is four years back. "Salary expectations" reads the README's compensation section and states a range with flexibility framing. Keep every answer concrete, technical, and free of therapy speak.

## Hiring Manager Search

In order: LinkedIn (company plus engineering leadership titles), the posting itself (reports-to lines, recruiter connections), the company site's team page, the company GitHub org. Size the target by company stage: under 50 people expect the CTO or a founder, 50 to 200 a VP or Head of Engineering, 200 to 500 a Director, above that a Director or Senior EM.

## Follow-Up Email

Policy (set 2026-07-29): follow up on every application where a real hiring manager is identifiable; skip when the only option is a generic inbox. Verify the person on LinkedIn before any send (current at the company, owns the team); only the email address may be guessed (firstname@, then firstname.lastname@; stop after a second bounce). One ask, the role. **No fractional pitch while the unemployment claim is active**; that framing belongs to Atelic cold outreach, not W2 follow-ups. Send only after the application is in. No automatic bump follow-ups for now.

The note's shape (proven on the EnergyHub send, 2026-07-29; Forni called it fantastic), 110 to 120 words, four short paragraphs:

1. **Open:** "I recently applied to your [role, linked] opening and wanted to put a face on the application," then the forward request ("If you're not the right person to chat about this role with, I'd appreciate you forwarding this along to whoever's leading the hire").
2. **One sentence of credentials, compressed.** The career domain plus the single strongest credential (six years as CTO and co-founder of Gremlin). No customer name lists, no second credential; the resume carries those.
3. **The middle belongs to the mission.** "Since then I keep choosing climate:" with the climate roles as proof, then one sentence connecting this company's actual work to the crisis. Make that mission sentence the longest in the email, on purpose.
4. **Close:** "Worth a chat? Here's my scheduling link to make it nice and easy. Either way, I appreciate your time."

Title Case subject (just the role and company, e.g. "Software Architect at EnergyHub"). Never sign a name; the Gmail signature handles it.

**Two channels through W40 (set 2026-09-08).** The follow up also goes as a LinkedIn connection request note to the same person, the note trimmed to LinkedIn's limit and drafted only, sent on Forni's explicit approval of the exact note like the email, so the two channels can be compared on replies. A connection note is guaranteed to reach the person where a guessed address is not.

**One warm touch a week** (a reconnect, a referral ask, or a recruiter check in) is a standing supporting activity: the pass drafts it and logs it as networking, never as an application.

## Guardrails

- One role per company per weekly pass (the rubric owns this rule).
- Never mark a row Applied without explicit confirmation the application went in; the log is audit evidence, not intent.
- Weak fit per the rubric means recommend not applying, even for a queued row; the queue is not a mandate, the rubric is.
- Consult `learned-rules.md` in this skill directory before starting, and append to it when a real application teaches something durable.
