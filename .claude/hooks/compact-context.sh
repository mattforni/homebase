#!/usr/bin/env bash
# Compact context: after every compaction, put the live state back in front of
# the session so it picks up where it was instead of re deriving it from the
# summary. SessionStart with matcher "compact"; plain stdout is added to the
# fresh context. Fails OPEN: any error prints what it has and exits 0.
set -uo pipefail
unset CDPATH

input=$(cat)
cwd=$(jq -r '.cwd // empty' <<<"$input" 2>/dev/null)
[[ -z "$cwd" || ! -d "$cwd" ]] && cwd=$PWD

echo "Context restored after compaction ($(date '+%Y-%m-%d %H:%M %Z')):"

if root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null); then
  branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null)
  kind="primary checkout"
  [[ -f "$root/.git" ]] && kind="worktree"
  dirty=$(git -C "$cwd" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  echo "- Repo: $root ($kind), branch $branch, $dirty uncommitted paths"
  if [[ "$branch" != "main" && "$branch" != "HEAD" ]] && command -v gh >/dev/null 2>&1; then
    prs=$(gh pr list --head "$branch" --state open --json number,title,url \
      --jq '.[] | "  #\(.number) \(.title) (\(.url))"' 2>/dev/null)
    [[ -n "$prs" ]] && { echo "- Open PRs on this branch:"; echo "$prs"; }
  fi
  worktrees=$(git -C "$cwd" worktree list 2>/dev/null | grep -v "^$root " | sed 's/^/  /')
  [[ -n "$worktrees" ]] && { echo "- Other worktrees of this repo:"; echo "$worktrees"; }
else
  echo "- Directory: $cwd (not a git repo)"
fi

plan=$(ls -t "$HOME/.claude/plans"/*.md 2>/dev/null | head -1)
if [[ -n "$plan" ]]; then
  title=$(grep -m1 '^# ' "$plan" | sed 's/^# //')
  echo "- Newest plan file: $plan${title:+ ($title)}"
fi

echo "- The compact instructions in GC name what the summary kept; verify a hold or a wait time before repeating it."
exit 0
