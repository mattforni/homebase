# Code Review

The one place the review rules live. The lander agent, the `sdlc:land` skill, the merge gate hook, and every CLAUDE.md Code Review section point here and restate nothing. The mechanism is `~/bin/review/` in homebase; the account mechanics of each vendor live in `~/Eudaimonia/Admin/Tools/<vendor>.md`. Adopted 2026-10-07 (ATE-583), replacing a gate that was restated in nine files and capped at three reviews an hour.

## When a Review Runs

Every pull request that ships code gets a blocking review before it merges, and again after any push, because a review of a stale SHA gates nothing. Code means anything that runs or configures: scripts, hooks, runners, skills and agent definitions, plugin manifests, site and app source, templates, the UI package, artifact pages. The artifact repos, atelic.me, and pinole-app are in, since they go out into the real world.

What skips review is what already lands direct to main by each repo's landing heuristic: prose, a `.gitignore` change, brand assets, dated snapshots. That heuristic lives in the repo's CLAUDE.md and does not change here.

## The Reviewers

`review/run` asks every reviewer it has at once and prints one stream. The reviewers:

- **claude**, the gate. Claude Code's built in `/code-review` at high effort, run headless inside the worktree with read only git tools and a findings schema. It is uncapped, bills against the Max plan already paid for, and returns in a minute or two.
- **coderabbit**, evidence. The CodeRabbit CLI on the Free plan, run only when `coderabbit usage` shows a slot free this hour and the diff is under 150 files. It never waits and never retries: a rejected attempt still spends a slot. Account mechanics and gotchas: `~/Eudaimonia/Admin/Tools/coderabbit.md`.
- **codex**, planned. The second model family, since a reviewer from the family that wrote the code catches less (about ten points less in the one study that measured it). It reports itself absent until the CLI and a plan exist; which plan is Forni's call from his Usage page, and it will never be pay per review.

Ultrareview (`/code-review ultra`, `claude ultrareview`) is Forni's to launch by hand on a change that warrants it; it is billed separately and never dispatched from a lander or a script.

Anthropic reads every repo by construction, since Claude writes the code. Any other reviewer touching a client repo is a disclosure question under section 10 of the services agreement, not a technical one. CodeRabbit on client site repos was Forni's call of 2026-08-29 and stands; Codex waits for the same call.

## Running It

```bash
~/bin/review/run <worktree> --effort high        # Bash timeout 600000
```

It changes into the worktree itself and reports the directory and HEAD in a leading `review_context` line, so the call carries no `cd`. Flags: `--base <ref>` (default the remote's default branch), `--reviewers claude,coderabbit,codex`, `--effort low|medium|high|max`, `--max-findings N`, `--timeout <seconds>` (default 540, so it always returns inside the Bash call).

## Reading the Stream

One JSON object per line.

- `review_context`: `workingDirectory`, `repo`, `sha`, `base`, `files`, `reviewers`, `note` (a failed fetch is named here).
- `finding`: `reviewer`, `severity` (critical, major, minor, info), `fileName`, `line`, `summary`, `failure_scenario`.
- `complete`, one per reviewer: `reviewer`, `ran`, `reason`, `findings`, `sha`, `seconds`, `files`.

**The gate is the claude `complete` line with `ran: true`.** The exit code says the same thing (0 only then) but read the line. Other reviewers' lines are evidence: triage their findings when they ran, and never wait, hold, or retry for one that reports `ran: false`.

A claude line with `ran: false` means nothing was reviewed, not that nothing was found. Retry once after sixty seconds. If it fails again, bail to Forni with the `reason`; a usage limit names its reset, which is reported as a clock time in the machine's zone, never a duration. There is no carve out for small or prose heavy PRs: an uncapped reviewer leaves no honest reason to merge unreviewed.

## Triage

Read the actual code before trusting any finding; reviewers misread control flow, the gate included. The blocking threshold is **major and above**: a run is clean when no such finding remains unaddressed. Fix genuine issues, batch a round's fixes into one commit, push, and run the review again against the new HEAD. Decline false positives and style only churn with a reason in the landing report; when the finding came from a bot visible on the PR, reply there so the trail shows it was considered. Converge: never chase a moving target past two cycles without reporting in. Before merging, compare the PR's current head to the `sha` in the claude `complete` line; if they differ, review again.

## The Scorecard

Every `complete` line appends a row to `$HOME/.local/state/review/scorecard.tsv` (outside git, because landers write it and nothing on a primary checkout is edited). At merge, record the triage:

```bash
~/bin/review/landed <owner/repo> <pr> <reviewed sha> --fixed claude:2,coderabbit:1 --declined claude:1 --held-min 9
~/bin/review/scorecard --since 7d
```

The scorecard is how a reviewer earns or loses its place: findings per run, how many were fixed against declined, and minutes held. Read it before adding, dropping, or paying for a reviewer.
