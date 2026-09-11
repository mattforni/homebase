#!/usr/bin/env bash
# The Sweep Runner. Meant for Monday 18:00 Denver from Cloud Scheduler, so the
# Tuesday 07:00 work search block opens on a scored slate rather than a sweep.
#
# Shape: Eudaimonia first (the checkout already present, or a shallow clone over
# the read only deploy key), then one headless Claude Code call running the
# `recruiter` agent, which reads the plan, the rubric, the work search log and
# the sweep ledger from that checkout and sweeps the job sources on the open
# web and returns the board as JSON, then render.jq turns that into the
# designed email and Resend delivers it as "YYYY-Www Sweep". Read only against
# the world: the agent writes nothing outside its work directory, and the
# ledger rows come back inside the email for the Tuesday session to append.
#
# The brief is the agent definition; prompt.md adds only the week, the
# checkout, the scratch directory and the JSON shape the renderer reads, so
# the sweep that runs here is the sweep that runs by hand.
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

# The brief and the renderer sit beside this script in both places.
PROMPT_FILE="${PROMPT_FILE:-$SELF_DIR/prompt.md}"
RENDER="${RENDER:-$SELF_DIR/render.jq}"
# The shared email design (email.jq) sits beside runner.sh, wherever that was found.
JQ_LIB="$(dirname "$RUNNER_LIB")"

echo "=== $(date -Iseconds) sweep start: $WEEK ($MONDAY to $SUNDAY) ==="

SUBJECT="$WEEK Sweep"

RESULT_JSON="$WORK/result.json"
RESULT_RC="$WORK/result.rc"
SWEEP_JSON="$WORK/sweep.json"
REPORT_HTML="$WORK/email.html"

status="failure"
fail_reason=""
result=""
rc=0

# A failure is mailed in the same design as the board, from the shared
# library's failure page: the reason on top, the log's tail beneath it.
build_failure_html() {
    jq -rn -L "$JQ_LIB" --arg title "Sweep" --arg eyebrow "Job sweep · $WEEK" \
        --arg reason "${fail_reason:-unknown failure}" --rawfile tail <(tail -n 40 "$LOG") \
        'include "email"; failure_page($title; $eyebrow; $reason; $tail)' 2>/dev/null \
    || printf '<pre>%s\n\n%s</pre>' "$(printf '%s' "${fail_reason:-unknown failure}" | html_escape)" "$(tail -n 40 "$LOG" | html_escape)"
}

finish() {
    local body
    if [[ "$status" != "success" ]]; then
        echo "FAILED: ${fail_reason:-unknown failure}"
        body="$(build_failure_html)"
        printf '%s' "$body" > "$REPORT_HTML"
    else
        body="$(cat "$REPORT_HTML")"
    fi

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

    prompt="$(sed -e "s/{{WEEK}}/$WEEK/g" -e "s/{{MONDAY}}/$MONDAY/g" -e "s/{{SUNDAY}}/$SUNDAY/g" -e "s/{{TODAY}}/$(date +%F)/g" -e "s#{{WORK}}#$WORK#g" -e "s#{{EUDY}}#$EUDY#g" "$PROMPT_FILE")"
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
if ! jq -e '.subtype == "success" and .is_error == false' <<<"$result" >/dev/null; then
    fail_reason="claude did not complete: $(jq -r '.subtype // "unknown"' <<<"$result")"
    exit 1
fi

# The result is the JSON object the prompt asked for. Cut it out of whatever
# surrounds it (a code fence, prose the model wrote despite the brief), then
# require every key the renderer reads, with the right type.
raw="$(jq -r '.result // ""' <<<"$result")"
if [[ "$raw" == *"{"* && "$raw" == *"}"* ]]; then
    raw="{${raw#*\{}"
    raw="${raw%\}*}}"
fi
printf '%s\n' "$raw" > "$SWEEP_JSON"
if ! jq -e 'type == "object"
    and (.headline | type == "array") and (.lede | type == "string")
    and (.shortlist | type == "array") and (.fractional | type == "array")
    and (.rejected | type == "array") and (.sources | type == "array")
    and (.ledger | type == "array")' "$SWEEP_JSON" >/dev/null 2>&1; then
    fail_reason="the agent did not return the sweep shape: $(head -c 300 "$SWEEP_JSON")"
    exit 1
fi

usage="$(jq -r '"\(.num_turns // "?") turns; " + ((.modelUsage // {}) | to_entries | map("\(.key) in \(.value.inputTokens // 0) out \(.value.outputTokens // 0) cache read \(.value.cacheReadInputTokens // 0) write \(.value.cacheCreationInputTokens // 0)") | join("; "))' <<<"$result")"
echo "agent: sweep complete (cost $(jq -r '.total_cost_usd // "?"' <<<"$result") USD; $usage)"

# ---------- render ----------
# The footer is one quiet line: duration, cost, turns, the models that
# answered with their date suffixes dropped.
meta="$(jq -r '[
    (if .duration_ms then (.duration_ms / 1000 | floor) as $s
        | (if $s < 60 then "\($s)s"
           elif $s < 3600 then "\($s / 60 | floor)m \($s % 60 | tostring | if length < 2 then "0" + . else . end)s"
           else "\($s / 3600 | floor)h \(($s % 3600) / 60 | floor | tostring | if length < 2 then "0" + . else . end)m" end)
     else empty end),
    (if .total_cost_usd then "$" + (.total_cost_usd * 100 | round / 100 | tostring) else empty end),
    (if .num_turns then "\(.num_turns) turns" else empty end),
    ((.modelUsage // {}) | keys | map(sub("-20[0-9]{6}$"; "")) | join(", "))
  ] | map(select(. != "")) | join(" · ")' <<<"$result")"

if ! jq -r -L "$JQ_LIB" --arg week "$WEEK" --arg monday "$MONDAY" --arg sunday "$SUNDAY" --arg meta "$meta" -f "$RENDER" "$SWEEP_JSON" > "$REPORT_HTML" 2>"$WORK/render-stderr.txt" || [[ ! -s "$REPORT_HTML" ]]; then
    fail_reason="render failed: $(head -c 300 "$WORK/render-stderr.txt")"
    exit 1
fi
echo "render: $(wc -c < "$REPORT_HTML") bytes of html"
status="success"
