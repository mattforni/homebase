#!/usr/bin/env bash
# The Sweep Runner. Meant for Monday 18:00 Denver from Cloud Scheduler, so the
# Tuesday 07:00 work search block opens on a scored slate rather than a sweep.
#
# Shape: Eudaimonia first (the checkout already present, or a shallow clone over
# the read only deploy key), then one headless Claude Code call running the
# `recruiter` agent, which reads the plan, the rubric, the work search log and
# the sweep ledger from that checkout and sweeps the job sources on the open
# web, then one Resend send carrying the agent's whole report as
# "YYYY-Www Sweep". Read only against the world: the agent writes nothing
# outside its work directory, and the ledger rows come back inside the email
# for the Tuesday session to append.
#
# The brief is the agent definition and nothing else. This runner carries no
# prompt of its own beyond a line naming the week, the checkout and the scratch
# directory, so the sweep that runs here is the sweep that runs by hand.
#
# Secrets arrive as environment variables, injected by Cloud Run from the
# vault, or by bin/runner/run-local from this machine:
#   CLAUDE_CODE_OAUTH_TOKEN   atelic-keys/claude-code-oauth
#   RESEND_API_KEY            atelic-keys/resend-api-key
#   EUDY_DEPLOY_KEY           forni-keys/github-deploy-key-eudy; needed only when
#                             no checkout is present at $EUDY
# Plain configuration:
#   REPORT_RECIPIENT          where the board goes; the personal mailbox, since
#                             the work search is personal work
#   REPORT_SENDER             defaults to Claude <claude@atelic.me>
#   EUDY                      the Eudaimonia checkout; defaults to $HOME/Eudaimonia,
#                             which is where the agent's own paths resolve
#   WEEK                      optional YYYY-Www override; default is this week
#   DRY_RUN                   1 renders the email and skips the send
#   SKIP_PULLS                1 replays the saved agent result instead of
#                             running the agent again
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The shared library sits beside this script inside an image and one level up
# in the repo, so both are tried rather than either being assumed.
for candidate in "$SELF_DIR/lib/runner.sh" "$SELF_DIR/../lib/runner.sh"; do
    if [[ -r "$candidate" ]]; then
        # shellcheck source=../lib/runner.sh
        . "$candidate"
        RUNNER_LIB="$candidate"
        break
    fi
done
if [[ -z "${RUNNER_LIB:-}" ]]; then
    echo "FATAL: cannot find runners/lib/runner.sh from $SELF_DIR" >&2
    exit 1
fi

DRY_RUN="${DRY_RUN:-0}"
SKIP_PULLS="${SKIP_PULLS:-0}"

WORK="${WORK:-$HOME/work}"
if ! mkdir -p "$WORK"; then
    echo "FATAL: cannot create the work directory $WORK" >&2
    exit 1
fi
LOG="$WORK/run.log"
if ! touch "$LOG"; then
    echo "FATAL: cannot write the log at $LOG" >&2
    exit 1
fi
exec > >(tee -a "$LOG") 2>&1

WEEK="${WEEK:-$(current_week)}"
if [[ ! "$WEEK" =~ ^[0-9]{4}-W[0-9]{2}$ ]]; then
    echo "FATAL: WEEK must look like YYYY-Www, got \"$WEEK\"" >&2
    exit 1
fi
week_year="${WEEK%-W*}"
week_number="10#${WEEK#*-W}"
week_last=52
if [[ "$(day_of_week "$week_year-01-01")" == "4" || "$(day_of_week "$week_year-12-31")" == "4" ]]; then
    week_last=53
fi
if (( week_number < 1 || week_number > week_last )); then
    echo "FATAL: $week_year has $week_last ISO weeks, so $WEEK is not one of them" >&2
    exit 1
fi
MONDAY="$(week_monday "$WEEK")"
SUNDAY="$(shift_days "$MONDAY" 6)"
if [[ -z "$MONDAY" || -z "$SUNDAY" ]]; then
    echo "FATAL: could not resolve the week bounds for $WEEK" >&2
    exit 1
fi

# The agent's definition names its sources as ~/Eudaimonia/... paths. Inside
# the image HOME is /home/runner, so a checkout there makes every one of those
# paths resolve without the brief having to say anything about it; on this
# machine the same default is the real checkout.
EUDY="${EUDY:-$HOME/Eudaimonia}"
EUDY_REPO="${EUDY_REPO:-git@github.com:mattforni/Eudaimonia.git}"
RUBRIC="Craft/Vocation/role-rubric.md"

echo "=== $(date -Iseconds) sweep start: $WEEK ($MONDAY to $SUNDAY) ==="

SUBJECT="$WEEK Sweep"
SUCCESS_LINE="Sweep complete for $WEEK"

RESULT_JSON="$WORK/result.json"
RESULT_RC="$WORK/result.rc"
REPORT_HTML="$WORK/email.html"

status="failure"
fail_reason=""
result=""
rc=0

# The board is the email, not an attachment to a status line: the report the
# agent returns is the body, in full and visible, with one footer line for the
# run's facts. A failure, and only a failure, gets a summary block on top.
build_sweep_html() {
    local heading="$1" report="$2" summary_html="$3" meta_html="$4"
    local emoji report_html=""
    if [[ "$status" == "success" ]]; then emoji="🔎"; else emoji="❌"; fi
    if [[ -n "$report" ]]; then
        # The agent writes markdown with tables. The image carries marked to
        # turn it into HTML, and Gmail strips <style>, so the few styles the
        # tables need are put inline after the fact; without marked (a host
        # run) the markdown is shown as it is, readable if not pretty.
        if command -v marked >/dev/null 2>&1; then
            report_html="$(printf '%s' "$report" | marked --gfm 2>/dev/null \
                | sed -e 's/<table>/<table style="border-collapse:collapse;font-size:13px;margin:0 0 16px 0;">/g' \
                      -e 's/<th>/<th style="text-align:left;padding:4px 8px;border-bottom:2px solid #ddd;vertical-align:top;">/g' \
                      -e 's/<td>/<td style="padding:4px 8px;border-bottom:1px solid #eee;vertical-align:top;">/g' \
                      -e 's/<h1>/<h1 style="font-size:20px;margin:0 0 12px 0;">/g' \
                      -e 's/<h2>/<h2 style="font-size:17px;margin:20px 0 8px 0;">/g' \
                      -e 's/<hr>/<hr style="border:0;border-top:1px solid #ddd;margin:16px 0;">/g')"
        fi
        if [[ -z "$report_html" ]]; then
            report_html="<pre style=\"font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;margin:0 0 12px 0;\">$(printf '%s' "$report" | html_escape)</pre>"
        fi
    fi
    printf '%s' "<!DOCTYPE html><html><body style=\"font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:14px;color:#1d1d1f;line-height:1.5;max-width:720px;\">
<h2 style=\"margin:0 0 8px 0;font-size:18px;\">$emoji $(printf '%s' "$heading" | html_escape)</h2>
$summary_html
$report_html
$meta_html
</body></html>"
}

finish() {
    local script_rc=$?
    local summary meta report body reported_rc
    if [[ "$rc" -ne 0 ]]; then reported_rc="$rc"; else reported_rc="$script_rc"; fi
    summary=""
    [[ "$status" == "success" ]] || summary="$(build_summary_block "$result" "$rc" "$SUCCESS_LINE")"
    meta="$(build_meta_line "$result" "$reported_rc")"
    report="$(jq -r '.result // ""' <<<"$result" 2>/dev/null)"
    [[ -z "$report" ]] && report="$result"
    # The success line is the runner's handshake, not the reader's.
    report="${report%"$SUCCESS_LINE"}"
    report="${report%$'\n'}"

    if [[ "$status" != "success" && -n "$fail_reason" ]]; then
        summary="<div style=\"background:#ffebee;border-left:4px solid #c62828;padding:10px 14px;border-radius:4px;margin:0 0 12px 0;\"><strong style=\"color:#b71c1c;\">$(printf '%s' "$fail_reason" | html_escape)</strong></div>$summary"
        echo "FAILED: $fail_reason"
    fi

    body="$(build_sweep_html "$SUBJECT" "$report" "$summary" "$meta")"
    printf '%s' "$body" > "$REPORT_HTML"

    if [[ "$DRY_RUN" == "1" ]]; then
        echo "dry run: subject \"$SUBJECT\""
        echo "dry run: rendered $REPORT_HTML"
        sleep 1
        [[ "$status" == "success" ]] || exit 1
        return
    fi

    send_email "$SUBJECT" "$body" || {
        echo "email: the report could not be delivered"
        sleep 1
        exit 1
    }
    sleep 1
    [[ "$status" == "success" ]] || exit 1
}
trap finish EXIT

required=()
[[ "$SKIP_PULLS" == "1" ]] || required+=(CLAUDE_CODE_OAUTH_TOKEN)
[[ "$DRY_RUN" == "1" ]] || required+=(RESEND_API_KEY REPORT_RECIPIENT)
if (( ${#required[@]} )); then
    require "${required[@]}" || exit 1
fi

# ---------- Eudaimonia ----------
# A checkout that is already there is used as it is and never touched: on this
# machine that is the real repository, and in a container rehearsal it is a
# read only mount of it. Only an absent checkout is cloned, shallow, over the
# read only deploy key, which is the production path.
eudy_ready() {
    if [[ -f "$EUDY/$RUBRIC" ]]; then
        echo "eudy: using the checkout at $EUDY ($(git -C "$EUDY" log -1 --format=%h 2>/dev/null || echo 'not a git checkout'))"
        return 0
    fi
    if [[ -e "$EUDY" ]]; then
        fail_reason="$EUDY exists but has no $RUBRIC; refusing to clone over it"
        return 1
    fi
    require EUDY_DEPLOY_KEY || return 1
    mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
    printf '%s\n' "$EUDY_DEPLOY_KEY" > "$HOME/.ssh/eudy_deploy_key"
    chmod 600 "$HOME/.ssh/eudy_deploy_key"
    export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/eudy_deploy_key -o IdentitiesOnly=yes -o UserKnownHostsFile=$HOME/.ssh/known_hosts -o StrictHostKeyChecking=yes"
    if ! timeout 2m git clone --quiet --depth 1 "$EUDY_REPO" "$EUDY" 2>"$WORK/git-stderr.txt"; then
        fail_reason="Eudaimonia clone failed: $(head -c 300 "$WORK/git-stderr.txt")"
        return 1
    fi
    if [[ ! -f "$EUDY/$RUBRIC" ]]; then
        fail_reason="Eudaimonia clone is missing $RUBRIC"
        return 1
    fi
    echo "eudy: $(git -C "$EUDY" log -1 --format='%h %s' | cut -c1-80)"
}

# ---------- the agent ----------
# Everything the recruiter's method needs and nothing it does not: the reads,
# the two web tools, curl for the ATS APIs the method names, and a scratch
# directory. No write reaches the checkout, so the ledger cannot be appended
# from here; it travels back inside the report instead.
ALLOWED_TOOLS=(
    "Read"
    "Grep"
    "Glob"
    "WebFetch"
    "WebSearch"
    "Bash(curl:*)"
    "Bash(jq:*)"
    "Bash(date:*)"
    "Bash(cat:*)"
    "Bash(ls:*)"
    "Write($WORK/*)"
)

ATTEMPT_TIMEOUT="${ATTEMPT_TIMEOUT:-45m}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-2}"
RETRY_BACKOFF_SECONDS=15
TRANSIENT='socket connection was closed|API Error|overloaded|Connection error|terminated'

if [[ "$SKIP_PULLS" == "1" ]]; then
    if [[ ! -f "$RESULT_RC" ]]; then
        fail_reason="SKIP_PULLS is set but no saved run is in $WORK; run once without it"
        exit 1
    fi
    result="$(cat "$RESULT_JSON" 2>/dev/null)" || result=""
    rc="$(cat "$RESULT_RC")"
    [[ "$rc" =~ ^[0-9]+$ ]] || rc=1
    echo "agent: replaying the run saved in $WORK (exit $rc)"
else
    missing_tools=()
    for tool in claude jq curl timeout git; do
        command -v "$tool" &>/dev/null || missing_tools+=("$tool")
    done
    if (( ${#missing_tools[@]} )); then
        fail_reason="not on PATH: ${missing_tools[*]} (PATH=$PATH)"
        exit 1
    fi
    eudy_ready || exit 1

    prompt="Sweep the job sources for ISO week $WEEK ($MONDAY to $SUNDAY). Eudaimonia is checked out at $EUDY, so every path in your definition that begins with ~/Eudaimonia resolves under it. Scratch directory for working files: $WORK; write nowhere else. Run the full method in your definition and return the complete report as your final message, then end with the line: $SUCCESS_LINE"
    stderr_file="$WORK/claude-stderr.txt"
    attempt=1
    while :; do
        echo "=== $(date -Iseconds) claude attempt $attempt/$MAX_ATTEMPTS (timeout $ATTEMPT_TIMEOUT) ==="
        result="$(timeout "$ATTEMPT_TIMEOUT" claude -p "$prompt" \
            --agent recruiter \
            --allowedTools "${ALLOWED_TOOLS[@]}" \
            --output-format json 2>"$stderr_file")"
        rc=$?
        [[ $rc -eq 0 ]] && break

        transient=false
        if [[ $rc -eq 124 ]]; then
            transient=true
            echo "attempt $attempt timed out after $ATTEMPT_TIMEOUT"
        elif { printf '%s' "$result"; cat "$stderr_file" 2>/dev/null; } | grep -qiE "$TRANSIENT"; then
            transient=true
            echo "attempt $attempt hit a transient API error (exit $rc)"
        fi

        if [[ "$transient" == true && $attempt -lt $MAX_ATTEMPTS ]]; then
            echo "retrying in ${RETRY_BACKOFF_SECONDS}s"
            attempt=$((attempt + 1))
            sleep "$RETRY_BACKOFF_SECONDS"
            continue
        fi
        break
    done

    printf '%s' "$result" > "$RESULT_JSON"
    printf '%s' "$rc" > "$RESULT_RC"
fi

if [[ $rc -ne 0 ]]; then
    fail_reason="claude exited $rc: $(head -c 400 "$WORK/claude-stderr.txt" 2>/dev/null)"
    exit 1
fi

if ! jq -e . <<<"$result" >/dev/null 2>"$WORK/jq-stderr.txt"; then
    fail_reason="the agent returned output that is not JSON: $(head -c 300 <<<"$result")"
    exit 1
fi
if ! jq -e --arg line "$SUCCESS_LINE" \
    '.subtype == "success" and .is_error == false and ((.result // "") | contains($line))' \
    <<<"$result" >/dev/null; then
    fail_reason="the agent did not confirm the sweep: expected \"$SUCCESS_LINE\""
    exit 1
fi

usage="$(jq -r '"\(.num_turns // "?") turns; " + ((.modelUsage // {}) | to_entries | map("\(.key) in \(.value.inputTokens // 0) out \(.value.outputTokens // 0) cache read \(.value.cacheReadInputTokens // 0) write \(.value.cacheCreationInputTokens // 0)") | join("; "))' <<<"$result")"
echo "agent: sweep complete (cost $(jq -r '.total_cost_usd // "?"' <<<"$result") USD; $usage)"
status="success"
