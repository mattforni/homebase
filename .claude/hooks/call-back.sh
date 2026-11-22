#!/usr/bin/env bash
# Call back timer: ring the user out loud once a session has waited on them
# for five minutes.
#
# Waiting on the user means one of two things:
#   - a turn ended (Stop) and the final non empty line of Claude's last
#     message ends with a question mark, or
#   - Claude opened an AskUserQuestion dialog (PreToolUse on that tool),
#     since a dialog holds the turn open and no Stop fires until it is
#     answered.
# Either one arms the session: a stamp under $HOME/.claude/call-back/ keyed by
# session id, and a detached timer that wakes after CALL_BACK_AFTER_SECONDS
# (default 300). If the stamp is still the one it was started for, the timer
# runs bin/call/back "<project> is waiting on you." and removes the stamp, so
# one stamp rings at most once. A turn that ends in a plain report never arms,
# since the user runs several sessions at once and a chime after every
# finished answer would be noise, and it leaves an armed stamp alone: a
# question is still open after a background agent reports and Claude answers
# the report. A new question replaces the stamp, which restarts the clock and
# leaves the first timer nothing to ring for.
#
# Disarming is removing the stamp, and only the user can do it: a prompt they
# typed (UserPromptSubmit), the dialog answered (PostToolUse on
# AskUserQuestion, or PostToolUseFailure when the dialog errors), or the
# session ending (SessionEnd). UserPromptSubmit also
# fires for prompts nobody typed, and those leave the stamp alone:
#   - harness envelopes, told apart by the first non blank line of the
#     prompt: a background task or agent report (<task-notification>,
#     <agent-message>), a message from another session
#     (<cross-session-message>), a teammate, a channel, a coordinator relay,
#     a dynamic /loop wakeup (<<autonomous-loop), or a line carrying
#     [SYSTEM NOTIFICATION - NOT USER INPUT];
#   - a scheduled task or /loop iteration, whose prompt is plain text: told
#     apart by matching it against the session_crons the last Stop listed,
#     which this hook keeps beside the stamp.
#
# Never armed:
#   - inside a subagent or teammate: the hook input carries agent_id there;
#   - a hook driven continuation: stop_hook_active is true;
#   - a headless run: CLAUDE_CODE_SESSION_ATTENDED is 0 (claude -p sets it so),
#     or, when that variable is absent, CLAUDE_CODE_ENTRYPOINT names the print
#     mode or an SDK host (sdk-cli, sdk-ts, sdk-py);
#   - a cloud session: CLAUDE_CODE_REMOTE is true.
#
# The kill switch ($HOME/.claude/call-back.off) lives in bin/call/back, so a
# timer already running when the user silences it stays quiet too. Each ring
# appends a line to $HOME/.claude/call-back/rings.log; anything there older
# than a day is pruned on every run.
#
# It must never fail a turn and never hold one up: it prints nothing, every
# path exits 0, and the timer runs detached with its output redirected.
set -uo pipefail

DIR="$HOME/.claude/call-back"

# The real path of this script, so the timer can call it again and find
# bin/call/back in the same checkout (~/.claude/hooks is a link into it).
self() {
  local src="${BASH_SOURCE[0]}" d
  d=$(cd -P "${src%/*}" 2>/dev/null && pwd -P) || return 1
  printf '%s/%s\n' "$d" "${src##*/}"
}

back_cmd() {
  local me root
  me=$(self) || me=""
  if [[ -n "$me" ]]; then
    root=$(cd -P "$(dirname "$me")/../.." 2>/dev/null && pwd -P)
    [[ -x "$root/bin/call/back" ]] && { printf '%s\n' "$root/bin/call/back"; return 0; }
  fi
  [[ -x "$HOME/bin/call/back" ]] && { printf '%s\n' "$HOME/bin/call/back"; return 0; }
  return 1
}

stamp_path() { printf '%s/%s.stamp\n' "$DIR" "$1"; }
crons_path() { printf '%s/%s.crons\n' "$DIR" "$1"; }

# The timer, run detached by arm(): --timer <session> <token> <seconds>.
if [[ "${1:-}" == "--timer" ]]; then
  sid="${2:-}" token="${3:-}" after="${4:-300}"
  [[ -n "$sid" && -n "$token" ]] || exit 0
  sleep "$after"
  stamp=$(stamp_path "$sid")
  [[ -r "$stamp" ]] || exit 0
  read -r have _ project < "$stamp" || exit 0
  [[ "$have" == "$token" ]] || exit 0
  # Claim the stamp by renaming it first, so a newer arm that replaces it
  # between the check and the removal is never deleted by this timer.
  claim="$stamp.claim.$$"
  mv "$stamp" "$claim" 2>/dev/null || exit 0
  read -r have _ < "$claim" 2>/dev/null
  if [[ "$have" != "$token" ]]; then
    # Caught a newer stamp: put it back unless an even newer one landed.
    mv -n "$claim" "$stamp" 2>/dev/null
    rm -f "$claim"
    exit 0
  fi
  rm -f "$claim"
  cmd=$(back_cmd) || exit 0
  {
    printf '%s ring %s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$sid" "$project"
    "$cmd" "$project is waiting on you."
  } >> "$DIR/rings.log" 2>&1
  exit 0
fi

input=$(cat 2>/dev/null) || exit 0
[[ -n "$input" ]] || exit 0
command -v jq &>/dev/null || exit 0

# One jq for every field but the message, which only a Stop reads. Fields
# are split on the unit separator, which (unlike a tab) never folds two
# empty fields into one.
IFS=$'\x1f' read -r event sid agent continuing tool cwd < <(jq -r '[
  .hook_event_name, .session_id, .agent_id, (.stop_hook_active // false),
  .tool_name, .cwd
] | map(if . == null then "" else tostring end | gsub("[\u001f\n]"; " ")) | join("\u001f")' <<<"$input" 2>/dev/null) || exit 0
sid=${sid//[^A-Za-z0-9_-]/}
[[ -n "$event" && -n "$sid" ]] || exit 0

mkdir -p "$DIR" 2>/dev/null || exit 0
find "$DIR" -type f -mmin +1440 -delete 2>/dev/null

disarm() { rm -f "$(stamp_path "$sid")" 2>/dev/null; }

# The prompts of the session's scheduled tasks, as the last Stop listed them,
# so a firing can be told from typing. Rewritten on every main Stop.
remember_crons() {
  local f prompts
  f=$(crons_path "$sid")
  prompts=$(jq -c '[.session_crons[]?.prompt | strings]' <<<"$input" 2>/dev/null) || prompts='[]'
  if [[ "$prompts" == '[]' || -z "$prompts" ]]; then
    rm -f "$f" 2>/dev/null
  else
    printf '%s\n' "$prompts" > "$f" 2>/dev/null
  fi
  return 0
}

# Did the user type this prompt? Anything the harness wrapped or scheduled
# says no, and so does a prompt that cannot be read, so a doubt never
# cancels a ring.
typed() {
  local prompt first crons
  prompt=$(jq -r '.prompt // empty' <<<"$input" 2>/dev/null) || return 1
  [[ -n "$prompt" ]] || return 1
  first=$(printf '%s\n' "$prompt" | awk 'NF { print; exit }')
  first=${first#"${first%%[![:space:]]*}"}
  case "$first" in
    '<task-notification'* | '<agent-message'* | '<cross-session-message'* | \
    '<teammate-message'* | '<coordinator-relay'* | '<channel'* | \
    '<slack-ping'* | '<slack-tag-message'* | '<<autonomous-loop'* | \
    *'[SYSTEM NOTIFICATION - NOT USER INPUT]'*)
      return 1 ;;
  esac
  crons=$(crons_path "$sid")
  if [[ -r "$crons" ]]; then
    # A listed prompt longer than 1000 characters is cut and marked
    # "… [+N chars]", so a cut one matches on the part before the mark.
    # Trailing whitespace is ignored on both sides.
    jq -e --arg p "$prompt" 'def norm: sub("\\s+$"; "");
      ($p | norm) as $p | any(.[]; norm as $c
      | ($c | sub("… \\[\\+[0-9]+ chars\\]$"; "")) as $base
      | $p == $c or ($base != $c and ($p | startswith($base))))' "$crons" >/dev/null 2>&1 \
      && return 1
  fi
  return 0
}

attended() {
  [[ "${CLAUDE_CODE_REMOTE:-}" == true ]] && return 1
  case "${CLAUDE_CODE_SESSION_ATTENDED:-}" in
    1) return 0 ;;
    '') ;;
    *) return 1 ;;
  esac
  case "${CLAUDE_CODE_ENTRYPOINT:-}" in
    sdk-*) return 1 ;;
  esac
  return 0
}

# The folder the session started in, named by its repo when it is a worktree
# under .claude/worktrees/, so the line says "homebase", not the branch.
project_name() {
  local p="${CLAUDE_PROJECT_DIR:-}"
  [[ -n "$p" ]] || p="$cwd"
  [[ -n "$p" ]] || { echo "A session"; return; }
  [[ "$p" == */.claude/worktrees/* ]] && p=${p%%/.claude/worktrees/*}
  p=${p%/}
  p=${p##*/}
  printf '%s\n' "${p:-A session}"
}

arm() {
  local after="${CALL_BACK_AFTER_SECONDS:-300}" token me tmp
  [[ "$after" =~ ^[0-9]+$ ]] || after=300
  me=$(self) || return 0
  token="$(date +%s).$$.$RANDOM"
  tmp="$(stamp_path "$sid").$$"
  printf '%s %s %s\n' "$token" "$(date +%s)" "$(project_name)" > "$tmp" 2>/dev/null || return 0
  mv -f "$tmp" "$(stamp_path "$sid")" 2>/dev/null || { rm -f "$tmp"; return 0; }
  nohup "$me" --timer "$sid" "$token" "$after" </dev/null >/dev/null 2>&1 &
  disown 2>/dev/null
  return 0
}

ends_in_question() {
  local msg last
  msg=$(jq -r '.last_assistant_message // empty' <<<"$input" 2>/dev/null) || return 1
  [[ -n "$msg" ]] || return 1
  last=$(printf '%s\n' "$msg" | awk 'NF { line = $0 } END { print line }')
  # Trailing markdown and closing marks (bold, italics, code, quotes,
  # brackets) do not hide the question mark they wrap.
  while [[ -n "$last" && "$last" == *[[:space:]\*_\`\"\'\)\]] ]]; do
    last=${last%?}
  done
  [[ "$last" == *'?' ]]
}

case "$event" in
  Stop)
    [[ -z "$agent" && "$continuing" == false ]] || exit 0
    attended || exit 0
    remember_crons
    if ends_in_question; then arm; fi
    ;;
  PreToolUse)
    [[ "$tool" == AskUserQuestion && -z "$agent" ]] || exit 0
    attended || exit 0
    arm
    ;;
  PostToolUse | PostToolUseFailure)
    [[ "$tool" == AskUserQuestion ]] || exit 0
    disarm
    ;;
  UserPromptSubmit)
    typed && disarm
    ;;
  SessionEnd)
    disarm
    rm -f "$(crons_path "$sid")" 2>/dev/null
    ;;
esac
exit 0
