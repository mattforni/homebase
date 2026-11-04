#!/usr/bin/env bash
# Refresh plugins: at session start, bring every marketplace clone and every
# enabled plugin up to its latest release, in the background, so the next
# session opens on current skills. The installed atelic copy sat eight
# releases behind its repo for a week (12.2.1 against 13.3.1, found
# 2026-11-04) because plugins refreshed only inside a full hand run of
# setup.sh. SessionStart with matcher "startup". A marketplace update re-clones
# each source and takes tens of seconds, so the hook returns at once and the
# work runs detached; a plugin update applies on the next launch anyway. One
# line of stdout only when the previous run failed. One run per ten minutes
# across sessions, which is also the race guard. Fails OPEN: no claude,
# locked, or any error means exit 0 in silence.
set -uo pipefail
unset CDPATH

STAMP="$HOME/.claude/.plugins-refreshed"
LOG="$HOME/.claude/.plugins-refreshed.log"
LOCK="$STAMP.lock"

command -v claude >/dev/null 2>&1 || exit 0

if [[ -f "$LOG" ]] && grep -q '^FAILED' "$LOG" 2>/dev/null; then
  echo "Plugin refresh failed on its last run; read $LOG."
fi

# Fresh within ten minutes: nothing to do.
if [[ -f "$STAMP" ]] && [[ -z "$(find "$STAMP" -maxdepth 0 -mmin +10 2>/dev/null)" ]]; then
  exit 0
fi
# A lock older than ten minutes is stale (a killed run never reaches its trap).
if [[ -d "$LOCK" ]] && [[ -n "$(find "$LOCK" -maxdepth 0 -mmin +10 2>/dev/null)" ]]; then
  rmdir "$LOCK" 2>/dev/null
fi
mkdir "$LOCK" 2>/dev/null || exit 0

(
  trap 'rmdir "$LOCK" 2>/dev/null' EXIT
  {
    echo "started $(date '+%F %T')"
    failed=0
    claude plugin marketplace update || failed=1
    # Enabled plugins only: `claude plugin list` prints a "❯ name@marketplace"
    # line followed by its fields, and a disabled plugin cannot be updated.
    while IFS= read -r p; do
      [[ -z "$p" ]] && continue
      claude plugin update "$p" || failed=1
    done < <(claude plugin list 2>/dev/null \
      | awk '/❯/ { sub(/.*❯ /, ""); name=$0 } /Status: .*enabled/ && name != "" { print name; name="" }' \
      | sort -u)
    if (( failed )); then echo "FAILED $(date '+%F %T')"; else echo "finished $(date '+%F %T')"; fi
  } >"$LOG" 2>&1
  touch "$STAMP"
) </dev/null >/dev/null 2>&1 &
disown
exit 0
