#!/usr/bin/env bash
# Voice gate: BLOCK a Gmail draft or send through the gws CLI until the voice
# canon has been read in this session. Denies via the PreToolUse
# permissionDecision.
#
# It guards the commands that put words in Forni's name into Gmail: the
# `gws gmail` helpers +send, +reply, +reply-all, and +forward (with or without
# --draft), `drafts create`, `drafts update`, and `messages send`. Sending a
# draft that already exists (`drafts send`) passes, since its words were
# gated when it was created, and so does every read.
#
# The check is the session transcript: it must show a Read of VOICE.md and of
# Admin/Tools/email.md. A subagent's reads live in its own transcript beside
# the session's, so those are searched too.
#
# Why a hook and not a rule: GC already says to consult VOICE.md before
# writing anything in Forni's voice. On 2026-10-05 an email to his CPA, drafted
# in the middle of a financial review, went through four drafts without it:
# a typed signature, no contractions, "Morning" at 14:29. Prose got dropped;
# a hook is the only guarantee.
#
# Its limit: it fires when the command runs, not when a draft is first written
# in chat, and a read that has since been compacted out of context still
# counts. Mail to Forni himself goes through Resend and never reaches it.
# Prefix a command with VOICE_GATE_BYPASS=1 to override on purpose.
# Fails OPEN: a missing transcript or any parse error exits 0.
set -uo pipefail

input=$(cat)
cmd=$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null)
[[ -z "$cmd" ]] && exit 0

grep -qE '^[[:space:]]*VOICE_GATE_BYPASS=1([[:space:]]|$)' <<<"$cmd" && exit 0

# Fold backslash-newline continuations so a split command is still recognized.
cmd=${cmd//$'\\\n'/ }

# A gws gmail command that writes words: a helper, or a raw create or send.
grep -qE '(^|[[:space:];&|(/])gws[[:space:]]+gmail[[:space:]]' <<<"$cmd" || exit 0
grep -qE 'gmail[[:space:]]+\+(send|reply|reply-all|forward)([[:space:]]|$)|drafts[[:space:]]+(create|update)([[:space:]]|$)|messages[[:space:]]+send([[:space:]]|$)' <<<"$cmd" || exit 0

transcript=$(jq -r '.transcript_path // empty' <<<"$input" 2>/dev/null)
[[ -n "$transcript" && -r "$transcript" ]] || exit 0

# The session transcript, plus any subagent transcripts kept beside it.
files=("$transcript")
side="${transcript%.jsonl}"
if [[ -d "$side" ]]; then
  while IFS= read -r f; do files+=("$f"); done < <(find "$side" -name '*.jsonl' -type f 2>/dev/null)
fi

read_of() {
  grep -qE "\"file_path\":[[:space:]]*\"[^\"]*$1\"" "${files[@]}" 2>/dev/null
}

missing=()
read_of '/Eudaimonia/VOICE\.md' || missing+=("$HOME/Eudaimonia/VOICE.md")
read_of '/Eudaimonia/Admin/Tools/email\.md' || missing+=("$HOME/Eudaimonia/Admin/Tools/email.md")
[[ ${#missing[@]} -eq 0 ]] && exit 0

list=$(printf '%s and ' "${missing[@]}"); list=${list% and }
jq -cn --arg l "$list" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:("Voice gate: this command writes an email in Forni'"'"'s name, and this session has not read " + $l + ". Read the voice canon and the email overlay with the Read tool, then the matching Voice/ samples if one fits (or his own recent sent mail to this person), run `date` so the greeting is true, revise the draft against them, and retry. Prefix with VOICE_GATE_BYPASS=1 only when the words are not in his voice.")}}'
exit 0
