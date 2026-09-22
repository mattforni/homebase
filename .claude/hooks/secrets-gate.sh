#!/usr/bin/env bash
# Secrets gate: BLOCK any Bash command that would print the contents of a
# credentials file into the transcript. Denies via the PreToolUse
# permissionDecision.
#
# The files it guards are the ones the runner tooling writes with live values
# in plaintext: a runner's .env.local (bin/runner/fetch-env), the encrypted
# gws credential and token cache files, and anything a vault export lands in.
# The commands it refuses are the ones that emit file contents: cat, head,
# tail, less, more, cut, sed, awk, paste, tac, nl, od, xxd, strings, grep
# without -c or -l or -q, bat, and a `source` or `.` of the file (which is
# how the shell reads it, and is allowed).
#
# Why a hook and not a rule: on 2026-09-21 a "show me the variable names"
# check ran `cut -d= -f1` over a fresh .env.local. Three of its secrets were
# multi line, their continuation lines carry no `=`, and the Atelic mailbox
# refresh token and two deploy keys' private halves printed whole. Prose said
# "never print" in the file's own header; a hook is the only guarantee.
#
# Counts and metadata stay allowed: `grep -c '^export '`, `wc`, `stat`,
# `ls`, `git check-ignore`, `test -s`. So does moving a value between
# processes without echoing it (`gcloud secrets versions access ... |
# python3 ...`, `--data-file=-`), since no guarded file name appears.
# Prefix a command with SECRETS_GATE_BYPASS=1 to override on purpose; the
# token counts only at the very start, where an assignment prefix belongs.
# Fails OPEN: any parse error exits 0, never worse than an ungated command.
set -uo pipefail

input=$(cat)
cmd=$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null)
[[ -z "$cmd" ]] && exit 0

grep -qE '^[[:space:]]*SECRETS_GATE_BYPASS=1([[:space:]]|$)' <<<"$cmd" && exit 0

# The guarded names, matched anywhere in the command as a path tail.
guarded='(\.env\.local|credentials\.enc|token_cache\.json|client_secret\.json|\.env\.(production|secrets)|secrets?\.(env|json))'
grep -qE "$guarded" <<<"$cmd" || exit 0

# Split on pipes and separators (a lone & included, since `sleep 1 & cat file`
# is two commands), and judge each simple command on its own, so
# `wc -c runners/x/.env.local` passes while `cat runners/x/.env.local | wc -c`
# does not (the cat already printed, whatever consumed it).
deny=0
while IFS= read -r simple; do
  [[ -z "${simple// /}" ]] && continue
  grep -qE "$guarded" <<<"$simple" || continue
  # The first word, past any leading assignments, sudo, or a path prefix.
  verb=$(sed -E 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*//; s/^(sudo|command|exec)[[:space:]]+//; s/^([^[:space:]]*\/)?([^[:space:]]+).*/\2/' <<<"$simple")
  case "$verb" in
    cat|head|tail|less|more|cut|sed|awk|paste|tac|nl|od|xxd|hexdump|strings|bat|column|fold|fmt|pr|rev|tr|sort|uniq|dd|jq|yq|python|python3|node|ruby|perl|base64|openssl)
      deny=1 ;;
    grep|egrep|fgrep|rg|ag)
      # A count, a file list, or a quiet test prints no line; anything else does.
      grep -qE '(^|[[:space:]])-[A-Za-z]*[clLq]' <<<"$simple" || deny=1 ;;
    echo|printf)
      # `echo "$(cat file)"` and friends: the substitution is the read.
      grep -qE '\$\(|`' <<<"$simple" && deny=1 ;;
  esac
  # A command substitution that reads the file prints it by another name.
  grep -qE '\$\([^)]*(cat|head|tail|cut|sed|awk|<)[^)]*'"$guarded" <<<"$simple" && deny=1
  # `< file` as the input of a printing command.
  grep -qE '<[[:space:]]*[^[:space:]]*'"$guarded" <<<"$simple" && case "$verb" in wc|grep|egrep|fgrep|rg|python|python3|node|gcloud|curl) ;; *) deny=1 ;; esac
done < <(sed -E 's/\|\|/\n/g; s/&&/\n/g; s/[|;&]/\n/g' <<<"$cmd")

if [[ $deny -eq 1 ]]; then
  cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Secrets gate: this command would print a credentials file (.env.local, a gws credential, a vault export) into the transcript, which cannot be unprinted; on 2026-09-21 a cut over an .env.local leaked two deploy keys and a mailbox token. Inspect a secrets file only by counts and metadata (grep -c '^export ', wc -c, stat, git check-ignore), and move a value between processes without echoing it. Prefix with SECRETS_GATE_BYPASS=1 only when printing it is genuinely the intent."}}
JSON
  exit 0
fi
exit 0
