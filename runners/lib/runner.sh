# shellcheck shell=bash
# The entrypoint side of the runner infrastructure, sourced by every
# runners/<name>/entrypoint.sh.
#
# Everything here is pure with respect to the environment: it reads variables
# and writes files, and it never touches the Keychain, ~/.config, gcloud, or
# anything else that exists only on Forni's Mac. That is the whole boundary.
# An entrypoint runs unchanged in three places (by hand, under launchd, and in
# a Cloud Run container), and the only reason that works is that the entrypoint
# never learns which one it is in. Whoever invokes it puts the secrets in the
# environment first: bin/runner/run-scheduled and bin/runner/run-local do that
# from this machine's vaults, and Cloud Run does it from Secret Manager.
#
# The driver side, which does know about this Mac, is bin/runner/lib.sh.
#
# Three things lived in two copies before this file existed: the Resend send
# (bin/lib/email-report.sh and runners/retro/entrypoint.sh), html_escape (the
# same sed, twice), and the GNU versus BSD date shims, which existed once and
# were spread by a line in runners/README.md telling the next author to copy
# them. Duplication by documentation is still duplication.

# ---------- environment ----------

# Usage: require VAR [VAR...]
# Sets fail_reason and returns non zero when any named variable is empty, so a
# run stops at the top rather than failing three pulls later with a 401.
#
# fail_reason is this function's out parameter: deliberately not `local`, and
# read by the caller's own EXIT trap, which puts the reason in the failure
# email. Static analysis cannot see a cross file read, so the assignment looks
# unused. Same shape, and same reason, as email_error in the retired
# bin/lib/email-report.sh.
# shellcheck disable=SC2034
require() {
    local missing=() v
    for v in "$@"; do [[ -n "${!v:-}" ]] || missing+=("$v"); done
    if (( ${#missing[@]} > 0 )); then
        fail_reason="missing environment: ${missing[*]}"
        return 1
    fi
}

# ---------- dates ----------
# The container carries GNU date; a local run on macOS gets BSD date, which
# cannot read GNU's relative expressions at all. One implementation each way,
# so week math is written once and reads the same in both places. BSD's -f
# leaves unspecified fields at their current value, which is why midnight has
# to name its seconds. Every one of them reads the local clock, and a runner
# image pins TZ, so a day is a Denver day and yesterday is Denver's yesterday.
if date -d 2026-01-04 +%F >/dev/null 2>&1; then
    day_of_week()    { date -d "$1" +%u; }
    shift_days()     { date -d "$1 $2 days" +%F; }
    midnight_epoch() { date -d "$1 00:00" +%s; }
    previous_week()  { date -d yesterday +%G-W%V; }
else
    day_of_week()    { date -j -f %Y-%m-%d "$1" +%u; }
    shift_days()     { local off="$2"; [[ "$off" == -* ]] || off="+$off"; date -j -v"${off}d" -f %Y-%m-%d "$1" +%F; }
    midnight_epoch() { date -j -f '%Y-%m-%d %H:%M:%S' "$1 00:00:00" +%s; }
    previous_week()  { date -v-1d +%G-W%V; }
fi

current_week() { date +%G-W%V; }

# Usage: week_monday YYYY-Www
# The Monday of an ISO week, by ISO's own definition: week 1 is the one
# containing January 4th. Written on top of the shims above so it needs no
# second implementation of its own.
week_monday() {
    local week="$1" iso_year iso_week jan4_dow w1
    iso_year="${week%-W*}"
    iso_week="${week#*-W}"
    jan4_dow="$(day_of_week "${iso_year}-01-04")"
    w1="$(shift_days "${iso_year}-01-04" "-$((jan4_dow - 1))")"
    shift_days "$w1" "$(( (10#$iso_week - 1) * 7 ))"
}

# ---------- html ----------

# Escapes &, < and > so untrusted text is safe inside element content. Not for
# unquoted attribute values: it does not touch quotes.
html_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

# ---------- resend ----------

# Usage: send_email <subject> <html-body>
# Reads RESEND_API_KEY, REPORT_RECIPIENT, and REPORT_SENDER from the
# environment. Prints what happened and returns non zero on any failure, so a
# caller can treat a failed delivery as a failed run.
send_email() {
    local subject="$1" body="$2"
    local sender="${REPORT_SENDER:-Claude <claude@atelic.me>}"

    if [[ -z "${RESEND_API_KEY:-}" || -z "${REPORT_RECIPIENT:-}" ]]; then
        echo "email: refusing to send without RESEND_API_KEY and REPORT_RECIPIENT"
        return 1
    fi

    local payload
    payload="$(jq -n --arg from "$sender" --arg to "$REPORT_RECIPIENT" \
        --arg subject "$subject" --arg html "$body" \
        '{from: $from, to: [$to], subject: $subject, html: $html}')" || {
        echo "email: could not build the Resend payload"
        return 1
    }

    local resp code
    resp="$(mktemp -t runner-resend.XXXXXX)" || { echo "email: mktemp failed"; return 1; }
    code="$(curl -sS --max-time 30 -o "$resp" -w '%{http_code}' \
        -X POST https://api.resend.com/emails \
        -H "Authorization: Bearer $RESEND_API_KEY" \
        -H "Content-Type: application/json" \
        -d "$payload")"
    if [[ "$code" =~ ^2 ]]; then
        echo "email: sent \"$subject\" to $REPORT_RECIPIENT"
        rm -f "$resp"
        return 0
    fi
    echo "email: Resend returned HTTP $code: $(head -c 300 "$resp")"
    rm -f "$resp"
    return 1
}

# ---------- the status report body ----------
# A runner that renders its own document (the retro) builds its body with a
# renderer and never calls these. A runner whose email is a status report on an
# agent run (the outreach roster) gets its whole body from the three below, so
# no runner has to grow its own HTML.

# Usage: format_duration <milliseconds>
# 42s, 12m 05s, or 1h 07m: a run's wall clock as a person reads it. Thousands
# of seconds say nothing at a glance (Forni, 2026-09-11).
format_duration() {
    local ms="$1" s
    [[ "$ms" =~ ^[0-9]+$ ]] || { printf '%s' "$ms"; return; }
    s=$(( ms / 1000 ))
    if (( s < 60 )); then
        printf '%ds' "$s"
    elif (( s < 3600 )); then
        printf '%dm %02ds' $(( s / 60 )) $(( s % 60 ))
    else
        printf '%dh %02dm' $(( s / 3600 )) $(( (s % 3600) / 60 ))
    fi
}

# Usage: build_meta_line <claude-json> <exit-code>
# The run's facts on one quiet footer line: duration, cost, turns, the models
# that answered, and the exit code only when it is not zero.
build_meta_line() {
    local result_json="$1" rc="$2"
    local duration_ms cost turns models parts=() line="" p
    duration_ms="$(jq -r '.duration_ms // empty' <<<"$result_json" 2>/dev/null)"
    cost="$(jq -r '.total_cost_usd // empty' <<<"$result_json" 2>/dev/null)"
    turns="$(jq -r '.num_turns // empty' <<<"$result_json" 2>/dev/null)"
    models="$(jq -r '(.modelUsage // {}) | keys | join(", ")' <<<"$result_json" 2>/dev/null)"
    [[ -n "$duration_ms" ]] && parts+=("$(format_duration "$duration_ms")")
    [[ -n "$cost" ]] && parts+=("$(awk -v c="$cost" 'BEGIN { printf "$%.2f", c }')")
    [[ -n "$turns" ]] && parts+=("$turns turns")
    [[ -n "$models" ]] && parts+=("$models")
    [[ "$rc" -eq 0 ]] || parts+=("exit $rc")
    for p in "${parts[@]}"; do
        [[ -z "$line" ]] && line="$p" || line="$line · $p"
    done
    printf '<p style="margin:16px 0 0 0;font-size:12px;color:#888;">%s</p>' "$(printf '%s' "$line" | html_escape)"
}

# Usage: build_meta_block <claude-json> <exit-code>
# The run metadata table: duration, cost, turns, exit code, session id.
build_meta_block() {
    local result_json="$1" rc="$2"
    local duration_ms cost turns session duration_s="" cost_fmt="" rows=""
    duration_ms="$(jq -r '.duration_ms // empty' <<<"$result_json" 2>/dev/null)"
    cost="$(jq -r '.total_cost_usd // empty' <<<"$result_json" 2>/dev/null)"
    turns="$(jq -r '.num_turns // empty' <<<"$result_json" 2>/dev/null)"
    session="$(jq -r '.session_id // empty' <<<"$result_json" 2>/dev/null)"
    [[ -n "$duration_ms" ]] && duration_s="$(format_duration "$duration_ms")"
    [[ -n "$cost" ]] && cost_fmt="$(awk -v c="$cost" 'BEGIN { printf "$%.4f", c }')"
    [[ -n "$duration_s" ]] && rows+="<tr><td style=\"padding:2px 12px 2px 0;color:#888;\">duration</td><td style=\"padding:2px 0;\">$duration_s</td></tr>"
    [[ -n "$cost_fmt" ]] && rows+="<tr><td style=\"padding:2px 12px 2px 0;color:#888;\">cost</td><td style=\"padding:2px 0;\">$cost_fmt</td></tr>"
    [[ -n "$turns" ]] && rows+="<tr><td style=\"padding:2px 12px 2px 0;color:#888;\">turns</td><td style=\"padding:2px 0;\">$turns</td></tr>"
    rows+="<tr><td style=\"padding:2px 12px 2px 0;color:#888;\">exit code</td><td style=\"padding:2px 0;\">$rc</td></tr>"
    [[ -n "$session" ]] && rows+="<tr><td style=\"padding:2px 12px 2px 0;color:#888;\">session</td><td style=\"padding:2px 0;font-family:ui-monospace,Menlo,monospace;font-size:11px;\">$session</td></tr>"
    printf '<table style="border-collapse:collapse;font-size:12px;color:#444;margin-top:16px;">%s</table>' "$rows"
}

# Usage: build_summary_block <claude-json> <exit-code> <expected-substring>
# The scannable block above the fold: the first line of a successful result, or
# the likeliest reason plus the tail of the output and any permission denials
# on a failure. A reader should not have to expand anything to know what
# happened.
build_summary_block() {
    local result_json="$1" rc="$2" expected_pattern="$3"
    local subtype is_error err_field result_text denials_count out="" is_success=false
    subtype="$(jq -r '.subtype // empty' <<<"$result_json" 2>/dev/null)"
    is_error="$(jq -r '.is_error // false' <<<"$result_json" 2>/dev/null)"
    err_field="$(jq -r '.error // empty' <<<"$result_json" 2>/dev/null)"
    result_text="$(jq -r '.result // empty' <<<"$result_json" 2>/dev/null)"
    denials_count="$(jq -r '.permission_denials // [] | length' <<<"$result_json" 2>/dev/null)"
    [[ -z "$denials_count" ]] && denials_count=0

    if [[ "$rc" -eq 0 ]] && [[ "$subtype" == "success" ]] && [[ "$is_error" == "false" ]]; then
        if [[ -z "$expected_pattern" ]] || printf '%s' "$result_text" | grep -qF -- "$expected_pattern"; then
            is_success=true
        fi
    fi

    if [[ "$is_success" == "true" ]]; then
        local first_line
        first_line="$(printf '%s' "$result_text" | awk 'NF {print; exit}')"
        [[ -z "$first_line" ]] && first_line="Completed."
        out+="<div style=\"background:#e8f5e9;border-left:4px solid #43a047;padding:10px 14px;border-radius:4px;margin:0 0 12px 0;\"><strong style=\"color:#1b5e20;\">$(printf '%s' "$first_line" | html_escape)</strong></div>"
        printf '%s' "$out"
        return 0
    fi

    local reason=""
    if [[ "$rc" -ne 0 ]]; then
        reason="Process exit $rc"
    elif [[ -n "$err_field" ]]; then
        reason="$(printf '%s' "$err_field" | tr '\n' ' ' | head -c 200)"
    elif [[ "$is_error" == "true" ]]; then
        reason="is_error=true in result JSON"
    elif [[ -n "$subtype" && "$subtype" != "success" ]]; then
        reason="subtype=$subtype"
    elif [[ -n "$expected_pattern" ]]; then
        reason="missing expected pattern: $expected_pattern"
    else
        reason="unknown failure"
    fi
    out+="<div style=\"background:#ffebee;border-left:4px solid #c62828;padding:10px 14px;border-radius:4px;margin:0 0 12px 0;\"><strong style=\"color:#b71c1c;\">$(printf '%s' "$reason" | html_escape)</strong></div>"

    if [[ -n "$result_text" ]]; then
        local tail_lines
        tail_lines="$(printf '%s' "$result_text" | awk 'NF' | tail -n 8)"
        if [[ -n "$tail_lines" ]]; then
            out+="<p style=\"margin:0 0 4px 0;font-size:12px;color:#666;\"><strong>Last lines of output</strong></p>"
            out+="<pre style=\"background:#fff5f5;border-left:3px solid #ef5350;padding:10px 12px;border-radius:0 4px 4px 0;font-size:12px;line-height:1.4;overflow-x:auto;white-space:pre-wrap;margin:0 0 12px 0;\">$(printf '%s' "$tail_lines" | html_escape)</pre>"
        fi
    fi

    if [[ "$denials_count" -gt 0 ]]; then
        local denials_list
        denials_list="$(jq -r '.permission_denials[] | "\(.tool_name // "?"): \(.tool_input // .reason // "?" | tostring)"' <<<"$result_json" 2>/dev/null)"
        out+="<p style=\"margin:0 0 4px 0;font-size:12px;color:#666;\"><strong>Permission denials ($denials_count)</strong></p>"
        out+="<pre style=\"background:#fff8e1;border-left:3px solid #ffa000;padding:10px 12px;border-radius:0 4px 4px 0;font-size:12px;line-height:1.4;overflow-x:auto;white-space:pre-wrap;margin:0 0 12px 0;\">$(printf '%s' "$denials_list" | html_escape)</pre>"
    fi

    printf '%s' "$out"
}

# Usage: build_report_html <heading> <status> <summary-html> <full-text> <meta-html>
# Assembles the status email and writes it to stdout, sending nothing. Kept
# separate from send_email so a dry run renders exactly what a real run would
# mail, which is the cheap half of the local loop.
build_report_html() {
    local heading="$1" status="$2" summary_html="$3" full_text="$4" meta_block_html="$5"
    local emoji full_html=""
    if [[ "$status" == "success" ]]; then emoji="✅"; else emoji="❌"; fi
    if [[ -n "$full_text" ]]; then
        full_html="<details style=\"margin:0 0 12px 0;\"><summary style=\"cursor:pointer;color:#666;font-size:12px;padding:4px 0;\">Full output</summary><pre style=\"background:#f5f5f7;padding:12px;border-radius:6px;font-size:12px;line-height:1.4;overflow-x:auto;white-space:pre-wrap;margin:8px 0 0 0;\">$(printf '%s' "$full_text" | html_escape)</pre></details>"
    fi
    printf '%s' "<!DOCTYPE html><html><body style=\"font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:14px;color:#1d1d1f;line-height:1.5;\">
<h2 style=\"margin:0 0 8px 0;font-size:18px;\">$emoji $(printf '%s' "$heading" | html_escape) — $(date '+%Y-%m-%d %H:%M')</h2>
$summary_html
$full_html
$meta_block_html
</body></html>"
}
