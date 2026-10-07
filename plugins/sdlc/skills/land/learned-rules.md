# SDLC Land: Learned Rules

Session-specific gotchas and decisions captured from real land cycles. These override the generic guidance in SKILL.md when they conflict.

Read this file before each land. Add to it after.

## Format

Each rule states the rule, the reason, and how to apply it.

## Rules

### The Gate Is `review/run`, Run Locally on the Branch

`~/bin/review/run <worktree> --effort high`, run against the branch's current HEAD, is the review gate before any merge, on every repo. The rules (which reviewer gates, how the stream reads, the triage threshold, the scorecard) live in this plugin's `reference/code-review.md` and nowhere else. Any PR bot is a fallback on public repos and nothing at all on private ones. Never hold a merge waiting for it.

**Why:** On a private repo the free CodeRabbit plan posts a walkthrough comment and never a review object, so a loop that polls for a review polls forever and a gate built on it reads green on nothing. Across `mattforni/pinole-app` PRs 69, 71, 72, and 73 the `reviews` array was empty every time; pinole-app #73 sat 39 minutes past green CI on exactly this, and a local review of the same diff took about two minutes and found a real bug the PR bot had not (adopted 2026-08-29). The local gate was then the CodeRabbit CLI, capped at three reviews an hour and shared across every session, which queued landers; on 2026-10-07 (ATE-583) the gate became `review/run`, whose claude reviewer is uncapped, with CodeRabbit kept as evidence when a slot is free.

**How to apply:** Run `review/run` in Step 2 before you look at anything else, and again after every push, since a review of a stale SHA gates nothing. Read the claude `complete` line, not the exit code alone. On a public repo, where the free Open Source plan reviews properly, read whatever bot findings have already arrived and triage them like any others, but merge on your own `review/run` plus CI regardless.

### Reply on an Inline Comment When Declining a Bot Re-Raise, Don't Merge Silently Through It

When the PR bot on a public repo re-raises an inline comment after it has already been addressed, post a brief reply before merging. A reply that says "Re-raise: already addressed in <sha>" closes the loop in the PR's audit trail. Silent declines leave the PR looking like the concern went unanswered, and a future reviewer cannot tell the difference between "ignored" and "considered and declined."

**Why:** Bots persist the original inline-comment IDs across review cycles, so the same item shows up again on the new SHA even though the code is fixed. Surfaced on ATE-367 app PR #36 (2026-05-25): two of three items on the second cycle were already-addressed re-raises. Replying to each kept the conversation honest.

**How to apply:** During Step 4, when triaging a re-raise or any genuine decline where you disagree, post:

```bash
gh api -X POST repos/<owner>/<repo>/pulls/<PR>/comments/<comment_id>/replies \
  -f body="Re-raise: already addressed in <sha>."
```

Cost is one reply per declined comment. Apply it for genuine declines too, explaining *why* you are declining rather than just that you are. Findings that came from your own CLI run are private to you, so they need no reply; they need a line in your summary.

### Never Read a Green Check Suite as Evidence That a Review Happened

CodeRabbit posts a commit status and a check suite whether or not it produced a review, and it posts a passing one during a rate limit cooldown as well. A status colour therefore says nothing about whether anyone read the diff.

**Why:** This is the failure that made a bot shaped gate feel safe while gating on nothing, and it is why the gate is the reviewer's own findings output rather than any signal GitHub renders.

**How to apply:** Judge the gate on the `review/run` stream against the current HEAD and on CI's own real checks. Treat every bot signal as informational.

### Merge on `review/run` Plus CI, Regardless of Change Size

Once `review/run` has run clean on the current HEAD and CI is green, merge. There is no separate wait to skip for a doc-only change and none to sit through for a code change, because the gate costs about a minute and is never capped.

**Why:** The old rule carved doc-only and follow-up cycles out of the bot poll because waiting was pure overhead with no signal value, which Forni called out twice in one session (2026-05-25) with CI green and merge_state CLEAN. The carve out existed to route around bot latency. A local review removed the latency, and an uncapped one removed the last reason to merge anything unreviewed, so the review runs on everything, which is the stronger position.

**How to apply:** Run `review/run` on every land. Do not wait for anything else. Kill the CI Monitor as soon as it reports READY rather than waiting a window out of habit.

### Branch Parity Checks Compare Against the Merge Base, Not Bare Main

After a squash merge, `git diff origin/main <branch>` shows phantom differences whenever main has moved past the branch.

**Why:** The squash rewrites the change as a new commit on main, so the branch's own commits are no longer ancestors and a plain diff reads as unmerged work.

**How to apply:** Verify that the PR merged your exact HEAD SHA rather than diffing against main.

### Gemini Code Assist (Consumer App) Was Sunset 2026-07-17

Historical Gemini reviews sitting in a repo's closed PRs do not mean a live bot. Do not build a wait around one, and do not post `/gemini review`.
