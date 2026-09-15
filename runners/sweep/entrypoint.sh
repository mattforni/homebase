#!/usr/bin/env bash
# The Sweep Runner. Meant for Monday 18:00 Denver from Cloud Scheduler, so the
# Tuesday 07:00 work search block opens on a scored slate rather than a sweep.
#
# Shape: Eudaimonia first (the checkout already present, or a shallow clone over
# the read only deploy key), then the pulls (every board the recruiter's
# Sources section names, fetched with curl and reduced to text and one
# deduplicated listing table with the deny list already applied), then one
# headless Claude Code call running the `recruiter` agent, which reads the
# plan, the rubric, the work search log and the sweep ledger from that
# checkout and the pulled files from the work directory, verifies what
# survives on the employers' own ATS APIs, and returns the board as JSON;
# render.jq turns that into the designed email and Resend delivers it as
# "YYYY-Www Recruiter". Read only against the world: the agent writes nothing
# outside its work directory, and the ledger rows come back as a markdown
# file attached to the email (never in its body, Forni 2026-09-15) for the
# Tuesday session to append to FY27-sweep-ledger.md.
#
# The brief is the agent definition; prompt.md adds only the week, the
# checkout, the pulled files, the scratch directory and the JSON shape the
# renderer reads, so the sweep that runs here is the sweep that runs by hand,
# minus the fetching the runner has already done (ATE-543: the fetches were
# 150 to 300 model turns, and the bill was almost all of them).
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
#   SKIP_PULLS                1 skips the board pulls and runs the agent over
#                             the files already in $WORK, so a prompt change
#                             costs one model call and no fetches
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

SUBJECT="$WEEK Recruiter"

RESULT_JSON="$WORK/result.json"
RESULT_RC="$WORK/result.rc"
SWEEP_JSON="$WORK/sweep.json"
REPORT_HTML="$WORK/email.html"
LEDGER_MD="$WORK/$WEEK-ledger.md"

status="failure"
fail_reason=""
result=""
rc=0

# A failure is mailed in the same design as the board, from the shared
# library's failure page: the reason on top, the log's tail beneath it.
build_failure_html() {
    jq -rn -L "$JQ_LIB" --arg title "Recruiter" --arg eyebrow "Recruiter · $WEEK" \
        --arg reason "${fail_reason:-unknown failure}" --rawfile tail <(tail -n 40 "$LOG") \
        'include "email"; failure_page($title; $eyebrow; $reason; $tail)' \
    || printf '<pre>%s\n\n%s</pre>' "$(printf '%s' "${fail_reason:-unknown failure}" | html_escape)" "$(tail -n 40 "$LOG" | html_escape)"
}

finish() {
    local body attachment=""
    if [[ "$status" != "success" ]]; then
        echo "FAILED: ${fail_reason:-unknown failure}"
        body="$(build_failure_html)"
        printf '%s' "$body" > "$REPORT_HTML"
    else
        body="$(cat "$REPORT_HTML")"
        [[ -s "$LEDGER_MD" ]] && attachment="$LEDGER_MD"
    fi

    if [[ "$DRY_RUN" == "1" ]]; then
        echo "dry run: subject \"$SUBJECT\""
        echo "dry run: rendered $REPORT_HTML${attachment:+, with $attachment attached}"
        sleep 1
        [[ "$status" == "success" ]] || exit 1
        return
    fi

    send_email "$SUBJECT" "$body" "$attachment" || {
        echo "email: the report could not be delivered"
        sleep 1
        exit 1
    }
    sleep 1
    [[ "$status" == "success" ]] || exit 1
}
trap finish EXIT

required=(CLAUDE_CODE_OAUTH_TOKEN)
[[ "$DRY_RUN" == "1" ]] || required+=(RESEND_API_KEY REPORT_RECIPIENT)
require "${required[@]}" || exit 1

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

# ---------- the pulls ----------
# Every source the recruiter's Sources section names as a fetch is pulled here
# with curl before the model starts, so the sweep reads files: the Getro tier
# (seven boards, six software title queries each), Tech Jobs for Good,
# Fractional Jobs, and the a16z Jobs feed. text.mjs turns each page into what
# the model actually needs (a board's listings out of its Next.js state, a
# page as text with its links kept, a feed as one file per issue), and
# listings.jq folds the Getro pulls into one deduplicated table with deny.txt
# already applied, so a deny listed card never reaches the model. A fetch that
# fails is recorded and reported in the email's sources, never fatal; the tier
# is fatal only when no board answered at all. The ATS checks in step 3a stay
# the model's, one curl per candidate, because which to make depends on what
# survives the filters.
PULLS="$WORK/pulls"
GETRO_DIR="$PULLS/getro"
LISTINGS_JSON="$WORK/listings.json"
LISTINGS_MD="$WORK/listings.md"
PULLS_MD="$WORK/pulls.md"
TEXT="${TEXT:-$SELF_DIR/text.mjs}"
LISTINGS_JQ="${LISTINGS_JQ:-$SELF_DIR/listings.jq}"
DENY="${DENY:-$SELF_DIR/deny.txt}"
FETCH_UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
FETCH_TIMEOUT="${FETCH_TIMEOUT:-40}"
FETCH_PARALLEL="${FETCH_PARALLEL:-6}"

# The Getro tier as the recruiter's Sources section lists it, name|base. The
# agent's prose carries each board's story; this is the list the runner fetches.
GETRO_BOARDS=(
    "Climate Draft|https://jobs.climatedraft.org"
    "Lowercarbon|https://lowercarbon.getro.com"
    "Elemental Impact|https://jobs.elementalimpact.com"
    "Overture VC|https://jobs.overture.vc"
    "Third Sphere|https://jobs.thirdsphere.com"
    "Energy Impact Partners|https://jobs.energyimpactpartners.com"
    "Prelude Ventures|https://jobs.preludeventures.com"
)
# The software title query set (set 2026-09-01). ?q= is a substring match on
# the title and the board's only working lever; every filter parameter is
# silently ignored, and the page carries the first twenty results.
GETRO_QUERIES=(
    "staff software engineer"
    "principal software engineer"
    "staff backend"
    "staff platform engineer"
    "site reliability"
    "growth engineer"
)

# fetch <url> <out> <stderr-file>: prints the HTTP status, 000 when curl
# itself failed (TLS, DNS, timeout), with curl's own words in the third file.
fetch() {
    local code
    code="$(curl -sS -L -A "$FETCH_UA" --max-time "$FETCH_TIMEOUT" -o "$2" -w '%{http_code}' "$1" 2>"$3")" || code="000"
    printf '%s' "${code:-000}"
}

# getro_fetch_one "<board>|<base>|<query>": one board and query to one pull
# record at $GETRO_DIR/<board>-<query>.json, the page kept beside it. Runs
# under xargs, so it is exported and takes what it needs from the environment.
getro_fetch_one() {
    local board base query slug html json err_file code err="" data url
    IFS='|' read -r board base query <<<"$1"
    slug="$(printf '%s-%s' "$board" "$query" | tr '[:upper:]' '[:lower:]' | tr -cs '[:alnum:]' '-' | sed 's/^-//; s/-$//')"
    html="$GETRO_DIR/$slug.html"
    json="$GETRO_DIR/$slug.json"
    err_file="$GETRO_DIR/$slug.err"
    url="$base/jobs?q=${query// /+}"
    code="$(fetch "$url" "$html" "$err_file")"
    data='{"found":[],"total":null}'
    if [[ "$code" == "200" ]]; then
        data="$(node "$TEXT" getro "$html" 2>>"$err_file")" || { data='{"found":[],"total":null}'; err="no listings in the page: $(tail -n 1 "$err_file" | head -c 160)"; }
    else
        err="http $code: $(tail -n 1 "$err_file" | head -c 160)"
    fi
    jq -c --arg board "$board" --arg base "$base" --arg query "$query" --arg url "$url" --arg http "$code" --arg err "$err" \
        '{board: $board, base: $base, query: $query, url: $url, http: $http, total: .total, found: .found,
          error: (if $err == "" then null else $err end)}' <<<"$data" > "$json"
    echo "pull: $board / $query: http $code, $(jq -r '.found | length' "$json") shown${err:+; $err}"
}
export -f fetch getro_fetch_one
export GETRO_DIR TEXT FETCH_UA FETCH_TIMEOUT

# pull_page <title> <url> <name>: one page to $PULLS/<name>.md as text.
pull_page() {
    local code html="$PULLS/$3.html" md="$PULLS/$3.md" err="$PULLS/$3.err"
    code="$(fetch "$2" "$html" "$err")"
    if [[ "$code" == "200" ]] && node "$TEXT" html "$html" "$2" > "$md" 2>>"$err"; then
        echo "- $1: pulled from $2; the page as text with its links is $md ($(wc -l < "$md" | tr -d ' ') lines)." >> "$PULLS_MD"
        echo "pull: $1: http 200, $(wc -c < "$md" | tr -d ' ') bytes of text"
    else
        echo "- $1: NOT pulled (http $code; $(head -c 160 "$err" | tr '\n' ' ')). Not swept this run; say so under sources." >> "$PULLS_MD"
        echo "pull: $1: http $code, failed"
    fi
}

# pull_feed <title> <url> <name>: an RSS feed to $PULLS/<name>/, one file per
# issue and an index, newest first.
pull_feed() {
    local code xml="$PULLS/$3.xml" dir="$PULLS/$3" err="$PULLS/$3.err" n
    code="$(fetch "$2" "$xml" "$err")"
    if [[ "$code" == "200" ]] && n="$(node "$TEXT" rss "$xml" "$dir" 2>>"$err")"; then
        echo "- $1: pulled from $2; $n, one markdown file per issue in $dir/, listed newest first in $dir/index.md. Read only the issues dated since the last sweep." >> "$PULLS_MD"
        echo "pull: $1: http 200, $n"
    else
        echo "- $1: NOT pulled (http $code; $(head -c 160 "$err" | tr '\n' ' ')). Not swept this run; say so under sources." >> "$PULLS_MD"
        echo "pull: $1: http $code, failed"
    fi
}

pull_sources() {
    local b q
    rm -rf "$PULLS"
    mkdir -p "$GETRO_DIR" || { fail_reason="cannot create $GETRO_DIR"; return 1; }
    for b in "${GETRO_BOARDS[@]}"; do
        for q in "${GETRO_QUERIES[@]}"; do
            printf '%s|%s\n' "$b" "$q"
        done
    done | xargs -P "$FETCH_PARALLEL" -I{} bash -c 'getro_fetch_one "$1"' _ {}

    if ! jq -n --arg format json --rawfile deny "$DENY" -f "$LISTINGS_JQ" "$GETRO_DIR"/*.json > "$LISTINGS_JSON" 2>"$PULLS/listings-stderr.txt" \
        || ! jq -rn --arg format md --rawfile deny "$DENY" -f "$LISTINGS_JQ" "$GETRO_DIR"/*.json > "$LISTINGS_MD" 2>>"$PULLS/listings-stderr.txt"; then
        fail_reason="listings.jq failed: $(head -c 300 "$PULLS/listings-stderr.txt")"
        return 1
    fi
    if [[ "$(jq -r '.counts.fetches_ok' "$LISTINGS_JSON")" == "0" ]]; then
        fail_reason="no Getro board answered; the pull records are in $GETRO_DIR"
        return 1
    fi
    echo "pulls: $(jq -r '"\(.counts.fetches_ok) of \(.counts.fetches) Getro fetches answered; \(.counts.cards) cards, \(.counts.unique) unique, \(.counts.denied) denied, \(.counts.kept) kept"' "$LISTINGS_JSON")"

    {
        echo "# What the runner pulled for $WEEK"
        echo
        echo "Pulled $(date -Iseconds). The Getro tier is already reduced to $LISTINGS_MD (every board and query, deduplicated on job id, the deny list applied; the raw pull records are in $GETRO_DIR). The rest:"
        echo
    } > "$PULLS_MD"
    pull_page "Tech Jobs for Good" "https://www.techjobsforgood.com/?remote=Remote&job_function=Software+Engineering" tech-jobs-for-good
    pull_page "Fractional Jobs" "https://www.fractionaljobs.io/" fractional-jobs
    pull_feed "a16z Jobs" "https://a16zjobs.substack.com/feed" a16z
    return 0
}

pulls_ready() {
    if [[ -s "$LISTINGS_JSON" && -s "$LISTINGS_MD" && -s "$PULLS_MD" ]]; then
        echo "pulls: skipped, reusing $PULLS ($(jq -r '"\(.counts.kept) listings"' "$LISTINGS_JSON"))"
        return 0
    fi
    fail_reason="SKIP_PULLS is set but $WORK holds no pulls; run once without it"
    return 1
}

# ---------- the agent ----------
# Everything the recruiter's method needs and nothing it does not: the reads,
# WebSearch for the search angles, curl for the ATS APIs the method names, and
# a scratch directory. WebFetch is deliberately absent since the boards are
# already pulled. No write reaches the checkout, so the ledger cannot be
# appended from here; it travels back inside the report instead.
ALLOWED_TOOLS=(
    "Read"
    "Grep"
    "Glob"
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

missing_tools=()
for tool in claude jq curl node xargs timeout git; do
    command -v "$tool" &>/dev/null || missing_tools+=("$tool")
done
if (( ${#missing_tools[@]} )); then
    fail_reason="not on PATH: ${missing_tools[*]} (PATH=$PATH)"
    exit 1
fi
eudy_ready || exit 1
if [[ "$SKIP_PULLS" == "1" ]]; then
    pulls_ready || exit 1
else
    pull_sources || exit 1
fi

prompt="$(sed -e "s/{{WEEK}}/$WEEK/g" -e "s/{{MONDAY}}/$MONDAY/g" -e "s/{{SUNDAY}}/$SUNDAY/g" -e "s/{{TODAY}}/$(date +%F)/g" -e "s#{{WORK}}#$WORK#g" -e "s#{{PULLS}}#$PULLS#g" -e "s#{{EUDY}}#$EUDY#g" "$PROMPT_FILE")"
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
    and (.shortlist | type == "array") and (.flagged | type == "array")
    and (.fractional | type == "array")
    and (.rejected | type == "array") and (.sources | type == "array")
    and (.ledger | type == "array")' "$SWEEP_JSON" >/dev/null 2>&1; then
    fail_reason="the agent did not return the sweep shape: $(head -c 300 "$SWEEP_JSON")"
    exit 1
fi

# The ledger rows, as the table FY27-sweep-ledger.md is made of, ready to
# append. They ride beside the email as an attachment rather than in it.
jq -r '
    def cell: tostring | gsub("\\|"; "\\|") | gsub("\n"; " ");
    ["# \($week) sweep ledger",
     "",
     "Append these rows to Craft/Vocation/FY27-sweep-ledger.md; the email carries none of them.",
     "",
     "| Date | Company | Role | Key | Verdict |",
     "|------|---------|------|-----|---------|"]
    + (.ledger | map("| \(.date | cell) | \(.company | cell) | \(.role | cell) | \(.key | cell) | \(.verdict | cell) |"))
    | join("\n")' --arg week "$WEEK" "$SWEEP_JSON" > "$LEDGER_MD" || fail_reason="could not write the ledger file"
echo "ledger: $(jq -r '.ledger | length' "$SWEEP_JSON") rows in $LEDGER_MD"

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
