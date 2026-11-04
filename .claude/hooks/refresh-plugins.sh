#!/usr/bin/env bash
# Refresh plugins: at session start, bring every marketplace clone and every
# user scope plugin up to its latest release, in the background, so the next
# session opens on current skills. The installed atelic copy sat eight
# releases behind its repo for a week (12.2.1 against 13.3.1, found
# 2026-11-04) because plugins refreshed only inside a full hand run of
# setup.sh. SessionStart with matcher "startup". A marketplace update clones
# each source afresh and takes tens of seconds, so the hook returns at once
# and the work runs detached; a plugin update applies on the next launch
# anyway. One line of stdout only when the previous run failed. One run per
# ten minutes across sessions, which is also the race guard. The plugin set
# comes from installed_plugins.json, not `claude plugin list`, whose enabled
# flag depends on the session's cwd (atelic reads as disabled from homebase);
# every plugin with a user scope entry is updated at user scope, which is
# where setup.sh installs them. sync-homebase.sh runs beside this hook but
# `setup.sh --reconcile` never touches plugins, so the two do not collide.
# Fails OPEN: no claude, no jq, locked, or any error means exit 0 in silence.
set -uo pipefail
unset CDPATH
export GIT_TERMINAL_PROMPT=0

STAMP="$HOME/.claude/.plugins-refreshed"
LOG="$HOME/.claude/.plugins-refreshed.log"
LOCK="$STAMP.lock"
INSTALLED="$HOME/.claude/plugins/installed_plugins.json"

command -v claude >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0
[[ -f "$INSTALLED" ]] || exit 0

if [[ -f "$LOG" ]] && grep -q '^FAILED' "$LOG" 2>/dev/null; then
  echo "Plugin refresh failed on its last run; read $LOG."
fi

# Fresh within ten minutes: nothing to do.
if [[ -f "$STAMP" ]] && [[ -z "$(find "$STAMP" -maxdepth 0 -mmin +10 2>/dev/null)" ]]; then
  exit 0
fi
# A lock older than thirty minutes is stale (a killed run never reaches its
# trap); a live run finishes well inside that, so a slow one is never reaped.
if [[ -d "$LOCK" ]] && [[ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]]; then
  rmdir "$LOCK" 2>/dev/null
fi
mkdir "$LOCK" 2>/dev/null || exit 0

(
  trap 'rmdir "$LOCK" 2>/dev/null' EXIT
  {
    echo "started $(date '+%F %T')"
    failed=0
    claude plugin marketplace update || failed=1
    n=0
    while IFS= read -r p; do
      [[ -z "$p" ]] && continue
      n=$((n + 1))
      claude plugin update "$p" -s user || failed=1
    done < <(jq -r '.plugins | to_entries[] | select(any(.value[]; .scope == "user")) | .key' "$INSTALLED" 2>/dev/null | sort -u)
    (( n > 0 )) || failed=1
    if (( failed )); then echo "FAILED $(date '+%F %T')"; else echo "finished $(date '+%F %T')"; fi
  } >"$LOG" 2>&1
  touch "$STAMP"
) </dev/null >/dev/null 2>&1 &
disown
exit 0
