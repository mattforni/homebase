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
    upcoming_week()  { date -d tomorrow +%G-W%V; }
else
    day_of_week()    { date -j -f %Y-%m-%d "$1" +%u; }
    shift_days()     { local off="$2"; [[ "$off" == -* ]] || off="+$off"; date -j -v"${off}d" -f %Y-%m-%d "$1" +%F; }
    midnight_epoch() { date -j -f '%Y-%m-%d %H:%M:%S' "$1 00:00:00" +%s; }
    previous_week()  { date -v-1d +%G-W%V; }
    upcoming_week()  { date -v+1d +%G-W%V; }
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

# Usage: runner_init <name> <Title> [current|previous|upcoming]
# The name is the runner's directory name (brief, recruiter, plumber), named
# explicitly because inside an image the entrypoint lives at /home/runner and
# its directory says nothing. Title is how the runner names itself everywhere
# a reader sees it: the subject ("2026-W38 Brief"), the masthead, the failure
# page. The third argument says which week is the default when WEEK is not
# set: the week in progress, the week yesterday belonged to (the brief
# fires on a week's last night, about the week that is closing), or the week
# tomorrow belongs to (the plumber and the recruiter fire on that same night
# to prepare the week that opens in the morning; on any other day that is
# the week in progress). Reads DRY_RUN, SKIP_PULLS,
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
#   LIB_DIR                     the shared library (render.cjs, text.mjs),
#                               wherever it was found
#   status fail_reason result rc
#   fail_step fail_fix          empty; what failed, as a short label, and what
#                               to do about it, set beside fail_reason where
#                               the cause is known. The failure page shows
#                               them as What Failed and What to Do around the
#                               reason. Whoever sets fail_step sets fail_fix
#                               too (empty when there is nothing to say), and
#                               a caller that swallows a failure and clears
#                               fail_reason clears both of them with it.
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
        case "$week_default" in
            previous) WEEK="$(previous_week)" ;;
            upcoming) WEEK="$(upcoming_week)" ;;
            current)  WEEK="$(current_week)" ;;
            *)        echo "runner_init: unknown week default '$week_default' (current, previous, or upcoming)" >&2; exit 1 ;;
        esac
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
    fail_step=""
    fail_fix=""
    result=""
    rc=0
    trap runner_finish EXIT

    # The banner shape is load bearing: run-local parses the week out of it so
    # a draft can be rendered again and mailed later without being told which
    # week it belongs to a second time.
    echo "=== $(date -Iseconds) $RUNNER_NAME start: $WEEK ($MONDAY to $SUNDAY) ==="
}

# The failure email, in the same design as the page: what failed, why, and
# what to do on top, the log's tail beneath, rendered by the same bundle with
# the tail on stdin. The step and the fix ride only when they are set, and
# with neither the page is the reason and the log as it always was. Falls
# back to a bare <pre> if the renderer itself is what broke, which is the
# last thing standing between a broken renderer and no mail at all, and the
# <pre> carries the same facts. The page is built whole before anything is
# printed, so a render that dies halfway cannot leave half a document above
# the <pre>. The renderer's own stderr is left alone: it lands in the log,
# which is the only place left to say why the failure page itself could not
# be drawn.
runner_failure_html() {
    local bundle page facts reason="${fail_reason:-unknown failure}"
    local args=(--title "$RUNNER_TITLE" --eyebrow "$RUNNER_TITLE · $WEEK" --reason "$reason")
    [[ -n "${fail_step:-}" ]] && args+=(--step "$fail_step")
    [[ -n "${fail_fix:-}" ]] && args+=(--fix "$fail_fix")
    if bundle="$(runner_renderer_bundle)" && page="$(tail -n 40 "$LOG" | node "$bundle" failure html "${args[@]}")" \
        && [[ -n "$page" ]]; then
        printf '%s\n' "$page"
        return 0
    fi
    facts="$reason"
    if [[ -n "${fail_step:-}" || -n "${fail_fix:-}" ]]; then
        local nl=$'\n'
        facts="${fail_step:+What Failed: $fail_step$nl}Why: $reason${fail_fix:+${nl}What to Do: $fail_fix}"
    fi
    printf '<pre>%s\n\n%s</pre>' "$(printf '%s' "$facts" | html_escape)" "$(tail -n 40 "$LOG" | html_escape)"
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
# on failure prints nothing on stdout, sets fail_reason, and writes the same
# reason to stderr: what Google answered, minus the token fields, or what curl
# said when nothing answered. A caller that takes the token through $(...)
# never sees fail_reason, since a command substitution is its own shell, which
# is why google_token_into below is the way to call this.
#
# The form body goes to curl on stdin, never as arguments: an argument is
# readable by anyone who can list processes, and the body carries the client
# secret and the refresh token. jq builds it, encoding each value as a form
# field, and nothing that holds a credential is ever on a command line.
google_access_token() {
    local resp access curl_err why
    curl_err="$(mktemp)"
    resp="$(jq -r '@uri "client_id=\(.client_id)&client_secret=\(.client_secret)&refresh_token=\(.refresh_token)&grant_type=refresh_token"' <<<"$1" 2>/dev/null \
        | curl -sS --max-time 30 -X POST https://oauth2.googleapis.com/token --data-binary @- 2>"$curl_err")"
    access="$(jq -r '.access_token // empty' <<<"$resp" 2>/dev/null)"
    if [[ -z "$access" ]]; then
        # Google's two named fields when it answered with them ({"error":
        # "invalid_grant", "error_description": "..."}), and nothing else of
        # the body: what an API sends back never rides into a mail whole. A
        # body without them is named, not quoted. With no body at all, curl's
        # own last line says why (a timeout, a name that did not resolve).
        why="$(jq -r 'if type == "object" and (.error | type) == "string" then ([.error, (.error_description // empty | tostring)] | join(": ") | gsub("[\\r\\n]"; " ") | .[0:200]) else empty end' <<<"$resp" 2>/dev/null)"
        [[ -n "$why" || -z "$resp" ]] || why="an answer without an error field ($(printf '%s' "$resp" | wc -c | tr -d ' ') bytes, not quoted)"
        [[ -n "$why" ]] || why="$(tail -n 1 "$curl_err" | head -c 300)"
        rm -f "$curl_err"
        fail_reason="Google token refresh failed: ${why:-no answer and no error from curl}"
        printf '%s\n' "$fail_reason" >&2
        return 1
    fi
    rm -f "$curl_err"
    printf '%s' "$access"
}

# Usage: google_token_into <variable> <authorized_user json>
# google_access_token with its reason kept: the token lands in the named
# variable and, on failure, fail_reason is set in the calling shell, where a
# bare $(google_access_token ...) would have lost it. On failure fail_step and
# fail_fix are set beside it, the fix in words that hold for any profile,
# since this function never learns which one the JSON belongs to; a caller
# that knows says so by prefixing fail_reason. The variable is emptied on
# failure. Returns what google_access_token returned.
google_token_into() {
    local __err __token __rc
    __err="$(mktemp)"
    __token="$(google_access_token "$2" 2>"$__err")"
    __rc=$?
    if (( __rc != 0 )); then
        # Only the reason line: xtrace or stray stderr must never be mailed.
        fail_reason="$(grep -a '^Google token refresh failed' "$__err" | tail -n 1 | head -c 400)"
        [[ -n "$fail_reason" ]] || fail_reason="Google token refresh failed with no reason given"
        fail_step="Google token refresh"
        fail_fix="Export this profile's Google token again, then add it as a new version of the vault secret this job maps it from."
        __token=""
    fi
    rm -f "$__err"
    printf -v "$1" '%s' "$__token"
    return "$__rc"
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
    for v in WEEK MONDAY SUNDAY NEXT_MONDAY NEXT_WEEK NEXT_SUNDAY TODAY WORK EUDY PULLS ATELIC HOMEBASE TEXT; do
        val="${!v:-}"
        [[ -n "$val" ]] || continue
        val="$(printf '%s' "$val" | sed -e 's/[|&\\]/\\&/g')"
        args+=(-e "s|{{$v}}|$val|g")
    done
    sed "${args[@]}" "$file"
}

# ---------- the repos a run reads and writes ----------

# Usage: runner_checkout <path> <repo url> <marker file> <deploy key variable> <key file name>
# Puts a repository where a run expects it. A checkout that is already there
# is used as it is and never touched: on this machine that is the real
# repository, and in a container rehearsal it is a read only mount of it.
# Only an absent checkout is cloned, shallow, over its read only deploy key,
# which is the production path. The marker is a file the run cannot do
# without, so a path holding something else is refused and never cloned over.
# The key variable is required only when the clone is: a run that finds its
# checkout needs no key. A path this call cloned is added to CLONED_PATHS,
# the only checkouts a run may write into. Sets fail_reason and returns non
# zero on failure.
# shellcheck disable=SC2034
runner_checkout() {
    local path="$1" repo="$2" marker="$3" keyvar="$4" keyfile="$HOME/.ssh/$5"
    if [[ -f "$path/$marker" ]]; then
        echo "repo: using the checkout at $path ($(git -C "$path" log -1 --format=%h 2>/dev/null || echo 'not a git checkout'))"
        return 0
    fi
    if [[ -e "$path" ]]; then
        fail_reason="$path exists but has no $marker; refusing to clone over it"
        fail_step="Repository checkout"; fail_fix=""
        return 1
    fi
    require "$keyvar" || return 1
    mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
    printf '%s\n' "${!keyvar}" > "$keyfile"
    chmod 600 "$keyfile"
    if ! GIT_SSH_COMMAND="ssh -i $keyfile -o IdentitiesOnly=yes -o UserKnownHostsFile=$HOME/.ssh/known_hosts -o StrictHostKeyChecking=yes" \
        timeout 2m git clone --quiet --depth 1 "$repo" "$path" 2>"$WORK/git-stderr.txt"; then
        fail_reason="clone of $repo failed: $(head -c 300 "$WORK/git-stderr.txt")"
        fail_step="Repository checkout"; fail_fix=""
        return 1
    fi
    if [[ ! -f "$path/$marker" ]]; then
        fail_reason="the clone of $repo is missing $marker"
        fail_step="Repository checkout"; fail_fix=""
        return 1
    fi
    echo "repo: $repo at $(git -C "$path" log -1 --format='%h %s' | cut -c1-80)"
    CLONED_PATHS="${CLONED_PATHS:-} $path"
}

# Usage: runner_land_file <checkout> <source file> <path in the repo> <ssh command> <subject> [<body>]
# Lands one file on the remote's main for a run whose clone has fallen
# behind it, which a run of twenty minutes usually has. The commit is built
# on the fresh tip, in a clone of its own made for the landing: copy the file
# in, commit, push. Never a rebase. The run's clone is one commit deep, and a
# rebase across a shallow boundary has no common ancestor to work from, so it
# reports add/add conflicts on files the commit never touched; that sent a
# roster to the mail as an attachment on a morning main had only moved
# (2026-10-07).
#
# The run's own checkout is read and never moved: it names the remote and
# holds the file as the run read it at its start, and everything the run does
# after the landing still stands on the revision it started from.
#
# Three ways a landing ends without the file on main, each said in the log
# and each returning non zero so the caller falls back:
#   - main holds a different file at that path than the run read at its
#     start. Somebody changed it while the run was going, and the run's copy
#     is not pushed over theirs.
#   - the push was rejected because main moved again, RUNNER_LAND_TRIES times
#     running (four by default, RUNNER_LAND_PAUSE seconds apart). Only this
#     rejection is tried again, on the newer tip.
#   - the remote refused for any other reason (a key, a branch rule, a
#     hook), or could not be reached. That is not tried again: its own words
#     go in the log and the caller falls back at once.
#
# Sets LANDED_COMMIT to the short hash on main.
# shellcheck disable=SC2034
runner_land_file() {
    local checkout="$1" src="$2" dest="$3" ssh_cmd="$4" subject="$5" body="${6:-}"
    local tries="${RUNNER_LAND_TRIES:-4}" pause="${RUNNER_LAND_PAUSE:-3}" attempt url tmp repo err base tip built rc=1 moved=0
    # A runner's commit is never signed: no image holds a signing key, and a
    # machine whose own config signs would stop here for a passphrase.
    local ident=(-c user.name="${RUNNER_GIT_NAME:-Claude}" -c user.email="${RUNNER_GIT_EMAIL:-claude@atelic.me}" -c commit.gpgsign=false)
    local message=(-m "$subject")
    [[ -z "$body" ]] || message+=(-m "$body")
    LANDED_COMMIT=""
    if ! url="$(git -C "$checkout" remote get-url origin 2>/dev/null)"; then
        echo "land: the checkout at $checkout names no origin to land on"
        return 1
    fi
    # The file as the run read it at its start, and as the run built it, by
    # blob. An absent file reads as empty on either side.
    base="$(git -C "$checkout" rev-parse --quiet --verify "HEAD:$dest" 2>/dev/null || true)"
    built="$(git hash-object "$src" 2>/dev/null)" || { echo "land: cannot read $src"; return 1; }
    tmp="$(mktemp -d "$WORK/land.XXXXXX")" || { echo "land: cannot make a directory under $WORK"; return 1; }
    repo="$tmp/repo"
    err="$tmp/stderr.txt"
    if ! GIT_SSH_COMMAND="$ssh_cmd" timeout 2m git clone --quiet --depth 1 --branch main --no-tags "$url" "$repo" 2>"$err"; then
        echo "land: could not clone main, so nothing was pushed: $(tail -c 300 "$err" | tr '\n' ' ')"
        rm -rf "$tmp"
        return 1
    fi
    for (( attempt = 1; attempt <= tries; attempt++ )); do
        if (( attempt > 1 )); then
            sleep "$pause"
            if ! GIT_SSH_COMMAND="$ssh_cmd" timeout 2m git -C "$repo" fetch --quiet --depth 1 origin main 2>"$err" \
                || ! git -C "$repo" reset --quiet --hard FETCH_HEAD 2>>"$err"; then
                echo "land: could not fetch main again: $(tail -c 300 "$err" | tr '\n' ' ')"
                break
            fi
        fi
        tip="$(git -C "$repo" rev-parse --quiet --verify "HEAD:$dest" 2>/dev/null || true)"
        if [[ "$tip" == "$built" ]]; then
            LANDED_COMMIT="$(git -C "$repo" log -1 --format=%h)"
            echo "land: main already holds this $dest; nothing to commit"
            rc=0
            break
        fi
        if [[ "$tip" != "$base" ]]; then
            echo "land: $dest changed on main while the run was going, so the run's copy is not pushed over it"
            break
        fi
        if ! { mkdir -p "$(dirname "$repo/$dest")" && cp "$src" "$repo/$dest" && git -C "$repo" add -- "$dest" \
                && git -C "$repo" "${ident[@]}" commit --quiet "${message[@]}"; } 2>"$err"; then
            echo "land: could not commit $dest: $(tail -c 300 "$err" | tr '\n' ' ')"
            break
        fi
        # LC_ALL=C so the rejection reads the same wherever this runs.
        if LC_ALL=C GIT_SSH_COMMAND="$ssh_cmd" timeout 2m git -C "$repo" push origin HEAD:main >"$err" 2>&1; then
            LANDED_COMMIT="$(git -C "$repo" log -1 --format=%h)"
            (( attempt == 1 )) || echo "land: main had moved; landed on its new tip on try $attempt"
            rc=0
            break
        fi
        # "! [rejected]" is git saying the remote's main is ahead of the
        # commit pushed. A hook or a rule that declines reads "! [remote
        # rejected]", and a key that is refused never gets that far.
        if grep -q '! \[rejected\]' "$err"; then
            moved=$attempt
            echo "land: main moved under the push (try $attempt of $tries)"
            continue
        fi
        moved=0
        echo "land: the push was refused, and not because main moved, so it is not tried again: $(grep -v '^hint:' "$err" | head -c 400 | tr '\n' ' ')"
        break
    done
    (( rc == 0 || moved < tries )) || echo "land: could not land $dest on main after $tries tries; main kept moving"
    rm -rf "$tmp"
    return "$rc"
}

# Usage: runner_each_line <parallel> <exported function> < lines
# Runs the function once for every line of input, the whole line as its one
# argument, <parallel> at a time. Blank lines are skipped. The lines go to
# xargs NUL separated on purpose: fed lines, xargs reads quotes as its own,
# and one apostrophe in a line stops it with "unterminated quote" and drops
# every line after it. A company with an apostrophe in its name did that to
# the plumber's site pull for two weeks (2026-W41 and W42): the list is
# ordered follow ups first, so the first touch sites at its foot were never
# fetched. The line is handed over as an argument of its own and never
# through -I: BSD xargs stops replacing past 255 bytes and would hand the
# function a literal {} for a long line. GNU xargs runs its command once on
# empty input, which the count of arguments catches.
runner_each_line() {
    local parallel="$1" fn="$2"
    sed '/^[[:space:]]*$/d' | tr '\n' '\0' \
        | xargs -0 -n 1 -P "$parallel" bash -c '(( $# )) || exit 0; '"$fn"' "$1"' _
}

# A refused Claude credential, as `claude -p` words it in its JSON or on
# stderr. It is the same answer however often it is asked, and its text
# ("API Error: 401 ...") would otherwise read as transient.
RUNNER_CLAUDE_AUTH_RE='"api_error_status": *40[13]|OAuth token (revoked|has expired)|Failed to authenticate|authentication_error|Invalid API key'

# Usage: runner_claude_refused
# True when the answer in result, or what claude said on stderr, is a refused
# credential.
runner_claude_refused() {
    { printf '%s' "${result:-}"; cat "$WORK/claude-stderr.txt" 2>/dev/null; } | grep -qiE "$RUNNER_CLAUDE_AUTH_RE"
}

# Usage: runner_claude <prompt> [claude -p arguments...]
# One headless call with the retry the long sessions need: `claude -p` can die
# mid stream and exit non zero, and a timeout or a transient API error is
# worth one more attempt, while anything else is a real failure reported as
# one rather than a second agent run burned on it. An answer that exits zero
# but says "is_error": true (an overloaded API can answer that way) is an
# attempt that failed, judged by the same rules: a transient error is tried
# again and a refused credential is not. The result and its exit status are
# saved on every attempt, successes and failures alike, so a replay can put
# the very same JSON back through the reporting path. Sets result and rc;
# sets fail_reason, fail_step and fail_fix and returns non zero when the call
# did not complete. ATTEMPT_TIMEOUT, MAX_ATTEMPTS and RETRY_BACKOFF_SECONDS
# come from the environment when a runner needs other values.
runner_claude() {
    local prompt="$1"; shift
    local stderr_file="$WORK/claude-stderr.txt" attempt=1 transient
    local attempt_timeout="${ATTEMPT_TIMEOUT:-45m}" max_attempts="${MAX_ATTEMPTS:-2}" backoff="${RETRY_BACKOFF_SECONDS:-15}"
    local transient_re='socket connection was closed|API Error|overloaded|Connection error|terminated'
    while :; do
        echo "=== $(date -Iseconds) claude attempt $attempt/$max_attempts (timeout $attempt_timeout) ==="
        result="$(timeout "$attempt_timeout" claude -p "$prompt" "$@" --output-format json 2>"$stderr_file")"
        rc=$?
        if [[ $rc -eq 0 ]] && ! jq -e 'type == "object" and .is_error == true' <<<"$result" >/dev/null 2>&1; then
            break
        fi

        transient=false
        if [[ $rc -eq 124 ]]; then
            transient=true
            echo "attempt $attempt timed out after $attempt_timeout"
        elif runner_claude_refused; then
            echo "attempt $attempt was refused its credential (exit $rc); not retried"
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

# Usage: runner_claude_failed
# fail_step and fail_fix for a model call that did not complete: the step is
# always the call, and the fix is said only for a refused credential, the one
# cause whose remedy is known and the same every time.
runner_claude_failed() {
    fail_step="Claude model call"
    fail_fix=""
    if runner_claude_refused; then
        fail_fix="Run claude setup-token, then add the token it prints as a new version of the vault secret this job maps its Claude token from."
    fi
}

# The three things a result has to be before it is trusted: exit zero, JSON,
# and a completed turn. Exit zero alone is not enough: `claude -p` answers an
# unknown agent with exit 0 and "Unknown skill" as text. Permission denials are
# logged here so a failure page's log tail carries them. Every failure sets
# fail_step and fail_fix through runner_claude_failed.
runner_check_result() {
    if [[ $rc -ne 0 ]]; then
        # claude -p reports most failures in its JSON on stdout (a revoked
        # token is {"is_error": true, "result": "Failed to authenticate..."})
        # and leaves stderr empty, so the reason is read from both.
        local said
        said="$(jq -r '[(.result // empty | tostring), (if .api_error_status then "status \(.api_error_status)" else empty end)] | join(", ")' <<<"$result" 2>/dev/null | head -c 300)"
        fail_reason="claude exited $rc: ${said:+$said }$(head -c 400 "$WORK/claude-stderr.txt" 2>/dev/null)"
        runner_claude_failed
        return 1
    fi
    if ! jq -e . <<<"$result" >/dev/null 2>"$WORK/jq-stderr.txt"; then
        fail_reason="the agent returned output that is not JSON: $(head -c 300 <<<"$result")"
        runner_claude_failed
        return 1
    fi
    local denials
    # One line per denial, each cut to 200 characters, so a long first denial
    # never hides the rest (a single 400 character cut showed two of them on
    # the 2026-09-22 recruiter run).
    denials="$(jq -r '.permission_denials // [] | .[] | "\(.tool_name // "?"): \(.tool_input // .reason // "?" | tostring | gsub("\n"; " ") | .[0:200])"' <<<"$result")"
    [[ -z "$denials" ]] || echo "claude: $(wc -l <<<"$denials" | tr -d ' ') permission denials:"$'\n'"$(sed 's/^/  denied /' <<<"$denials")"
    if ! jq -e '.subtype == "success" and .is_error == false' <<<"$result" >/dev/null; then
        local why
        why="$(jq -r '[(.subtype // "unknown"), (if .api_error_status then "status \(.api_error_status)" else empty end), (.result // empty | tostring | gsub("\n"; " ") | .[0:200])] | join(", ")' <<<"$result" 2>/dev/null)"
        fail_reason="claude did not complete: $why"
        runner_claude_failed
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
# that an entrypoint looks for runner.sh itself. A bundle carries one
# runner's page, so an image holds exactly one, under the plain name, and
# the repo's build holds one per runner, each under its runner's name
# (bin/runner/lib.sh builds it before a run on this machine starts).
runner_renderer_bundle() {
    local candidate
    for candidate in "$LIB_DIR/render.cjs" "$LIB_DIR/../email/dist/render-${RUNNER_NAME:-}.cjs"; do
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
        renderer_error="no node bundle at $LIB_DIR/render.cjs or $LIB_DIR/../email/dist/render-${RUNNER_NAME:-}.cjs"
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
        fail_step="Page render"; fail_fix=""
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
        fail_step="Plain text render"; fail_fix=""
        return 1
    fi
    echo "render: $(wc -c < "$REPORT_TEXT" | tr -d ' ') bytes of text"
}
