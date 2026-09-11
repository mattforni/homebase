# Learned Rules

## Branch Naming

Sharpen sessions are branched as `YYYY-MM-DD-sharpen-saws` in every repo touched by the session (currently Eudy and homebase). Date first so branches sort chronologically; same branch name across repos so a given session's work correlates at a glance. (Reversed from the earlier `sharpen-YYYY-MM-DD` form on 2026-07-23 at Forni's direction.)

**Why:** Forni wants a consistent way to find any sharpen session's work across both repos without hunting commit messages, with the date leading so listings sort by session.

**How to apply:** At the start of the implementation step of a sharpen session, cut a worktree on the branch in each touched repo (`git -C <repo> worktree add <path> -b YYYY-MM-DD-sharpen-saws`), per the work-in-worktrees rule. If the branch already exists (rerun or continuation), enter its existing worktree instead.

## CronCreate Is Not a Level 7 Primitive

`CronCreate` (and by extension the `/loop` and `/schedule` skills that wrap it) only fires while a Claude REPL is live and idle. `durable: true` persists the job across Claude restarts but still requires a live session at fire time. Auto expires after 7 days either way.

**Why:** Discovered during the 2026-04-23 sharpen session. Attempted to schedule `/assist:mise` for weekday mornings. CronCreate reported the job as session-only even with `durable: true` passed explicitly, and the underlying mechanic requires an open REPL. Net effect: zero background autonomy unless Forni happens to be at Claude when the cron fires.

**How to apply:** When proposing a "schedule X to run in the background" sharpen move, do not default to CronCreate. For true OS-level scheduling on macOS, the right primitive is launchd (plist in `~/Library/LaunchAgents/`) invoking `claude -p "<slash command>"`. That is usually plan sized, not session sized. CronCreate is still useful for in-session reminders ("nudge me in 20 minutes") but not for daily morning routines.

## Audit Existing Feedback Channels Before Scaling Background Agents

Before proposing a new headless routine, audit the feedback channels on existing ones. If notifications are the only path for success/failure, that is a gap and the next move should harden it, not add another agent.

**Why:** 2026-05-07 sharpen session. Proposed extending the headless pattern from one routine (mise) to a second (Monday `/assist:plan-week`). Forni redirected: "Before we move on to automation another routine, we first need to get better at the feedback and backpressure mechanisms for mise. Right now, it fails silently sometimes (because my notifications are silenced) and even when it succeeds, it tries to tell me some things, but they get cut off in the notification and when I click through, I get nothing else." macOS notifications are best effort and load-bear too much when used as the source of truth.

**How to apply:**

- For each live headless routine, ask: "If this fails silently, how would Forni find out?" If the answer is "macOS notification" alone, that is insufficient.
- The current robust pattern is per-run email via Resend with API key in Keychain, recipient in `~/.config/headless-report/recipient`, osascript demoted to a redundant fallback. See `homebase/.claude/references/headless-claude.md` "Email reporting via Resend" section.
- Apply this scrutiny in proportion to schedule frequency. A weekly routine that fails silently for a week is much worse than a daily one that fails silently once.
- Adding a second routine without robust feedback compounds the problem because each new agent multiplies the surface area of silent failure.

## Structural Moves Get Plan Mode Before Any File Is Written

When the chosen sharpen move creates or reshapes a durable surface (an agent, a skill, a hook, a workflow), enter plan mode and walk the design with Forni before authoring anything. Ground the design in the authoring conventions (`~/.claude/references/skills.md`) and, for anything agent shaped, a fresh read of Anthropic's guidance; settle the ownership and orchestration forks with him one at a time, then build.

**Why:** 2026-08-13. The sharpener agent's first version was authored minutes after the pick with no plan: the skill ended up orchestrating the agent ("Step 1: dispatch the sharpener") when Forni wanted the agent to run the method, and the scan was delegated to three scouts when one context held it fine. Forni: "This feels like we didn't really think about this very hard and didn't really come up with a plan." The whole build was redone through plan mode the same session.

**How to apply:** "Implement the chosen move" (Phase 5) is not license to skip planning; session sized refers to total effort, including the plan. A structural move that cannot afford a planning pass is not session sized, so split it instead.

## Routines Are Not a Vault Grade L7 Primitive

Anthropic's cloud Routines run in environments with no secrets store, and the docs explicitly warn against placing credentials there (env vars are plaintext). A Routine can only carry credential free work, so any background move that draws from the vault cannot ship as one.

**Why:** 2026-08-13 afternoon session. The Sunday training retro spike disqualified Routines inside the research pass: the retro needs Strava reads and a Resend send, both vault credentials. Forni rejected shipping a credential poor partial as "punting the problem" and redirected to headless cloud runs with full vault access. Runtime picked: GCP Cloud Run Jobs fired by Cloud Scheduler with secrets injected natively from Secret Manager; GitHub Actions cron verified as the supported alternate, with subscription token auth official for both.

**How to apply:** When a board row proposes cloud scheduled background work, ask first what credentials it draws. Credential free, a Routine is the smallest rep. Anything touching the vault routes through Cloud Run Jobs plus Cloud Scheduler with native Secret Manager injection (pattern home: ATE-471, The Sunday Retro Runner). And a spike that surfaces a disqualifier is a pass, not a failure: name the disqualifier, pick the runtime that meets the real want, and do not ship the degraded version just to log a live artifact.

## Every Session Reduces

Reduction of the always loaded context is a standing phase of every sharpen run (Phase 5, Reduce), not a grooming flag that waits for the monthly pass. One bounded cut per session, measured, locked in by the ratchet.

**Why:** 2026-08-27. The board proposed unloading homebase's CLAUDE.md from every session; Forni corrected the premise (the `~/CLAUDE.md` link is the design, homebase is the config store loaded into Eudy on purpose) and set the direction instead: "If we can slim down and go through and reduce, I think that is great. We should definitely have that reduction stage as a part of every sharpened saws run." The first cut took that file from 332 lines to 88 by moving depth into path scoped rules.

**How to apply:** The sharpener's Scan reports the four always on files with lines and bytes and names the best single cut. The main session makes exactly one cut before implementing the pick, prefers a path scoped rule for file specific depth and a tool doc for narrative, and lowers the matching cap in homebase's `bin/lint/context-size`. The Log entry carries the Load line so the trend is visible. Never turn the cut into a restructure; that is `assist:groom-context`.

## The Homebase Link Is the Design, Not a Placement Failure

`~/CLAUDE.md` is a deliberate symlink to homebase's CLAUDE.md (`deploy-table.sh`, `link|CLAUDE.md`). Homebase is the config store, public and shared across machines, and its CLAUDE.md is meant to load into every session under `$HOME`, Eudy included. Never board its exclusion or unlinking; the lever on that file is reduction in place.

**Why:** 2026-08-27. The board's top row proposed a `claudeMdExcludes` entry for `~/CLAUDE.md` on the strength of a scout finding that called the link a placement failure. Forni corrected the premise before the pick: the link is intentional, so the move became slimming the file (332 to 88 lines) and moving depth into path scoped rules.

**How to apply:** When a scout or the scan names an existing mechanism as a mistake, read the deploy table entry, the doc, or the commit that created it before boarding its removal. A mechanism with recorded intent gets a reduction row, not a removal row. The always loaded files are reduced, never excluded; exclusion is reserved for a genuine double load (the repo path copy of `.claude/CLAUDE.md` in a homebase session).

## Enter the Worktree After the Board Returns

The sharpener runs on Bash, and once the main session has entered a worktree (EnterWorktree) the harness's worktree isolation refuses Bash calls that reach outside it, subagents included: `git -C` against another repo, the Linear CLI's wrappers, greps over paths beyond the worktree. This is Claude Code's session isolation, not the tracked worktree gate hook, which denies only mutating git on a primary checkout. Dispatch the sharpener from the primary checkout, hold the worktree cut until its board is back, then cut and enter.

**Why:** 2026-08-27 afternoon. The sharpener was dispatched first and the main session cut the Eudy worktree while it scanned; from that moment the isolation refused its git log, Linear, and grep calls, so it scanned read only, reported ATE-471 as Todo (it was In Progress) and missed the outreacher routine that had gone live the day before. Both reached the board as facts and had to be corrected during Implement.

**How to apply:** Step 4 of Before Every Invocation ("cut its worktree branch") happens at the top of Implement, never before the sharpener returns. If the worktree is already entered when a scout must run, exit with keep for the dispatch and re enter by path afterwards. A board built read only should say so in its Signals, as this one did.

## Resume Before Redispatch After an Overload

When a scout or the sharpener dies on a server side error (a 529, a dropped connection), resume the same agent by id rather than dispatching a fresh one, and give a scout exactly one retry before boarding without it and naming the gap in its paragraph.

**Why:** 2026-09-03. Two server 529s killed the sharpener mid scan. Resumed by id each time, it kept its reads and its board came back complete on the third resume, once the interrupted session returned; socrates, redispatched fresh after its own 529, spent the same tokens again and never returned. The board was still complete because the gap was named instead of chased.

**How to apply:** A dead agent's id is in the failure notice; `SendMessage` to it first. If the resume also fails, one fresh dispatch, then stop. A board without a scout says so in that scout's paragraph and ranks on the evidence it has; the log's Scan notes carry the miss so the next Ground rebriefs the same question.

## A Set Focus Can Retire the Aged Row, Never Carry It

When the dispatch brief carries a focus that the count 2 row does not serve, the aging term still fires: the row ranks first on the board with its retirement reason written, and the session retires it in the log rather than carrying it a third time under the focus. Phase 1 (a focus narrows every pull) and Phase 3 (the aged row ranks first regardless) are not in conflict; the focus decides between taking the row and retiring it, never whether it appears.

**Why:** 2026-09-11. The `SubagentStop` gate on lander reached count 2 against a "something new" focus. socrates read the two phases as colliding; the resolution was to board it first, with the reason it was never grounded in a failure, and retire it. The count reset honestly and the focus was honored.

**How to apply:** The sharpener writes the retirement reason into row 1 when the focus and the aged row disagree, so the pick is a yes or no and never a carry.
