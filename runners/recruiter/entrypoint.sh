#!/usr/bin/env bash
# The Recruiter Runner. Meant for Monday 18:00 Denver from Cloud Scheduler, so the
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
# "YYYY-Www Recruiter". The agent writes nothing outside its work directory;
# the runner is what talks to the Pinole work API through the pinole CLI: it
# pulls the postings ledger before the model starts (the seen set the sweep
# dedupes against), upserts the judged rows as postings after the model
# returns, and logs the sweep as one listings_review activity. The ledger rows
# also ride beside the email as a markdown file (never in its body, Forni
# 2026-09-15), the fallback until the first unattended Monday proves the POST.
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
#   PINOLE_API_TOKEN          atelic-keys/pinole-mcp-token; always required,
#                             since the ledger pull is a read the dedupe
#                             cannot run without, dry runs included
#   EUDY_DEPLOY_KEY           forni-keys/github-deploy-key-eudy; needed only when
#                             no checkout is present at $EUDY
# Plain configuration:
#   REPORT_RECIPIENT          where the board goes; the personal mailbox, since
#                             the work search is personal work
#   REPORT_SENDER             defaults to Claude <claude@atelic.me>
#   EUDY                      the Eudaimonia checkout; defaults to $HOME/Eudaimonia,
#                             which is where the agent's own paths resolve
#   WEEK                      optional YYYY-Www override; default is this week
#   DRY_RUN                   1 renders the email and skips the send; the
#                             ledger read and writes still happen, since a
#                             rehearsal that skips them proves nothing
#   SKIP_PULLS                1 skips the board pulls and runs the agent over
#                             the files already in $WORK, so a prompt change
#                             costs one model call and no fetches; the ledger
#                             is pulled fresh regardless, it is one API call
# fail_reason, result, status and ATTACHMENT cross into the scaffold in
# lib/runner.sh (its EXIT trap and runner_render read them), which static
# analysis cannot see across files.
# shellcheck disable=SC2034,SC2154
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

runner_init recruiter "Recruiter" current

required=(CLAUDE_CODE_OAUTH_TOKEN PINOLE_API_TOKEN)
[[ "$DRY_RUN" == "1" ]] || required+=(RESEND_API_KEY REPORT_RECIPIENT)
require "${required[@]}" || exit 1
require_tools claude jq curl node xargs timeout git pinole || exit 1

# The agent's definition names its sources as ~/Eudaimonia/... paths. Inside
# the image HOME is /home/runner, so a checkout there makes every one of those
# paths resolve without the brief having to say anything about it; on this
# machine the same default is the real checkout.
EUDY="${EUDY:-$HOME/Eudaimonia}"
EUDY_REPO="${EUDY_REPO:-git@github.com:mattforni/Eudaimonia.git}"
RUBRIC="Craft/Vocation/role-rubric.md"
LEDGER_MD="$WORK/$WEEK-ledger.md"
# The Pinole side: the seen set the model reads, the rows the runner writes
# back, and what the API answered, all kept in the work directory so a failed
# write can be looked at without another model call.
LEDGER_SEEN="$WORK/ledger.md"
# fill_prompt sets TODAY too, but inside a command substitution, where it
# never reaches this shell; set here so the activity and the prompt agree.
TODAY="${TODAY:-$(date +%F)}"
POSTINGS_JSON="$WORK/postings.json"
UPSERT_JSON="$WORK/upsert.json"
ACTIVITY_JSON="$WORK/activity.json"
PINOLE_ERR="$WORK/pinole-stderr.txt"

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
TEXT="${TEXT:-$LIB_DIR/text.mjs}"
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

# ---------- the ledger ----------
# Every posting ever judged, any status, as the table the model dedupes
# against. A sweep without its seen set re verifies every posting at ATS cost
# and reports last week's rejections as new, so a failed pull is a failed run,
# never a skip. Pulled fresh on every run, SKIP_PULLS or not: it is one call.
pull_ledger() {
    local rows
    if ! pinole work postings list --all --table > "$LEDGER_SEEN" 2>"$PINOLE_ERR"; then
        fail_reason="could not pull the postings ledger: $(head -c 300 "$PINOLE_ERR")"
        return 1
    fi
    # The table's pipe rows less its header and rule.
    rows="$(awk '/^\|/ { n++ } END { print (n > 2 ? n - 2 : 0) }' "$LEDGER_SEEN")"
    echo "ledger: $rows postings already judged, in $LEDGER_SEEN"
}

# The write back, after the model has returned and the draft has its shape.
# Both are hard failures: the attachment already exists by then, so nothing
# the model produced is lost, and an unattended run that silently kept its
# rows out of the ledger would chase every one of them again next Monday.

# The ledger rows as postings for the API: the prompt's row names map onto
# the entity's (date to first_seen_on, role to title, fit to fit_score) and
# the rest pass through. The API matches each row by key, then fuzzily on
# company and title, and never lets a sweep status overwrite an applied one.
upsert_postings() {
    local count
    count="$(jq -r '.ledger | length' "$DRAFT_JSON")"
    if [[ "$count" == "0" ]]; then
        echo "upsert: no ledger rows this sweep, nothing to write"
        return 0
    fi
    if ! jq '[.ledger[] | {
            company, key, board, track, status, verdict, url,
            title: .role, fit_score: .fit, first_seen_on: .date}]' "$DRAFT_JSON" > "$POSTINGS_JSON" 2>"$PINOLE_ERR"; then
        fail_reason="could not build the postings from the ledger rows: $(head -c 300 "$PINOLE_ERR")"
        return 1
    fi
    if ! pinole work postings upsert --file "$POSTINGS_JSON" > "$UPSERT_JSON" 2>"$PINOLE_ERR"; then
        fail_reason="ledger upsert failed: $(head -c 300 "$PINOLE_ERR")"
        return 1
    fi
    echo "upsert: $count rows sent; $(jq -r '.meta | "\(.created // 0) created, \(.updated // 0) updated, \(.matched // 0) matched"' "$UPSERT_JSON")"
}

# The sweep itself as one listings_review activity, in the wording the
# backfilled rows use (the employer is the source list, the channel says what
# the sweep did), so the weekly claim reads it like every earlier sweep. A
# rerun on the same day (a --reuse loop, a run repeated after a failure) would
# log the sweep twice and the claim would report it twice, so a row already
# carrying this week's note is left alone.
log_sweep_activity() {
    local judged sources swept missed getro channel week_number existing
    judged="$(jq -r '.ledger | length' "$DRAFT_JSON")"
    week_number="$((10#${WEEK#*-W}))"

    if ! existing="$(pinole work activities list --from "$TODAY" --to "$TODAY" --kind listings_review --all 2>"$PINOLE_ERR")"; then
        fail_reason="could not read today's activities before logging the sweep: $(head -c 300 "$PINOLE_ERR")"
        return 1
    fi
    # jq -e exits 0 on a match, 1 or 4 on none, and anything else on a
    # malformed answer; only the first two are answers, the rest is a failed
    # read, since logging on top of a response that could not be parsed is
    # exactly the duplicate this check exists to prevent.
    jq -e --arg week "$WEEK" '.data.collection[] | select((.notes // "") | startswith($week + " sweep"))' <<<"$existing" >/dev/null 2>"$PINOLE_ERR"
    case $? in
        0)
            echo "activity: a $WEEK sweep is already logged for $TODAY, not logging it again"
            return 0
            ;;
        1|4) ;;
        *)
            fail_reason="could not read today's activities before logging the sweep: $(head -c 300 "$PINOLE_ERR")"
            return 1
            ;;
    esac

    sources="$(printf '%s\n' "${GETRO_BOARDS[@]}" | cut -d'|' -f1 | paste -sd ',' - | sed 's/,/, /g')"
    sources="$sources, Tech Jobs for Good, Fractional Jobs, a16z Jobs"
    getro="$(jq -r '"\(.counts.fetches_ok) of \(.counts.fetches) Getro fetches answered"' "$LISTINGS_JSON")"
    swept="$(sed -n 's/^- \(.*\): pulled from.*/\1/p' "$PULLS_MD" | paste -sd ',' - | sed 's/,/, /g')"
    missed="$(sed -n 's/^- \(.*\): NOT pulled.*/\1/p' "$PULLS_MD" | paste -sd ',' - | sed 's/,/, /g')"
    channel="Recruiter sweep of the codified sources from the runner's pulls ($getro${swept:+; $swept pulled}${missed:+; not pulled: $missed}) plus WebSearch angles; $judged postings judged on the employer's own ATS"

    if ! pinole work activities log --on "$TODAY" --kind listings_review \
            --employer "$sources" \
            --position "Week $week_number job board sweep and shortlist review" \
            --url "https://jobs.climatedraft.org/jobs" \
            --channel "$channel" \
            --notes "$WEEK sweep: $judged postings judged" > "$ACTIVITY_JSON" 2>"$PINOLE_ERR"; then
        fail_reason="could not log the sweep activity: $(head -c 300 "$PINOLE_ERR")"
        return 1
    fi
    echo "activity: logged listings_review $(jq -r '.data.entity.id // "?"' "$ACTIVITY_JSON") for $TODAY"
}

# ---------- the agent ----------
# Everything the recruiter's method needs and nothing it does not: the reads,
# WebSearch for the search angles, curl for the ATS APIs the method names, and
# a scratch directory. WebFetch is deliberately absent since the boards are
# already pulled. No write reaches the checkout and the agent never calls the
# API; the runner writes its ledger rows to Pinole after the model returns.
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
    # The text toolkit the agent pipes a fetched posting through. A pipeline
    # is allowed only when every stage is, and the 2026-09-16 rehearsal spent
    # turns on denials of `curl | jq | sed | grep | head` chains (Forni: allow
    # them all). Every one of these reads and transforms; none writes.
    "Bash(sed:*)"
    "Bash(grep:*)"
    "Bash(head:*)"
    "Bash(tail:*)"
    "Bash(tr:*)"
    "Bash(sort:*)"
    "Bash(uniq:*)"
    "Bash(wc:*)"
    "Bash(cut:*)"
    "Bash(awk:*)"
    "Bash(echo:*)"
    "Bash(printf:*)"
    # Bare: a path scoped Write rule is denied by `claude -p` in every form
    # (runners/outreach/entrypoint.sh has the test); the container's checkout
    # is a read only mount, so the work directory is the only place a write
    # can land.
    "Write"
)

eudy_ready || exit 1
if [[ "$SKIP_PULLS" == "1" ]]; then
    pulls_ready || exit 1
else
    pull_sources || exit 1
fi
pull_ledger || exit 1

# The agent writes its scratch files, so the half cent write probe runs
# first (runners/README.md, Adding a Runner).
runner_probe_write --agent recruiter --allowedTools "${ALLOWED_TOOLS[@]}" || exit 1
runner_claude "$(fill_prompt "$PROMPT_FILE")" --agent recruiter --allowedTools "${ALLOWED_TOOLS[@]}" || exit 1
runner_draft '(.headline | type == "array") and (.lede | type == "string")
    and (.shortlist | type == "array") and (.flagged | type == "array")
    and (.fractional | type == "array")
    and (.rejected | type == "array") and (.sources | type == "array")
    and (.ledger | type == "array")' || exit 1

# The ledger rows, as the table FY27-sweep-ledger.md is made of, ready to
# append. They ride beside the email as an attachment rather than in it, the
# fallback that stays until the first unattended Monday proves the upsert.
if ! jq -r '
    def cell: tostring | gsub("\\|"; "\\|") | gsub("\n"; " ");
    ["# \($week) sweep ledger",
     "",
     "Append these rows to Craft/Vocation/FY27-sweep-ledger.md; the email carries none of them.",
     "",
     "| Date | Company | Role | Key | Verdict |",
     "|------|---------|------|-----|---------|"]
    + (.ledger | map("| \(.date | cell) | \(.company | cell) | \(.role | cell) | \(.key | cell) | \(.verdict | cell) |"))
    | join("\n")' --arg week "$WEEK" "$DRAFT_JSON" > "$LEDGER_MD"; then
    fail_reason="could not write the ledger file"
    exit 1
fi
echo "ledger: $(jq -r '.ledger | length' "$DRAFT_JSON") rows in $LEDGER_MD"
ATTACHMENT="$LEDGER_MD"

upsert_postings || exit 1
log_sweep_activity || exit 1

runner_render || exit 1
runner_render_text || exit 1
status="success"
