#!/usr/bin/env bash
# Archive star gate: BLOCK a gws Gmail label change that would leave a star
# on archived mail, or that would add a blue star. Denies via the PreToolUse
# permissionDecision.
#
# Two rules, both from the star semantics in the assist plugin's
# reference/email-rules.md:
#   1. Nothing in the archive carries a star. A messages modify, batchModify,
#      or threads modify that removes INBOX must also remove STARRED,
#      YELLOW_STAR, GREEN_STAR, RED_STAR, and BLUE_STAR.
#   2. Blue is never used. Adding BLUE_STAR is refused, and so is adding a
#      bare STARRED, since Gmail turns a colorless star blue. Star with
#      YELLOW_STAR, GREEN_STAR, or RED_STAR alone; Gmail adds STARRED itself.
#
# Why a hook and not a rule: the strip rule lived only in the triage method,
# so an archive done any other way never loaded it, and a yellow starred
# thread sat in the Atelic archive on 2026-11-26 (Forni: "We never want
# anything in archive with a star on it").
#
# The label lists are read from the command text, so a list held in a shell
# variable ($S) cannot be checked and is refused; spell the ids out.
# Prefix with ARCHIVE_STAR_GATE_BYPASS=1 (after any other VAR=value prefixes
# is fine) to override on purpose.
#
# Known limit: this reads the Bash command text only. A modify written inside a
# script file that is then run, a body read from a file or built by jq, and
# `sh -c` strings are not seen. Closing those means enforcing in the bin/gws
# shim, which sees the real argv; that is a separate change.
# Fails OPEN: any parse error exits 0, never worse than an ungated command.
set -uo pipefail

input=$(cat)
cmd=$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null)
[[ -z "$cmd" ]] && exit 0

grep -qE '^([[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*)*[[:space:]]*ARCHIVE_STAR_GATE_BYPASS=1([[:space:]]|$)' <<<"$cmd" && exit 0

# Only gws Gmail label writes are in scope.
grep -qE '(^|[^[:alnum:]_-])gws([[:space:]]|$)' <<<"$cmd" || exit 0
grep -qE 'gmail' <<<"$cmd" || exit 0
grep -qE '(modify|batchModify)([^[:alnum:]]|$)' <<<"$cmd" || exit 0

# Shell escaping of the JSON (\"addLabelIds\") is noise for this check.
flat=$(tr -d '\\\n' <<<"$cmd")

# The text of one label array, or empty when the key is absent.
array() { grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\\[[^]]*\\]" <<<"$flat" | head -1; }
has() { grep -qE "\"$2\"" <<<"$1"; }

deny() {
  jq -cn --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

check() {
  local flat="$1" add remove
  add=$(array addLabelIds)
  remove=$(array removeLabelIds)

if grep -qF '$' <<<"$add$remove"; then
  deny "Archive star gate: a label list held in a shell variable cannot be checked for stars. Spell the label ids out in addLabelIds and removeLabelIds; an archive removes \"INBOX\",\"STARRED\",\"YELLOW_STAR\",\"GREEN_STAR\",\"RED_STAR\",\"BLUE_STAR\". Prefix with ARCHIVE_STAR_GATE_BYPASS=1 only when that is genuinely the intent."
fi

if [[ -n "$add" ]] && { has "$add" BLUE_STAR || has "$add" STARRED; }; then
  deny "Archive star gate: blue stars are never used, and a bare STARRED turns blue. Star with the color id alone (YELLOW_STAR, GREEN_STAR, or RED_STAR) and never pass STARRED or BLUE_STAR in addLabelIds; Gmail adds STARRED on its own. Prefix with ARCHIVE_STAR_GATE_BYPASS=1 only when that is genuinely the intent."
fi

if [[ -n "$remove" ]] && has "$remove" INBOX; then
  missing=()
  for star in STARRED YELLOW_STAR GREEN_STAR RED_STAR BLUE_STAR; do
    has "$remove" "$star" || missing+=("$star")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    deny "Archive star gate: nothing in the archive carries a star. This archive (removeLabelIds has INBOX) leaves ${missing[*]} in place. Pass the full star set, spelled out rather than in a shell variable: \"removeLabelIds\":[\"INBOX\",\"STARRED\",\"YELLOW_STAR\",\"GREEN_STAR\",\"RED_STAR\",\"BLUE_STAR\"] (plus UNREAD when marking read). Prefix with ARCHIVE_STAR_GATE_BYPASS=1 only when keeping the star is genuinely the intent."
  fi
fi
}

# One check per gws invocation, so a second modify in the same call is not skipped.
while IFS= read -r seg; do
  [[ -n "$seg" ]] && check "$seg"
done < <(awk '{ gsub(/(^|[^[:alnum:]_-])gws[[:space:]]/, "\n"); print }' <<<"$flat")
exit 0
