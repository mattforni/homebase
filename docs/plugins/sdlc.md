# sdlc

Software development lifecycle skills for planning, designing, implementing, reviewing, and completing work.

## Overview

This plugin provides a complete workflow for managing the software development lifecycle with Claude Code. Each skill maps to a phase of development, creating a consistent and repeatable process.

## Skills

| Skill | Phase | Description |
|-------|-------|-------------|
| `/sdlc:plan` | Plan | Refine requirements on a Linear ticket through Socratic dialogue |
| `/sdlc:design` | Design | Start work on an issue with branch setup and implementation design |
| `/sdlc:review` | Review | Create PR and request code review |
| `/sdlc:land` | Land | Drive the back half autonomously: open PR, iterate with bot reviewer, merge, clean up |

## Workflow

The typical flow is:

```text
/sdlc:plan <issue-id>     # Refine requirements, build out ticket
    ↓
/sdlc:design <issue-id>   # Create branch, explore codebase, design approach
    ↓
[implement features]      # Write code
    ↓
/sdlc:land                # Open PR, iterate with bot, merge, clean up
```

`sdlc:land` is the default next step after implementation. It wraps `sdlc:review` → CLI review → poll → (address findings)* → merge → clean up and bails to the user on anything ambiguous (human review, hard CI failure, merge conflict, time budget exceeded).

## Installation

```bash
# Add the marketplace
claude plugin marketplace add mattforni/homebase

# Install the plugin
claude plugin install sdlc@skillset
```

> **Migrating from `mattforni/skillset`?** The `skillset` marketplace moved to `mattforni/homebase`. Remove the old source first: `claude plugin marketplace remove skillset`, then follow the steps above.

## Requirements

- **Git** for version control
- **GitHub CLI** (`gh`) for PR operations
- **`~/bin/review/run`** (homebase) for the review gate used by land. It runs Claude Code's built in `/code-review` headless on the subscription, plus the CodeRabbit CLI when a slot is free and Codex when installed, and prints one findings stream. The rules live in the plugin's [reference/code-review.md](../../plugins/sdlc/reference/code-review.md); vendor mechanics in `~/Eudaimonia/Admin/Tools/<vendor>.md`.
- **Linear CLI** (`linear`) for Linear integration (optional, used by plan and design). Install via `brew install schpet/tap/linear`.

## Skill Details

### /sdlc:plan

Refines requirements on a Linear ticket through Socratic dialogue:

1. Fetches issue details from Linear
2. Reads the current title and description
3. Asks probing questions one at a time to surface requirements, context, and options
4. Iteratively updates the Linear ticket body to build out the plan template (Overview, Requirements, Options, Recommendation, Open Questions)
5. Continues until open questions are resolved and the ticket is ready for design

The plan lives on the Linear ticket. No local files are created.

**Usage:** `/sdlc:plan ATE-123`

### /sdlc:design

Starts work on an issue:

1. Fetches issue details from Linear (if available)
2. Prompts user to handle uncommitted changes (stash, commit, or abort)
3. Sets up work environment based on branching strat:
   - **worktree**: uses Claude Code's native worktree tool to create an isolated worktree under `.claude/worktrees/<branch-name>/` with a feature branch (default)
   - **branch**: checks out a new feature branch in the current directory
4. Enters plan mode for implementation design
5. Posts a design summary comment on the Linear ticket after approval
6. Updates Linear status to "In Progress" after approval

**Usage:** `/sdlc:design ATE-123` or `/sdlc:design feature-name`

### /sdlc:review

Creates a PR and requests review:

1. Detects and removes dead code
2. Creates commit with proper attribution
3. Pushes and creates PR
4. Requests a PR bot review with the configured trigger. This is the optional public repo fallback, not the gate: the gate is `review/run`, run by land.

**Usage:** `/sdlc:review`

### /sdlc:land

Drives the back half of SDLC autonomously, from "ready for review" through "merged and cleaned up":

1. **Identifies PR or opens one** (calls `/sdlc:review` if no PR exists for the current branch)
2. **Reviews the branch** with `~/bin/review/run <worktree> --effort high`, run locally against the current HEAD. This is the gate; the rules are the plugin's `reference/code-review.md`.
3. **Polls** for state changes via Monitor: CI settled, CI failure, human review, or timeout
4. **Decides** per event:
   - Review clean, or only advisory findings → merges
   - Actionable findings → fixes them in place and pushes, then re-runs the CLI review on the new HEAD
   - CI failure self-introduced → fixes in place and pushes
   - CI failure not self-introduced, human review, merge conflict, or timeout → bails to the user with state summary
5. **Merges** (squash, with branch delete), then removes the local worktree and branch

The agent (not GitHub) judges when feedback is addressed. `mergeStateStatus: CLEAN` only reflects branch protection and required checks, not whether anyone read the diff. Findings are not implemented blindly: when the agent disagrees it declines with reasoning and merges through.

The loop never waits on any PR bot (adopted 2026-08-29). On a private repo the free CodeRabbit plan posts a walkthrough and no review object at all, so waiting on it gates on nothing; on a public repo the free Open Source plan reviews properly, making the bot a genuine second look but still a fallback rather than a blocker. The gate, the reviewers, and the triage rules live in the plugin's [reference/code-review.md](../../plugins/sdlc/reference/code-review.md).

**Usage:** `/sdlc:land` or `/sdlc:land 248`

## Configuration

`land` and `groom-issues` use `disable-model-invocation: true`, meaning they are only triggered by explicit user invocation (not automatically by Claude).

### Branching Strat

Controls how `/sdlc:design` sets up your working environment.

| Strat | Behavior |
|-------|----------|
| `worktree` (default) | Uses Claude Code's native worktree tool to create an isolated worktree under `.claude/worktrees/<branch-name>/` per task. Multiple tasks run in parallel without stashing or switching. |
| `branch` | Traditional checkout. Switches the current directory to a new branch. One task at a time. |

**Git config (recommended):**

```bash
# Set branching strat (default: worktree)
git config sdlc.branch-strat worktree
```

**Environment variable:**

```bash
export SDLC_BRANCH_STRAT="worktree"
```

Worktree mode places worktrees under `.claude/worktrees/`, which is managed by Claude Code. No `.gitignore` changes are required.

### Review Command

The review skill uses a configurable review command. Configure via:

**Git config (recommended):**

```bash
git config sdlc.review-command "/gemini review"
```

**Environment variable:**

```bash
export SDLC_REVIEW_COMMAND="/gemini review"
```

**Default:** `/gemini review`

### Linear Integration

The plan and design skills optionally integrate with Linear via the Linear CLI. If the CLI is installed and the issue ID looks like a Linear issue (e.g., `ATE-123`), the skills will:

- Fetch issue details for context
- Update issue status ("In Progress")
- Post design summary comments

Install via `brew install schpet/tap/linear` and authenticate with `linear auth login`.

Without the Linear CLI, the design skill works with any branch name. The plan skill requires it.
