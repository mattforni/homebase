#!/usr/bin/env bash
# Memory strike: after a Write or Edit lands in a rule file, name every auto
# memory written today so the one the rule just promoted is flagged for the strike.
# PostToolUse on Write|Edit; reports through additionalContext, never blocks.
#
# Why a hook and not a rule: a correction is written to memory the moment it
# happens and the rule lands in a file minutes later, but the strike lived only
# in codify-context step 6, which most sessions never run. Four memories
# duplicating a rule landed in the fortnight to 2026-10-28 against a target of
# zero. Prose got dropped; a hook fires every time.
#
# Rule files: any CLAUDE.md, a .claude/rules or user-rules file, a
# learned-rules.md, a SKILL.md, a tool doc under Admin/Tools or Tools, and the
# output style. A write to a memory file itself is not a rule landing.
# Fails OPEN: any parse error or missing input exits 0 with no output.
set -uo pipefail

input=$(cat)
path=$(jq -r '.tool_input.file_path // empty' <<<"$input" 2>/dev/null)
[[ -z "$path" ]] && exit 0

case "$path" in
  */.claude/projects/*/memory/*) exit 0 ;;
esac

case "$path" in
  */CLAUDE.md|*/CLAUDE.local.md|*/.claude/rules/*.md|*/.claude/user-rules/*.md|\
  */learned-rules.md|*/SKILL.md|*/Admin/Tools/*.md|*/Tools/*.md|*/.claude/output-styles/*.md) ;;
  *) exit 0 ;;
esac

today=$(date +%F)
candidates=()
while IFS= read -r f; do
  [[ "$(basename "$f")" == "MEMORY.md" ]] && continue
  candidates+=("$f")
done < <(find "$HOME/.claude/projects" -path '*/memory/*.md' -newermt "$today" -type f 2>/dev/null | sort)

[[ ${#candidates[@]} -eq 0 ]] && exit 0

list=$(printf '%s, ' "${candidates[@]}"); list=${list%, }
jq -cn --arg p "$path" --arg l "$list" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:("Memory strike: a rule just landed in " + $p + ". Memory written today: " + $l + ". If the rule now states what one of them says, note that memory for the strike, to be deleted with its MEMORY.md line once this rule has landed (after the merge when it rides a PR, since a strike before then loses the learning if the PR dies); a memory backs up only what no rule file holds.")}}'
exit 0
