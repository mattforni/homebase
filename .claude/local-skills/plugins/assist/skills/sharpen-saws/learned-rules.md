# Learned Rules

## Branch Naming

Sharpen sessions are branched as `YYYY-MM-DD-sharpen-saws` in every repo touched by the session (currently Eudy and homebase). Date first so branches sort chronologically; same branch name across repos so a given session's work correlates at a glance. (Reversed from the earlier `sharpen-YYYY-MM-DD` form on 2026-07-23 at Forni's direction.)

**Why:** Forni wants a consistent way to find any sharpen session's work across both repos without hunting commit messages, with the date leading so listings sort by session.

**How to apply:** At the top of Close, cut a worktree on the branch in each touched repo (`git -C <repo> worktree add <path> -b YYYY-MM-DD-sharpen-saws origin/main`), per the work-in-worktrees rule. If the branch already exists (rerun or continuation), enter its existing worktree instead.

## Ticketed Rows Are Pointers, Never Counters

A Background row that has a Linear ticket is read from Linear at Ground and never carried with a deferral count. The aging term (a row at count two becomes the default pick) was retired 2026-09-23 because every row it ever aged was resolved by a ticket or retired, never by a session.

**Why:** 2026-09-23. The count 2 row ("the outreacher's drafting half to Cloud Run, Tuesday 05:00") was stale on all three of its facts: the agent had been renamed plumber, the fire time decided was Monday 22:00, and ATE-551 already held the job, seven secrets, and a local fire. Taking it would have duplicated the ticket; retiring it was bookkeeping. socrates traced the same pattern through every carried row on record.

**How to apply:** At Close, every deferral gets one of three ends: closed, ticketed, or retired. A ticketed row leaves the paragraph; the next Ground reads its state with `linear issue view`. Only unticketed rows stay in Background, each with its first date, and none survives two entries.

## CronCreate Is Not a Level 7 Primitive

`CronCreate` (and by extension the `/loop` and `/schedule` skills that wrap it) only fires while a Claude REPL is live and idle. `durable: true` persists the job across Claude restarts but still requires a live session at fire time. Auto expires after 7 days either way.

**Why:** Discovered during the 2026-04-23 sharpen session. Attempted to schedule `/assist:mise` for weekday mornings. CronCreate reported the job as session-only even with `durable: true` passed explicitly, and the underlying mechanic requires an open REPL. Net effect: zero background autonomy unless Forni happens to be at Claude when the cron fires.

**How to apply:** When proposing a "schedule X to run in the background" move, do not default to CronCreate. For true OS-level scheduling on macOS, the right primitive is launchd (plist in `~/Library/LaunchAgents/`) invoking `claude -p "<slash command>"`; for anything that draws from the vault, Cloud Run Jobs plus Cloud Scheduler. CronCreate is still useful for in-session reminders ("nudge me in 20 minutes") but not for daily routines.

## Audit Existing Feedback Channels Before Scaling Background Agents

Before proposing a new headless routine, audit the feedback channels on existing ones. If notifications are the only path for success/failure, that is a gap and the next move should harden it, not add another agent.

**Why:** 2026-05-07 sharpen session. Proposed extending the headless pattern from one routine (mise) to a second (Monday `/assist:plan-week`). Forni redirected: "Before we move on to automation another routine, we first need to get better at the feedback and backpressure mechanisms for mise. Right now, it fails silently sometimes (because my notifications are silenced) and even when it succeeds, it tries to tell me some things, but they get cut off in the notification and when I click through, I get nothing else." macOS notifications are best effort and load-bear too much when used as the source of truth.

**How to apply:**

- For each live headless routine, ask: "If this fails silently, how would Forni find out?" If the answer is "macOS notification" alone, that is insufficient.
- The current robust pattern is per-run email via Resend with API key in the vault, recipient in `REPORT_RECIPIENT`, the failure page mailed by the runner's EXIT trap. See `homebase/.claude/references/headless-claude.md` "Email reporting via Resend" section. The Audit phase's failed fire row is where this gets checked every week (the W39 recruiter fire, 2026-09-21, mailed its failure page and was fixed by hand the next morning).
- Apply this scrutiny in proportion to schedule frequency. A weekly routine that fails silently for a week is much worse than a daily one that fails silently once.

## Structural Moves Get Plan Mode Before Any File Is Written

When a sharpen session creates or reshapes a durable surface (an agent, a skill, a hook, a workflow), enter plan mode and walk the design with Forni before authoring anything. Ground the design in the authoring conventions (`~/.claude/references/skills.md`) and, for anything agent shaped, a fresh read of Anthropic's guidance; settle the ownership and orchestration forks with him one at a time, then hand the build to a ticket; a build lands inside the session only on Forni's explicit call, as on 2026-09-23.

**Why:** 2026-08-13. The sharpener agent's first version was authored minutes after the pick with no plan: the skill ended up orchestrating the agent ("Step 1: dispatch the sharpener") when Forni wanted the agent to run the method, and the scan was delegated to three scouts when one context held it fine. Forni: "This feels like we didn't really think about this very hard and didn't really come up with a plan." The whole build was redone through plan mode the same session.

**How to apply:** The plan is written at the product level: what the thing becomes and what the session delivers, not a line by line implementation. On 2026-09-23 the first plan draft went line by line and Forni sent it back: "really what I want to know is, at a high level, what we're doing." A structural move that cannot afford a planning pass is not session sized, so ticket it instead.

## Routines Are Not a Vault Grade L7 Primitive

Anthropic's cloud Routines run in environments with no secrets store, and the docs explicitly warn against placing credentials there (env vars are plaintext). A Routine can only carry credential free work, so any background move that draws from the vault cannot ship as one.

**Why:** 2026-08-13 afternoon session. The Sunday training retro spike disqualified Routines inside the research pass: the retro needs Strava reads and a Resend send, both vault credentials. Forni rejected shipping a credential poor partial as "punting the problem" and redirected to headless cloud runs with full vault access. Runtime picked: GCP Cloud Run Jobs fired by Cloud Scheduler with secrets injected natively from Secret Manager; GitHub Actions cron verified as the supported alternate, with subscription token auth official for both.

**How to apply:** When a move proposes cloud scheduled background work, ask first what credentials it draws. Credential free, a Routine is the smallest rep. Anything touching the vault routes through Cloud Run Jobs plus Cloud Scheduler with native Secret Manager injection (pattern home: ATE-471, The Sunday Retro Runner). And a spike that surfaces a disqualifier is a pass, not a failure: name the disqualifier, pick the runtime that meets the real want, and do not ship the degraded version just to log a live artifact.

## Every Session Cuts

Reduction of the always loaded context is a standing phase of every sharpen run (Phase 4, Cut), not a grooming flag that waits for the monthly pass. One bounded cut per session, measured, locked in by the ratchet, anchor or not.

**Why:** 2026-08-27. The board proposed unloading homebase's CLAUDE.md from every session; Forni corrected the premise (the `~/CLAUDE.md` link is the design, homebase is the config store loaded into Eudy on purpose) and set the direction instead: "If we can slim down and go through and reduce, I think that is great. We should definitely have that reduction stage as a part of every sharpened saws run." The first cut took that file from 332 lines to 88 by moving depth into path scoped rules. On 2026-09-16 socrates found the phase text still gated the cut on the 200 line anchor while this rule said every session, and three entries had logged "no cut owed" past a named duplicate; the phase text was rewritten 2026-09-23 so the two agree.

**How to apply:** The sharpener's Load line always names the best single cut; the main session takes it at Cut unless Ground found nothing bounded. The anchor decides whether a path scoped rule or tool doc move is due; it never excuses a session from the cut. Never turn the cut into a restructure; that is `assist:groom-context`.

## The Homebase Link Is the Design, Not a Placement Failure

`~/CLAUDE.md` is a deliberate symlink to homebase's CLAUDE.md (`deploy-table.sh`, `link|CLAUDE.md`). Homebase is the config store, public and shared across machines, and its CLAUDE.md is meant to load into every session under `$HOME`, Eudy included. Never propose its exclusion or unlinking; the lever on that file is reduction in place.

**Why:** 2026-08-27. The board's top row proposed a `claudeMdExcludes` entry for `~/CLAUDE.md` on the strength of a scout finding that called the link a placement failure. Forni corrected the premise before the pick: the link is intentional, so the move became slimming the file (332 to 88 lines) and moving depth into path scoped rules.

**How to apply:** When a scout or the scan names an existing mechanism as a mistake, read the deploy table entry, the doc, or the commit that created it before proposing its removal. A mechanism with recorded intent gets a reduction row, not a removal row. The always loaded files are reduced, never excluded; exclusion is reserved for a genuine double load (the repo path copy of `.claude/CLAUDE.md` in a homebase session).

## Enter the Worktree After the Sharpener Returns

The sharpener runs on Bash, and once the main session has entered a worktree (EnterWorktree) the harness's worktree isolation refuses Bash calls that reach outside it, subagents included: `git -C` against another repo, the Linear CLI's wrappers, gcloud reads, greps over paths beyond the worktree. This is Claude Code's session isolation, not the tracked worktree gate hook, which denies only mutating git on a primary checkout. Dispatch the sharpener from the primary checkout, hold the worktree cut until its report is back, then cut with `git worktree add` and edit by absolute path.

**Why:** 2026-08-27 afternoon. The sharpener was dispatched first and the main session cut the Eudy worktree while it scanned; from that moment the isolation refused its git log, Linear, and grep calls, so it scanned read only, reported ATE-471 as Todo (it was In Progress) and missed the outreacher routine that had gone live the day before. Both reached the board as facts and had to be corrected during Implement.

**How to apply:** Step 4 of Before Every Invocation happens at the top of Close, never before the sharpener returns. A session that edits two repos adds both worktrees with `git worktree add` and never enters either, so gcloud, Linear, and both repos stay reachable. A report built read only should say so in its Signals.

## Resume Before Redispatch After an Overload

When a scout or the sharpener dies on a server side error (a 529, a dropped connection) or is forced out before its scouts return, resume the same agent by id rather than dispatching a fresh one, and give a scout exactly one retry before reporting without it and naming the gap.

**Why:** 2026-09-03. Two server 529s killed the sharpener mid scan. Resumed by id each time, it kept its reads and its board came back complete on the third resume; socrates, redispatched fresh after its own 529, spent the same tokens again and never returned. On 2026-09-23 the sharpener was forced out with both scouts still running; socrates reported to the main session on its own, and claude-code-guide never did until redispatched once.

**How to apply:** A dead agent's id is in the failure notice; `SendMessage` to it first. If the resume also fails, one fresh dispatch, then stop. A report without a scout says so in that scout's paragraph; the log's Next line carries the miss so the next Ground rebriefs the same question.

## Skill Doctor Runs Headless

`/skill-doctor` is a REPL command, but `claude -p "/skill-doctor" --output-format text` returns the same table (skill, source, context tokens, seven day tokens, uses, last used) in about a minute, so the Groom phase can run it from the session rather than asking Forni to paste.

**Why:** 2026-09-23, the first Groom. The table showed the retired `job-apply` skill still loaded, `chatroom` registered twice, `handle-pr` (Gemini feedback, dead since 2026-07-17) still present, and `sdlc:groom-issues` unused since the groomer agent took its job.

**How to apply:** Run it at Groom, read the never used rows against what replaced them, and propose the turn offs; a skill is turned off only on Forni's yes.
