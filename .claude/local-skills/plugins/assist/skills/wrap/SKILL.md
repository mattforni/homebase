---
name: wrap
description: Session wrap. Don't lose the thread, clean everything up, don't leave loose ends in your head. Scans every git repo touched this session for uncommitted or unpushed state, surfaces external commitments (pending replies, calendar holds, contract deadlines) from the recent conversation, prompts for codification of durable learnings, logs each loose end the user triages to Todoist (today if pressing, next Sunday otherwise), summarizes the session, and closes with a compaction ready line. Run it yourself, unprompted, the moment the session reaches its terminal state (the work landed, tickets closed, no question open), with a one line heads up rather than an offer. Also use it whenever the user says "wrap", "wrap up", "wrap the session", "wrap this up", "wrapping up", "clean up before I exit", "signing off", "done for the day", or invokes /assist:wrap. Pairs with /assist:mise as the bookend. Mise opens the kitchen for service. Wrap closes it cleanly after.
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - AskUserQuestion
  - Skill
---

# Wrap

End of session bookend. Don't lose the thread. Don't leave loose ends in your head.

The skill exists because the user was running the same end-of-session sweep manually: check git and PR state, scan recent work for unhandled commitments, decide what to codify, decide what to log to Todoist, exit. That is a routine. Routines should be automations.

## When to Run It

Claude runs wrap, not Forni. The terminal state of a session is visible from inside it: the work landed, every ticket it touched is closed or commented, no PR authored this session is open, no question is waiting on him. At that point wrap is the next step, so take it, with a one line heads up ("Wrapping up now unless there is more") rather than an offer he has to accept. Ending a session with "run wrap when you are ready" hands him a chore the skill exists to remove (Forni, 2026-09-06). The phrase triggers in this skill's description still apply when he says the word first, and they are the only trigger: the UserPromptSubmit hook that used to grep every prompt for a signoff phrase was retired 2026-09-09 after it fired on "exit code 1" inside a background task notice and again on the word "exit" mid conversation. A wrap that starts from a phrase is this skill's call, made on the whole message, never a regex's.

## Before Every Invocation

1. Read this skill's local [learned-rules.md](learned-rules.md) for prior corrections.
2. Read the plugin-wide [../../learned-rules.md](../../learned-rules.md) for cross-skill corrections that also apply.

## Workflow

### Step 1: Build the Repo List

The repos to scan are the repos touched in this session, no more and no less. Do not maintain a fixed allowlist. Walk the conversation and any tool history for absolute paths used in Read, Edit, Write, or Bash calls. Resolve each path back to its containing git repo (`git -C <path> rev-parse --show-toplevel`). Deduplicate.

If the inference produces nothing (rare), fall back to the current working directory's repo only.

### Step 2: Git, PR, and Ticket State

For each repo in the list:

```bash
git -C "$REPO" status --porcelain
git -C "$REPO" rev-parse --abbrev-ref HEAD

# Unpushed commits, only when an upstream is configured. A new local
# branch has no @{u}; running the log against it would error.
if git -C "$REPO" rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
  git -C "$REPO" log @{u}..HEAD --oneline
else
  echo "NO_UPSTREAM"
fi

# Open PRs, only when the repo has a GitHub remote. Derive the
# owner/name slug from gh itself rather than threading $OWNER through.
REPO_SLUG=$(gh -R "$REPO" repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
if [ -n "$REPO_SLUG" ]; then
  gh --repo "$REPO_SLUG" pr list --author @me --state open --json number,title,headRefName,reviewDecision
fi
```

Categorize per repo:

- **Clean.** Working tree clean, in sync with origin, no open PRs needing the user. Nothing to do.
- **Uncommitted changes.** Surface and ask: commit (via `/sdlc:checkpoint`), stash, or discard.
- **Unpushed commits.** Push, or leave intentionally with a note.
- **Open PR awaiting the user.** Blocks exit (see Step 9). Surface review comments and chain to `/sdlc:iterate`.
- **Open PR awaiting reviewer.** Blocks exit (see Step 9). Watch for review to land, then chain to `/sdlc:iterate` or `/sdlc:complete` as appropriate.
- **Merged PR with the branch still local.** Chain to `/sdlc:complete` via the Skill tool.
- **Leftover worktree from a merged branch.** Destroy it: `git worktree remove <path>` then `git branch -D <branch>`. Do this for every session worktree whose PR has merged. The one exception is the current session's own working directory and any `locked` worktree; leave those, they get cleaned when the session ends.

When the session already ran `/sdlc:complete`, this step is usually fast and returns clean for the main repo.

#### Close the tickets whose work is done

**A merged PR whose ticket is still open is not finished work, it is finished code.** Do not wait to be asked; a ticket left in Todo or In Progress after its PR merged is the exact loose end wrap exists to catch, and Forni should never have to remind anyone to move it.

Identify every tracker item the session touched: an issue named in the session, an issue whose `gitBranchName` matches a branch worked on, or one moved to In Progress during the session. For each:

- **Work complete and merged.** Post a closing comment, then move the issue to Done. The comment is a record, not a receipt: what shipped and where (PR links), what was verified on the machine rather than only in a test harness, anything that changed from the ticket's stated definition of done and why, and anything deliberately deferred so it is not silently lost.
- **Work partially done.** Leave it open, comment with what landed and what remains, and surface it in the Step 8 summary. Do not close a ticket because the session ended.
- **Work abandoned or superseded.** Ask before cancelling. That is a judgment call, not a cleanup.

Follow the repo's tracker split: engineering and client work is a Linear issue, personal and operational work is Todoist (see [learned-rules.md](learned-rules.md)). Ticket hygiene conventions, including body-is-the-spec and comments-are-the-timeline, live in Eudy's root `CLAUDE.md`.

### Step 3: Surface External Commitments

Walk the recent session conversation for items that imply someone is waiting on the user, or the user is waiting on someone:

- Emails sent today (ball is in the counterparty's court — flag for tracking)
- Calendar holds placed but unconfirmed
- Tasks the user said they would do "today" or "this morning"
- Contract deadlines or external due dates touched in the session
- Drafts saved but not sent

Categorize each in three tiers:

- ⚠️ **Today.** Action required before end of day. The user is the blocker.
- 🟡 **Sliding.** Soft target, no external party blocked. The user's own commitment to themselves.
- ✅ **Awaiting counterparty.** Tracked, no action.

### Step 4: Dedupe Against Todoist

Before triaging anything, query Todoist for tasks that already cover the candidate loose ends. Surfacing items that are already scheduled is noise and forces the user to triage the same thing twice.

```bash
# 8 days covers today through next Sunday on a weekday wrap,
# and upcoming already returns overdue tasks, so one call is the whole set
td upcoming 8 --json
```

Match each candidate against scheduled tasks by content keyword (lender name, attorney name, deadline phrase, task type). For each match:

- **On track (due today or in the future):** drop from the triage list entirely; the task is already covered
- **Overdue:** surface separately under a 🔴 **Overdue, already in Todoist** tier so the user can reschedule rather than treat them as new

Only the unmatched ⚠️ and 🟡 items proceed to Step 5 triage.

### Step 5: Triage Each Loose End

For each ⚠️ and 🟡 item, ask the user via AskUserQuestion with these options:

1. **Do now.** Handle in this session before exiting.
2. **Todoist today.** Log a task due today with duration 30m.
3. **Todoist Sunday.** Log a task due next Sunday for the Sunday planning session, duration 30m.
4. **Drop.** Item is no longer relevant. Acknowledge and move on.

One question per item. Bulk decisions hide bad triage. Stick to ⚠️ and 🟡; ✅ items are tracking-only and don't need triage.

### Step 6: Codify Check

Walk the session for codifiable durables:

- New rules, preferences, or gotchas surfaced
- Patterns or conventions that became clear
- Workflow improvements worth saving

If candidates exist, ask the user whether to invoke `/assist:codify-context` via the Skill tool for each candidate. If nothing is codifiable, say so explicitly and skip. Most sessions skip. Forcing codify creates documentation bloat.

### Step 7: Todoist Logging

For each loose end the user triaged to "today" or "Sunday", create a Todoist task:

- **Today:** `td task add "<title>" --due today --duration 30m --project "<project>" [--section "<section>"]`
- **Sunday:** `td task add "<title>" --due "next Sunday" --duration 30m --project "<project>" [--section "<section>"]`

For each 🔴 overdue item the user triaged to reschedule, use `td task reschedule <ref> <date>` rather than creating a new task, and never `td task update --due`. The dedicated subcommand preserves recurrence; setting a due date through update replaces the whole due string and destroys a recurring pattern.

Task title conventions from global memory:

- Emoji prefix indicating task type (📧 email, 📞 call, 📝 form/doc, 🏠 home buying, 💼 vocation, etc.)
- Short title with a link to the source in Markdown format where available
- No parenthetical clarification
- Details go in a comment on the task, not in the description field

Use the project and section that best matches the loose-end's domain. Infer from context. Home buying tasks go under the home buying project; vocation tasks under 🛠️ Craft / 💼 Vocation; etc. Ask if the right project is genuinely ambiguous; otherwise infer and proceed.

### Step 8: Session Summary

One paragraph. Three beats:

1. What was the work? (one phrase)
2. What artifacts shipped? (PRs merged, files filed, decisions made, drafts sent)
3. What is queued for next time? (loose ends now in Todoist)

This is the breadcrumb for re-entry. The user's future self picks the thread back up from this paragraph, and `/compact` (Step 9) preserves it, so write it to stand alone.

The one pager's H1 names the session: a short Title Case noun phrase, distinctive enough to pick out of a list of many, leading with the ticket key when one governed the session (`ATE-527: Recipe Components and Serving Weights`, `Week 36 Outreach Roster`, `Jeff Tax Package`). Never a generic label ("Session", "Cleanup"), never a summary sentence.

### Step 9: Hand Off

The session is ready to hand off only when every condition below holds:

- No uncommitted changes remain in any session-touched repo
- No unpushed commits remain, or any that do are intentional with a note
- **No PR the user authored this session is still open.** An open PR is not hand off state. Watch the PR through review (CodeRabbit, Gemini, human reviewers), chain to `/sdlc:iterate` when feedback lands, and to `/sdlc:complete` once merged.
- **No ticket whose work merged this session is still open.** Closed in Step 2. A ticket left open behind a merged PR is the loose end the user keeps having to point out.

When all conditions are met, the last line of the wrap is exactly this, on its own:

Compaction ready.

That line says the summary above is the breadcrumb `/compact` will carry (GC's compact instructions say what survives) and that nothing else is pending. Forni runs `/compact` himself. It is a built in command that only a user message can fire (hooks are read only, skills cannot chain them, verified 2026-09-06), so wrap never claims to have run it and never pastes it as a command block.

When a PR is still open, end instead with the current state of the PR and the next action being taken on it (waiting for review, addressing feedback, merging, etc.). Do not hand off.

## Why Each Step Matters

- **Session-touched repos, not a fixed allowlist.** The user works across many repos (Eudaimonia, homebase, skillset, zero repos, and ad-hoc clones). A fixed list either misses repos or scans noise. Inferring from session activity matches the actual blast radius.
- **Git scan first.** Highest-signal check. After `/sdlc:complete` this is usually fast and clean.
- **Three-tier categorization over flat list.** ⚠️/🟡/✅ separates "act now" from "track" from "ignore". A flat list of "follow-ups" is noise.
- **Dedupe against Todoist before triage.** The user already runs Todoist as the system of record for follow-ups. Surfacing tasks that are already scheduled there is noise and forces them to triage the same thing twice. The Step 4 query is the cheapest check available and removes the noisiest failure mode.
- **Triage one item at a time.** Bulk decisions hide bad triage. AskUserQuestion forces real choice per item.
- **Codify is opt-in, never mandatory.** Most sessions have no new durable rules. Prompt only when candidates exist; skip cleanly otherwise.
- **Todoist offload.** Anything not handled in-session goes to Todoist. Working memory should not carry loose ends across sessions. The Sunday default channels non-urgent items into the existing Sunday planning ritual.
- **Wrap runs itself; compaction is Forni's.** Claude can see the terminal state, so waiting to be told to wrap is a chore handed back. `/compact` cannot be fired by the model, so wrap ends by saying it is ready rather than pretending to run it or handing over a line to paste.
- **Open PRs block exit.** A PR sitting open after exit risks losing context for review-comment handling, drifts further from main, and breaks the rhythm of finishing what you start. Wrap is responsible for shepherding the PR through review and merge, not just opening it.
- **Closing the ticket is part of finishing, not a courtesy.** The tracker is how work is found again; a merged PR behind an open ticket makes the queue lie about what is left to do, and the ticket's closing comment is the only place the *why* survives once the branch is gone. Forni had been prompting for this at the end of sessions, which is the tell that it belonged in the routine rather than in his head. Added 2026-08-11.

## Output Shape

The wrap is a one pager Forni scans, not a log he reads: an H1 that is the session name, then H2 sections in this order, prose kept to a few sentences, tables where rows are what he scans, and a link on every artifact he might click through to (PRs, tickets, tasks, files). Shaped with him 2026-09-06 after the earlier text dump proved too much to read.

Rendering rules, because his renderer collapses markdown whitespace: a table that follows a paragraph gets a `&nbsp;` line before it, and a `&nbsp;` line after it when a paragraph follows; a table directly under a heading gets neither. Emoji states (✅, ❌) over words in state columns. Repos the session did not touch are not listed.

````markdown
# NEO Loan Lock

## TL;DR

Two or three sentences on what the session did, scannable. Then the repo table: one row per PR, and one row per touched repo that had no PR.

&nbsp;

| Repo | PR | Merged | Deployed |
| -- | -- | -- | -- |
| pinole-api | [#314](https://github.com/mattforni/pinole-api/pull/314) components and serving weight | ✅ | ✅ |
| homebase | [#234](https://github.com/mattforni/homebase/pull/234) wrap hand off | ✅ | n/a |

&nbsp;

One line on repo state: clean on main, anything unpushed, worktrees removed.

### Data

Optional H3 under the TL;DR, only when the session changed a data layer (a production repoint, a backfill, a compare). Say what moved and how it was verified.

## Outstanding

What is left open and why, in a few sentences: the deferrals, the blockers. Then the tracker table of anything new this session created, linked; "None" when nothing was.

&nbsp;

| Tracker | New item |
| -- | -- |
| Linear | [ATE-540](https://linear.app/atelic/issue/ATE-540) Curate the remaining per item weights |
| Todoist | None |

## Codified

### Docs

| Repo | File | What |
| -- | -- | -- |
| pinole-api | [CLAUDE.md](api/CLAUDE.md) | The component rule and the derived serving weight |

### Memories

- [Railway deploy old container window](/path/to/memory/railway-deploy-old-container-window.md)

## Close Out

| Tracker | Item | Done |
| -- | -- | -- |
| Linear | [ATE-527](https://linear.app/atelic/issue/ATE-527) Let a recipe be an ingredient of another recipe | ✅ |

Compaction ready.
````

The Outstanding and Close Out tables carry every tracker the session wrote to; a section whose content is genuinely empty still appears with "None", so the absence is a statement rather than an omission. The Data section is the one optional piece.

## Anti-patterns

- Do not scan systems beyond git/PRs and recent-session implications. Slack, every inbox folder, Todoist contents, calendar week ahead, none of those. Comprehensive scans create noise that obscures real loose ends.
- Do not log to Todoist without the user's explicit triage for that item. No automatic bulk-dump to Sunday.
- Do not wait to be asked to wrap once the terminal state is visible, and do not end a session by suggesting Forni run it.
- Do not claim to have compacted, and do not paste `/compact` or `/rename` as a command block. Close with the compaction ready line; Forni runs compact himself.
- Do not skip the summary even when there is "nothing to summarize." It is the re-entry breadcrumb.
- Do not emit the wrap as a plain text block or a flat list. It is the one pager above, with links.
- Do not force codify. If the session did not produce a durable rule, say so and move on.
- Do not maintain a fixed allowlist of repos. Repos to scan = repos touched in this session.
- Do not hand off while a PR the user authored this session is still open. Watch it through review and merge before the compaction ready line.
- Do not wait to be asked to close a ticket whose work merged. It is part of the routine, not a favour. Equally, do not close one whose work is only partly done just because the session is ending; leave it open and say what remains.

## Learned Rules

See [learned-rules.md](learned-rules.md).
