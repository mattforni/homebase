# Learned Rules

Rules added from triage corrections. Read on every invocation. These override default rules in reference/triage-rules.md.

Rules for a single skill belong in that skill's own `learned-rules.md`.

The email routing rule sets (Sender Rules, Topic Rules, Subject Rules, Star Semantics, Domain Rules, Created Filters) live in [reference/email-rules.md](reference/email-rules.md).

## Behavior Rules

- **CRITICAL: Check the actual system time before writing time-of-day greetings.** Do not assume morning/afternoon/evening. Run `date` or check the clock. This has caused errors in sent emails that cannot be corrected.
- When someone asks for availability to schedule a call/meeting, default to sharing the Reclaim scheduling link rather than proposing specific time slots. It's simpler and always up to date.
- When the user has reviewed and approved email drafts, send them directly if asked. Do not insist on creating drafts first. The review already happened in conversation.
- **The rule above does not extend to prospective or current clients.** For those, confirm again on the final rendered email at send time regardless of prior conversational approval. A client send (2026-07-20) went out on the words "go ahead and send it right now" when the intent was "schedule the send block"; the cost of one extra confirmation is always smaller than an unintended send.
- Stars mean action is needed from the user. Do not star informational emails. When in doubt whether an email needs action, read the full content first before assigning a star. A 1099 "available online" notice is informational (Coinbase handles it), not an action item.
- **When presenting an email for a triage decision, show the email itself.** Include a clickable Gmail link (`https://mail.google.com/mail/?authuser=<account>#search/rfc822msgid%3A<url-encoded-Message-ID>`, which is account-safe and tab-safe) and, when the decision depends on content, `open` that URL in the browser and/or quote the full body inline. Forni cannot decide on a paraphrase alone; "I can't tell you unless you show me the email." Codified 2026-07-22.
- **Email triage is strictly one email at a time. Never batch auto-process; never present a consolidated bulk triage plan.** Even when Forni says "get them all out of there," "clear them all," or similar, that phrasing means he wants to move efficiently, not that he is delegating the decisions. Present each email individually (sender, subject, what it is, proposed action), wait for his call, execute, then move to the next. The only safe pre-action is reading and classifying; every label / star / archive / trash decision is his, one at a time. **This supersedes Phase 2 (Silent Auto-Process)** — surface even high-confidence purchases one at a time rather than pre-processing them.

  **Why:** Codified 2026-06-01. Opened a triage session by auto-processing two purchases and presenting a grouped plan-table for ~21 emails with bulk-approve questions. Forni: "undo everything you did with the emails. I need you to consult with me first. This was not useful." After reverting, he said "One email at a time."

  **Amended 2026-08-02 (clerk proposal boards):** the one at a time rule governs decisions, not presentation. The clerk agent now pulls every inbox thread and returns one fully specified proposed disposition per thread, marked ✓ (rule backed) or ? (judgment). Forni reviews the whole board, corrects any rows, and the main session executes only the corrected board. That review pass replaces sequential per email questioning for ✓ proposals; ? items, outbound sends, and unsubscribes from possibly wanted senders still get an explicit question each. Auto processing before Forni's pass remains forbidden. Forni: clerk "should make suggestions that we can then just act upon or correct." **Amended 2026-08-03 (clerk executes the corrected board):** after Forni's pass, resume the same clerk to execute the corrected board itself; it holds the message IDs, so execution is cheaper there than in the main session. Execution boundaries live in clerk.md (no sends, no permanent deletes, no unsubscribes without explicit direction, stars stripped on archive, tracked repo records returned to the main session). The main session executes only when the clerk is unavailable.

## Todoist Rules

- When triaging notes/bookmarks that get moved to their proper location (Eudaimonia, etc.), delete the Todoist task. Do not complete it. These were never real tasks.
- Task titles: emoji prefix + short linked title (e.g., "📧 [Follow Up with Jeff](link)"). Details go in a comment, not the description.

## Calendar Rules

- Never move, reschedule, or delete existing calendar events without explicit permission. Always present the proposed change and wait for approval.
- Events booked via Reclaim.ai scheduling links were scheduled by other people. Extra caution required.
- Deleting or moving adjacent events can cause Reclaim to auto-reschedule nearby flexible events as a side effect. Warn about this.
- **Never schedule an event over a transition block.** Transitions exist to hold that space; placing an errand or event on top of one defeats the point. Find the next clear slot after the transition instead. Codified 2026-08-02 after a Sprouts run was placed over the post High Noon transition.

## Slotting Rules

- **Mornings are for deep work only; lighter cognitive tasks slot to afternoons.** The 07:30 to 11:00 morning window (anchors shortened 2026-08-02: routine 06:00 to 07:00, transition 07:00 to 07:30) holds anything that needs hard thinking or unbroken time. Admin, errands, follow ups, calls, and easier financial chores go to afternoons.

  **Why:** Codified 2026-08-02 (W32 planning). Forni: "let's try to do everything that's like deep work, things that require me to think hard or to have uninterrupted time, into the morning slots." This REVERSES the 2026-05-18 morning admin rule, which belonged to the Zero W2 era; do not resurrect it.

  **How to apply:** During slotting, classify each task by cognitive load (the 🧠 Sharp / ⚖️ Medium / 🍃 Light labels are the signal): Sharp goes first thing into a protected morning, Medium to midday, Light to late afternoon. Reclaim work blocks follow the same shape via due dates and block moves.

- **Every slotted item carries a cognitive load label and a pillar project.** When slotting, set exactly one of 🧠 Sharp / ⚖️ Medium / 🍃 Light, and move the task out of Inbox into its pillar project (🍏 Constitution, 🧠 Contemplation, 🤗 Community, 🛠️ Craft). Codified 2026-08-02 after a slotting pass left both off.

- **The cognitive load label grades how sharp Forni has to be, never how long the work takes.** 🧠 Sharp is novel thinking, design, writing that matters, anything with stakes. ⚖️ Medium is known work done with attention, no invention required. 🍃 Light is mechanical: admin, errands, follow ups. The label is deliberately independent of the estimate (Linear points use the exponential scale, where 1 point is 30 minutes, 2 is an hour, 4 is two hours, and 8 is four hours, and the block is exactly as long as the estimate; Todoist keeps its `duration` field), and the two decide placement together: the estimate says how long the block is, the label says when in the day it lands. The same three labels exist in Todoist and in Linear (team ATE, `atelic` workspace), so personal and work items share one vocabulary. Full scale in `~/Eudaimonia/Admin/Concepts/cognitive-load.md`.

  **Renamed 2026-08-10.** The old effort scale (1️⃣ Tough / 2️⃣ Middlest / 3️⃣ Easy) graded difficulty; the new scale grades cognitive load. Todoist labels were renamed in place so existing tasks carried automatically; Linear's three were created fresh at team level. The old names are historical and should not appear in new writing.

- **Never destroy contact info when retitling a task.** A bare email address or phone number as a task title IS the payload; a rename must carry it into the description or a mailto link in the title. Codified 2026-08-02 after a retitle stripped an email address and left the task unactionable.

- **Sharp work sits in Monday and Tuesday mornings; Medium and Light work fills Thursday and Friday.** The load label picks the day of the week as well as the hour: Forni is sharpest early in the week after a weekend away from the screen. Legal and admin drafting such as the Operating Agreement is afternoon work.

## Codification Rules

- **No half step phase numbering.** When inserting a new phase into an existing skill or document, renumber subsequent phases rather than creating `Phase 4.5` or `Phase 3.5`. Half steps look like patches; integer sequences look like deliberate structure.

  **Why:** Surfaced 2026-05-18 when adding an interrogation phase to `assist:plan-training` retro mode. Initial draft used `Phase 4.5` for the new step. Forni redirected: "let's not codify things in general as half steps. So phase four and a half or phase three and a half, let's just go with moving the other phases backwards."

  **How to apply:** New phase goes at its integer position. Every phase after it shifts up by one. Update body cross references (e.g., "continue to Phase 5") and any references in learned-rules.md or other skills that point at numbered phases. Worth a final grep for `Phase [0-9]\.[0-9]` to catch stragglers.

## Spend Categorization

Moved to [skills/handle-budget/learned-rules.md](skills/handle-budget/learned-rules.md), the one place the payee corrections and YNAB mechanics live.
