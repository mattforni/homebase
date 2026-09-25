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
# An entrypoint is three things of its own (the pulls, the prompt, the
# renderer) and calls the scaffold below for everything else: the work
# directory and the log, the week, the `claude -p` call with its retries, the
# draft cut out of the result, the footer line, the render through the shared
# email design, and the send with the failure page. Three runners each carried
# a copy of all of that before the scaffold existed (ATE-543, 2026-09-15), and
# the copies had already drifted: two artifact names, two failure pages, two
# meanings of SKIP_PULLS. Duplication by documentation is still duplication.

# ---------- environment ----------

# Usage: require VAR [VAR...]
# Sets fail_reason and returns non zero when any named variable is empty, so a
# run stops at the top rather than failing three pulls later with a 401.
#
# fail_reason is this function's out parameter: deliberately not `local`, and
# read by the EXIT trap, which puts the reason in the failure email. Static
# analysis cannot see a cross file read, so the assignment looks unused.
# shellcheck disable=SC2034
require() {
    local missing=() v
    for v in "$@"; do [[ -n "${!v:-}" ]] || missing+=("$v"); done
    if (( ${#missing[@]} > 0 )); then
        fail_reason="missing environment: ${missing[*]}"
        return 1
    fi
}

# Usage: require_tools NAME [NAME...]
# The same shape for commands on PATH. A missing tool is a failed run and not a
# degraded one; the 2026-08-31 pipeline outage was this check firing correctly
# on a PATH that lacked $HOME/bin.
require_tools() {
    local missing=() t
    for t in "$@"; do command -v "$t" &>/dev/null || missing+=("$t"); done
    if (( ${#missing[@]} > 0 )); then
        fail_reason="not on PATH: ${missing[*]} (PATH=$PATH)"
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

# Usage: week_bounds YYYY-Www
# Validates the week (the shape, and that the year has that many ISO weeks: W00
# and W99 parse, and week_monday would hand back a confident date in the wrong
# year rather than failing) and sets MONDAY, SUNDAY and NEXT_MONDAY. A year has
# 53 ISO weeks exactly when January 1st or December 31st falls on a Thursday.
week_bounds() {
    local week="$1" year number last=52
    if [[ ! "$week" =~ ^[0-9]{4}-W[0-9]{2}$ ]]; then
        echo "FATAL: WEEK must look like YYYY-Www, got \"$week\"" >&2
        return 1
    fi
    year="${week%-W*}"
    number="10#${week#*-W}"
    if [[ "$(day_of_week "$year-01-01")" == "4" || "$(day_of_week "$year-12-31")" == "4" ]]; then
        last=53
    fi
    if (( number < 1 || number > last )); then
        echo "FATAL: $year has $last ISO weeks, so $week is not one of them" >&2
        return 1
    fi
    MONDAY="$(week_monday "$week")"
    SUNDAY="$(shift_days "$MONDAY" 6)"
    NEXT_MONDAY="$(shift_days "$MONDAY" 7)"
    if [[ -z "$MONDAY" || -z "$SUNDAY" || -z "$NEXT_MONDAY" ]]; then
        echo "FATAL: could not resolve the week bounds for $week" >&2
        return 1
    fi
}

# ---------- html ----------

# Escapes &, < and > so untrusted text is safe inside element content. Not for
# unquoted attribute values: it does not touch quotes.
html_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

# ---------- resend ----------

# Usage: send_email <subject> <html-body> [attachment-path] [text-body]
# Without a text body Resend derives one from the html, which runs a table's
# labels and numbers together; a runner that renders its own passes it here.
# Reads RESEND_API_KEY, REPORT_RECIPIENT, and REPORT_SENDER from the
# environment. Prints what happened and returns non zero on any failure, so a
# caller can treat a failed delivery as a failed run.
send_email() {
    local subject="$1" body="$2" attachment="${3:-}" text="${4:-}"
    local sender="${REPORT_SENDER:-Claude <claude@atelic.me>}"

    if [[ -z "${RESEND_API_KEY:-}" || -z "${REPORT_RECIPIENT:-}" ]]; then
        echo "email: refusing to send without RESEND_API_KEY and REPORT_RECIPIENT"
        return 1
    fi

    # Every large value moves through a file, never an argument. Linux caps a
    # single argv string at 128 KB, and a full week's roster attached to its
    # rendered report blew past it: curl died with "Argument list too long"
    # and the report never left the container (plumber, 2026-09-25). So jq
    # reads the html, the text, and the attachment with --rawfile, and curl
    # sends the payload with --data-binary @file. Keep it that way for any
    # runner that mails through here.
    local tmp
    tmp="$(mktemp -d -t runner-resend.XXXXXX)" || { echo "email: mktemp failed"; return 1; }
    printf '%s' "$body" > "$tmp/html"
    printf '%s' "$text" > "$tmp/text"
    : > "$tmp/attachment"

    # An optional file rides along as an attachment, base64 on one line
    # (GNU base64 wraps at 76 columns unless told not to; BSD's never does).
    local attachment_name=""
    if [[ -n "$attachment" ]]; then
        if [[ ! -r "$attachment" ]]; then
            echo "email: attachment $attachment is not readable"
            rm -rf "$tmp"
            return 1
        fi
        attachment_name="$(basename "$attachment")"
        base64 < "$attachment" | tr -d '\n' > "$tmp/attachment" || {
            echo "email: could not encode the attachment"
            rm -rf "$tmp"
            return 1
        }
    fi
    jq -n --arg from "$sender" --arg to "$REPORT_RECIPIENT" --arg subject "$subject" \
        --arg name "$attachment_name" \
        --rawfile html "$tmp/html" --rawfile text "$tmp/text" --rawfile content "$tmp/attachment" \
        '{from: $from, to: [$to], subject: $subject, html: $html}
         + (if $text != "" then {text: $text} else {} end)
         + (if $name != "" then {attachments: [{filename: $name, content: $content}]} else {} end)' \
        > "$tmp/payload" || {
        echo "email: could not build the Resend payload"
        rm -rf "$tmp"
        return 1
    }

    local code
    code="$(curl -sS --max-time 60 -o "$tmp/resp" -w '%{http_code}' \
        -X POST https://api.resend.com/emails \
        -H "Authorization: Bearer $RESEND_API_KEY" \
        -H "Content-Type: application/json" \
        --data-binary @"$tmp/payload")"
    if [[ "$code" =~ ^2 ]]; then
        echo "email: sent \"$subject\" to $REPORT_RECIPIENT"
        rm -rf "$tmp"
        return 0
    fi
    echo "email: Resend returned HTTP $code: $(head -c 300 "$tmp/resp" 2>/dev/null)"
    rm -rf "$tmp"
    return 1
}

# ---------- the run's facts ----------

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

# Usage: meta_line <claude-result-json-file>
# The footer's one quiet line: duration, cost, turns, and the models that
# answered with their date suffixes dropped, joined by middots. Plain text; the
# renderer's footer() escapes it. bin/runner/render-local uses it too, so a
# local re-render carries the same line the run did.
meta_line() {
    local file="$1"
    [[ -s "$file" ]] || return 0
    jq -r '[
        (if .duration_ms then (.duration_ms / 1000 | floor) as $s
            | (if $s < 60 then "\($s)s"
               elif $s < 3600 then "\($s / 60 | floor)m \($s % 60 | tostring | if length < 2 then "0" + . else . end)s"
               else "\($s / 3600 | floor)h \(($s % 3600) / 60 | floor | tostring | if length < 2 then "0" + . else . end)m" end)
         else empty end),
        (if .total_cost_usd then "$" + (.total_cost_usd * 100 | round / 100 | tostring) else empty end),
        (if .num_turns then "\(.num_turns) turns" else empty end),
        ((.modelUsage // {}) | keys | map(sub("-20[0-9]{6}$"; "")) | join(", "))
      ] | map(select(. != "")) | join(" · ")' "$file" 2>/dev/null
}

# ---------- the scaffold ----------
# An entrypoint sources this file, then calls runner_init and gets a work
# directory, a log, a validated week, every file name, and an EXIT trap that
# mails the page or the failure. What it writes itself is its pulls, its
# prompt, and the arguments to claude; the scaffold handles the rest.

# Usage: runner_init <name> <Title> [current|previous]
# The name is the runner's directory name (retro, recruiter, pipeline), named
# explicitly because inside an image the entrypoint lives at /home/runner and
# its directory says nothing. Title is how the runner names itself everywhere
# a reader sees it: the subject ("2026-W38 Retro"), the masthead, the failure
# page. The third argument says which week is the default when WEEK is not
# set: the week in progress, or the week yesterday belonged to (the retro
# fires Sunday night about the week that is closing). Reads DRY_RUN, SKIP_PULLS,
# WORK and WEEK from the environment, and needs SELF_DIR (the entrypoint's
# own directory) and RUNNER_LIB (this file's path) set by the entrypoint's
# bootstrap. Sets:
#   RUNNER_NAME RUNNER_TITLE    the name and the title
#   WORK LOG                    the work directory and its log; stdout and
#                               stderr are tee'd into the log from here on
#   WEEK MONDAY SUNDAY NEXT_MONDAY
#   SUBJECT                     "$WEEK $Title"
#   RESULT_JSON RESULT_RC       the whole claude -p result and its exit status
#   DRAFT_JSON                  $WORK/<name>.json, the object the model returned
#   REPORT_HTML                 $WORK/email.html, what run-local opens and mail sends
#   REPORT_TEXT                 $WORK/email.txt, the plain text part when the
#                               runner renders one (runner_render_text)
#   ATTACHMENT                  empty; a runner sets it to a file to send along
#   PROMPT_FILE                 prompt.md beside the entrypoint
#   LIB_DIR                     the shared library (render.cjs, hubspot.mjs,
#                               text.mjs), wherever it was found
#   status fail_reason result rc
# and traps runner_finish on EXIT.
runner_init() {
    RUNNER_NAME="$1"
    RUNNER_TITLE="$2"
    local week_default="${3:-current}"

    DRY_RUN="${DRY_RUN:-0}"
    SKIP_PULLS="${SKIP_PULLS:-0}"

    # Checked rather than assumed. If either fails, the exec below sends the
    # whole run's output nowhere while the agent runs anyway and still costs
    # money, so this is the one place worth failing loudly before spending.
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

    if [[ -z "${WEEK:-}" ]]; then
        if [[ "$week_default" == "previous" ]]; then WEEK="$(previous_week)"; else WEEK="$(current_week)"; fi
    fi
    week_bounds "$WEEK" || exit 1

    SUBJECT="$WEEK $RUNNER_TITLE"
    RESULT_JSON="$WORK/result.json"
    # The exit status rides in its own file because the failure worth
    # replaying most often is a timeout, and a timeout leaves the result
    # empty. An empty file can carry no status, and its existence cannot be
    # trusted as the marker that a run happened either, so this one is.
    RESULT_RC="$WORK/result.rc"
    DRAFT_JSON="$WORK/$RUNNER_NAME.json"
    REPORT_HTML="$WORK/email.html"
    REPORT_TEXT="$WORK/email.txt"
    rm -f "$REPORT_TEXT"
    ATTACHMENT=""
    PROMPT_FILE="${PROMPT_FILE:-$SELF_DIR/prompt.md}"
    # The pull scripts and the bundled renderer sit beside this library,
    # wherever it was found: runners/lib in the repo, /home/runner/lib in an
    # image.
    LIB_DIR="$(dirname "$RUNNER_LIB")"

    status="failure"
    fail_reason=""
    result=""
    rc=0
    trap runner_finish EXIT

    # The banner shape is load bearing: run-local parses the week out of it so
    # a draft can be rendered again and mailed later without being told which
    # week it belongs to a second time.
    echo "=== $(date -Iseconds) $RUNNER_NAME start: $WEEK ($MONDAY to $SUNDAY) ==="
}

# The failure email, in the same design as the page: the reason on top, the
# log's tail beneath, rendered by the same bundle with the tail on stdin.
# Falls back to a bare <pre> if the renderer itself is what broke, which is
# the last thing standing between a broken renderer and no mail at all. The
# page is built whole before anything is printed, so a render that dies
# halfway cannot leave half a document above the <pre>. The renderer's own
# stderr is left alone: it lands in the log, which is the only place left to
# say why the failure page itself could not be drawn.
runner_failure_html() {
    local bundle page
    if bundle="$(runner_renderer_bundle)" && page="$(tail -n 40 "$LOG" | node "$bundle" failure html \
        --title "$RUNNER_TITLE" --eyebrow "$RUNNER_TITLE · $WEEK" \
        --reason "${fail_reason:-unknown failure}")" && [[ -n "$page" ]]; then
        printf '%s\n' "$page"
        return 0
    fi
    printf '<pre>%s\n\n%s</pre>' "$(printf '%s' "${fail_reason:-unknown failure}" | html_escape)" "$(tail -n 40 "$LOG" | html_escape)"
}

# The EXIT trap. Mails the rendered page (with ATTACHMENT beside it when the
# runner set one), or the failure page; a dry run prints where the page is
# instead. A failed delivery is a failed run: nobody is watching, so the exit
# status and the log are the only places left that could show it. The sleeps
# let the tee behind stdout flush before a container exits, or the last lines
# never reach the Cloud Run log.
runner_finish() {
    local body attachment="" text=""
    if [[ "$status" != "success" ]]; then
        echo "FAILED: ${fail_reason:-unknown failure}"
        body="$(runner_failure_html)"
        printf '%s' "$body" > "$REPORT_HTML"
        # What the model returned rides beside the failure page: the draft
        # when it was cut, else the raw result. A failure after the model has
        # answered (an upsert, a render) would otherwise lose the only copy,
        # since a cloud execution's work directory is gone when it ends; with
        # the file in the mail, runner_replay or render-local can pick the run
        # back up without paying for the agent again (2026-09-23).
        if [[ -n "${DRAFT_JSON:-}" && -s "$DRAFT_JSON" ]]; then
            attachment="$DRAFT_JSON"
        elif [[ -n "${RESULT_JSON:-}" && -s "$RESULT_JSON" ]]; then
            attachment="$RESULT_JSON"
        fi
    else
        body="$(cat "$REPORT_HTML")"
        [[ -s "$REPORT_TEXT" ]] && text="$(cat "$REPORT_TEXT")"
        [[ -n "$ATTACHMENT" && -s "$ATTACHMENT" ]] && attachment="$ATTACHMENT"
    fi

    if [[ "$DRY_RUN" == "1" ]]; then
        echo "dry run: subject \"$SUBJECT\""
        echo "dry run: rendered $REPORT_HTML${text:+ and $REPORT_TEXT}${attachment:+, with $attachment attached}"
        sleep 1
        [[ "$status" == "success" ]] || exit 1
        return
    fi

    send_email "$SUBJECT" "$body" "$attachment" "$text" || {
        echo "email: the report could not be delivered"
        sleep 1
        exit 1
    }
    sleep 1
    [[ "$status" == "success" ]] || exit 1
}

# Usage: google_access_token <authorized_user json>
# An access token minted from a gws profile's exported authorized_user JSON
# (client id, client secret, refresh token), which is how a container reads a
# mailbox or a Doc without the per machine credentials.enc. Prints the token;
# on failure prints nothing and sets fail_reason with the error body, minus the
# token fields.
google_access_token() {
    local resp access
    resp="$(curl -sS --max-time 30 -X POST https://oauth2.googleapis.com/token \
        -d client_id="$(jq -r .client_id <<<"$1")" \
        -d client_secret="$(jq -r .client_secret <<<"$1")" \
        -d refresh_token="$(jq -r .refresh_token <<<"$1")" \
        -d grant_type=refresh_token)"
    access="$(jq -r '.access_token // empty' <<<"$resp")"
    if [[ -z "$access" ]]; then
        fail_reason="Google token refresh failed: $(jq -c 'del(.access_token)' <<<"$resp" 2>/dev/null | head -c 300)"
        return 1
    fi
    printf '%s' "$access"
}

# Usage: fill_prompt <file>
# The prompt with its placeholders filled: {{WEEK}}, {{MONDAY}}, {{SUNDAY}},
# {{NEXT_MONDAY}}, {{TODAY}}, {{WORK}}, and any of EUDY, PULLS and ATELIC the
# runner has set. A runner names the checkout and the pulled files this way
# rather than carrying paths in the brief, so the brief reads the same in the
# image and on this machine.
fill_prompt() {
    local file="$1" v val args=()
    TODAY="$(date +%F)"
    for v in WEEK MONDAY SUNDAY NEXT_MONDAY TODAY WORK EUDY PULLS ATELIC TEXT; do
        val="${!v:-}"
        [[ -n "$val" ]] || continue
        val="$(printf '%s' "$val" | sed -e 's/[|&\\]/\\&/g')"
        args+=(-e "s|{{$v}}|$val|g")
    done
    sed "${args[@]}" "$file"
}

# Usage: runner_claude <prompt> [claude -p arguments...]
# One headless call with the retry the long sessions need: `claude -p` can die
# mid stream and exit non zero, and a timeout or a transient API error is
# worth one more attempt, while anything else is a real failure reported as
# one rather than a second agent run burned on it. The result and its exit
# status are saved on every attempt, successes and failures alike, so a replay
# can put the very same JSON back through the reporting path. Sets result and
# rc; sets fail_reason and returns non zero when the call did not complete.
# ATTEMPT_TIMEOUT, MAX_ATTEMPTS and RETRY_BACKOFF_SECONDS come from the
# environment when a runner needs other values.
runner_claude() {
    local prompt="$1"; shift
    local stderr_file="$WORK/claude-stderr.txt" attempt=1 transient
    local attempt_timeout="${ATTEMPT_TIMEOUT:-45m}" max_attempts="${MAX_ATTEMPTS:-2}" backoff="${RETRY_BACKOFF_SECONDS:-15}"
    local transient_re='socket connection was closed|API Error|overloaded|Connection error|terminated'
    while :; do
        echo "=== $(date -Iseconds) claude attempt $attempt/$max_attempts (timeout $attempt_timeout) ==="
        result="$(timeout "$attempt_timeout" claude -p "$prompt" "$@" --output-format json 2>"$stderr_file")"
        rc=$?
        [[ $rc -eq 0 ]] && break

        transient=false
        if [[ $rc -eq 124 ]]; then
            transient=true
            echo "attempt $attempt timed out after $attempt_timeout"
        elif { printf '%s' "$result"; cat "$stderr_file" 2>/dev/null; } | grep -qiE "$transient_re"; then
            transient=true
            echo "attempt $attempt hit a transient API error (exit $rc)"
        fi

        if [[ "$transient" == true && $attempt -lt $max_attempts ]]; then
            echo "retrying in ${backoff}s"
            attempt=$((attempt + 1))
            sleep "$backoff"
            continue
        fi
        break
    done

    printf '%s' "$result" > "$RESULT_JSON"
    printf '%s' "$rc" > "$RESULT_RC"
    runner_check_result
}

# Usage: runner_probe_write [claude -p arguments...]
# A one line Haiku call with the same agent and allowlist the real call will
# get, asked only to write a marker file into the work directory. Seconds and
# about a cent, run before the expensive call, so an agent that cannot write
# fails here rather than after drafting a whole week (the first pipeline run
# in its image, 2026-09-15: the agent's definition listed no Write tool, the
# allowlist's Write($WORK/*) granted nothing, and the roster check failed
# after 18 minutes and 11 USD). Sets fail_reason and returns non zero when
# the marker does not appear.
runner_probe_write() {
    local marker="$WORK/.write-probe" out
    rm -f "$marker"
    out="$(timeout 3m claude -p "Write the single word ok to the file $marker using the Write tool, then reply with the word done. Do nothing else." \
        --model haiku --output-format json "$@" 2>"$WORK/probe-stderr.txt")"
    if [[ ! -s "$marker" ]]; then
        fail_reason="the write probe failed: the agent could not write $marker (denials: $(jq -r '.permission_denials // [] | map(.tool_name) | unique | join(", ")' <<<"$out" 2>/dev/null); $(head -c 200 "$WORK/probe-stderr.txt"))"
        return 1
    fi
    rm -f "$marker"
    echo "probe: the agent can write into $WORK ($(jq -r '.total_cost_usd // "?"' <<<"$out" 2>/dev/null) USD)"
}

# Usage: runner_replay
# The saved result and its saved exit status, back through the same checks, so
# a runner whose only "pull" is the agent itself (the pipeline runner) can
# render again without paying for the agent. Both halves come back, so a saved
# failure replays as that failure rather than as a success that fails a
# predicate a moment later.
runner_replay() {
    if [[ ! -f "$RESULT_RC" ]]; then
        fail_reason="SKIP_PULLS is set but no saved run is in $WORK; run once without it"
        return 1
    fi
    result="$(cat "$RESULT_JSON" 2>/dev/null)" || result=""
    rc="$(cat "$RESULT_RC")"
    [[ "$rc" =~ ^[0-9]+$ ]] || rc=1
    echo "claude: replaying the run saved in $WORK (exit $rc)"
    runner_check_result
}

# The three things a result has to be before it is trusted: exit zero, JSON,
# and a completed turn. Exit zero alone is not enough: `claude -p` answers an
# unknown agent with exit 0 and "Unknown skill" as text. Permission denials are
# logged here so a failure page's log tail carries them.
runner_check_result() {
    if [[ $rc -ne 0 ]]; then
        fail_reason="claude exited $rc: $(head -c 400 "$WORK/claude-stderr.txt" 2>/dev/null)"
        return 1
    fi
    if ! jq -e . <<<"$result" >/dev/null 2>"$WORK/jq-stderr.txt"; then
        fail_reason="the agent returned output that is not JSON: $(head -c 300 <<<"$result")"
        return 1
    fi
    local denials
    # One line per denial, each cut to 200 characters, so a long first denial
    # never hides the rest (a single 400 character cut showed two of them on
    # the 2026-09-22 recruiter run).
    denials="$(jq -r '.permission_denials // [] | .[] | "\(.tool_name // "?"): \(.tool_input // .reason // "?" | tostring | gsub("\n"; " ") | .[0:200])"' <<<"$result")"
    [[ -z "$denials" ]] || echo "claude: $(wc -l <<<"$denials" | tr -d ' ') permission denials:"$'\n'"$(sed 's/^/  denied /' <<<"$denials")"
    if ! jq -e '.subtype == "success" and .is_error == false' <<<"$result" >/dev/null; then
        fail_reason="claude did not complete: $(jq -r '.subtype // "unknown"' <<<"$result")"
        return 1
    fi
    local usage
    usage="$(jq -r '"\(.num_turns // "?") turns; " + ((.modelUsage // {}) | to_entries | map("\(.key) in \(.value.inputTokens // 0) out \(.value.outputTokens // 0) cache read \(.value.cacheReadInputTokens // 0) write \(.value.cacheCreationInputTokens // 0)") | join("; "))' <<<"$result")"
    echo "claude: complete (cost $(jq -r '.total_cost_usd // "?"' <<<"$result") USD; $usage)"
}

# Usage: runner_draft <jq test>
# The object the prompt asked for, cut out of the result (a code fence, or
# prose the model wrote before it despite the brief, are tolerated) and
# written to DRAFT_JSON, then held to the shape the renderer reads: the test
# is a jq expression over the object that must be true, naming every key with
# its type, so a missing key or a wrong type is a failed run here rather than
# a broken email later.
runner_draft() {
    local test="$1" raw
    raw="$(jq -r '.result // ""' <<<"$result")"
    if [[ "$raw" == *"{"* && "$raw" == *"}"* ]]; then
        raw="{${raw#*\{}"
        raw="${raw%\}*}}"
    fi
    printf '%s\n' "$raw" > "$DRAFT_JSON"
    if ! jq -e "type == \"object\" and ($test)" "$DRAFT_JSON" >/dev/null 2>&1; then
        fail_reason="the agent did not return the $RUNNER_NAME shape: $(head -c 300 "$DRAFT_JSON")"
        return 1
    fi
}

# ---------- the renderer ----------
# The page is rendered by the bundled node renderer (runners/email), which is
# the same email design as one React component library shared with every other
# surface the practice builds. It is the only renderer: the jq one it replaced
# retired on 2026-09-22 (ATE-563) once both scheduled runners had come back
# clean on the node path, so a renderer that cannot start is now a failed run
# rather than a plainer email. Only the failure page still has a fallback, a
# bare <pre>, because that one mails at the moment everything else is already
# broken. The four jq files are in git history, last carried at 4985f1a9.

# Where the node bundle is: beside the shared library in an image, in the
# repo's own build on this machine. The same two places, in the same order,
# that an entrypoint looks for runner.sh itself.
runner_renderer_bundle() {
    local candidate
    for candidate in "$LIB_DIR/render.cjs" "$LIB_DIR/../email/dist/render.cjs"; do
        if [[ -r "$candidate" ]]; then
            printf '%s' "$candidate"
            return 0
        fi
    done
    return 1
}

# Usage: runner_render_node <html|text> <out-file> <stderr-file> <meta>
# One pass of the node renderer. Prints a loud line and returns non zero on
# anything short of a non empty file, so the caller can say so and stop.
#
# renderer_error is this function's out parameter, deliberately not `local`:
# the reason has to reach the caller's fail_reason and so the failure email,
# and the stderr file cannot carry it, since a missing bundle returns before
# anything is ever redirected into that file.
# shellcheck disable=SC2034
runner_render_node() {
    local format="$1" out="$2" errors="$3" meta="$4" bundle
    renderer_error=""
    if ! bundle="$(runner_renderer_bundle)"; then
        renderer_error="no node bundle at $LIB_DIR/render.cjs or $LIB_DIR/../email/dist/render.cjs"
        echo "RENDERER: $renderer_error"
        return 1
    fi
    if ! node "$bundle" "$RUNNER_NAME" "$format" \
        --week "$WEEK" --monday "$MONDAY" --sunday "$SUNDAY" --meta "$meta" \
        < "$DRAFT_JSON" > "$out" 2>"$errors"; then
        renderer_error="the node $format render failed: $(head -c 300 "$errors" 2>/dev/null)"
        echo "RENDERER: $renderer_error"
        return 1
    fi
    if [[ ! -s "$out" ]]; then
        renderer_error="the node $format render wrote nothing to $out"
        echo "RENDERER: $renderer_error"
        return 1
    fi
}

# Usage: runner_render
# DRAFT_JSON into REPORT_HTML, through the node renderer with the week and the
# footer line. A render that cannot run fails the run: the reason is already on
# a RENDERER line in the log, and fail_reason carries it into the failure page.
runner_render() {
    local meta
    meta="$(meta_line "$RESULT_JSON")"
    if ! runner_render_node html "$REPORT_HTML" "$WORK/render-stderr.txt" "$meta"; then
        fail_reason="render failed: $renderer_error"
        return 1
    fi
    echo "render: $(wc -c < "$REPORT_HTML" | tr -d ' ') bytes of html"
}

# Usage: runner_render_text
# The email's plain text part, into REPORT_TEXT. The node renderer writes one
# for every runner, so a failure here is a failure of the run rather than an
# email that quietly goes out as html alone.
runner_render_text() {
    local meta
    meta="$(meta_line "$RESULT_JSON")"
    if ! runner_render_node text "$REPORT_TEXT" "$WORK/render-text-stderr.txt" "$meta"; then
        fail_reason="plain text render failed: $renderer_error"
        return 1
    fi
    echo "render: $(wc -c < "$REPORT_TEXT" | tr -d ' ') bytes of text"
}
