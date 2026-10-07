# Common Patterns

Shared procedures used across multiple SDLC skills. Referenced from individual SKILL.md files.

In all bash steps below, substitute placeholder names (like BASE_BRANCH, CURRENT_BRANCH, etc.) with the actual values you stored earlier. Each placeholder appears in ALL_CAPS. Run commands separately; do not chain with `&&` or use `$()`.

## Branch Verification

Determine the base (default) branch and the current branch:

```bash
../../scripts/get-base-branch.sh
```

Store the output as BASE_BRANCH.

```bash
git branch --show-current
```

Store the output as CURRENT_BRANCH.

## Commit and Push

Stage all changes:

```bash
git add -A
```

Analyze the staged changes to generate an appropriate commit message:

- Summarize the nature of changes (feature, fix, refactor, etc.)
- Focus on the "why" rather than the "what"
- Keep it concise (1-2 sentences)

If the user provided a message, use it as the commit message.

Use a HEREDOC to commit so multiline messages and special characters are handled cleanly:

```bash
git commit -m "$(cat <<'EOF'
<commit message here>

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

Push to remote:

```bash
git push -u origin HEAD
```

## Review Command Lookup

**The review gate is `review/run`, run locally on the branch, and it needs no configuration; the rules are [code-review.md](code-review.md).** This lookup feeds only the optional PR bot trigger, which is a fallback on public repos and is never waited on (2026-08-29).

Get the configured trigger comment:

```bash
../../scripts/get-review-command.sh
```

Store the output as REVIEW_CMD. This checks git config, then env var, then defaults to `/gemini review`.

## Branching Strat Lookup

Determine the configured branching strategy (used by `plan` to decide how to set up the work environment):

```bash
../../scripts/get-branch-strat.sh
```

Store the output as BRANCH_STRAT (`worktree` or `branch`).
