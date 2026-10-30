#!/usr/bin/env bash
# The Brief Runner. Fired weekly by Cloud Scheduler.
#
# Shape: deterministic pulls first (curl and the node scripts beside this
# file, into $WORK/*.json), then one headless Claude Code call that reads those
# files and the rule files and writes the brief as JSON, then the apply step
# (the rows the model banded high, when writes are on), then one Resend send
# as "YYYY-Www Brief". Two halves in one mail: the retrospective of the week
# that closed, and the first pass of the Monday planning session for the week
# ahead, so Forni reads a board over coffee instead of sitting through four
# agents (ATE-674, 2026-10-19).
#
# What writes, and when. Nothing here writes unless BRIEF_WRITE=1 and the run
# is not a dry run, and then only two kinds of row, and only rows the model
# banded high with a rule cited: a YNAB transaction approved at its mapped
# category, and a Gmail message labeled, marked read and archived under a
# sender or subject rule. Every other proposal (deletes, trips, stars, trash,
# tasks, Linear, calendar, Todoist) is a line in the mail for Monday. The
# flag ships off: the first week is propose only, Forni corrects the bands,
# and the flag turns on in job.json for the second. The one write that is not
# gated is the rotated Strava refresh token, which goes back to the vault as
# before, because the old one dies the moment Strava issues the new one.
#
# Secrets arrive as environment variables injected by Cloud Run from the vault:
#   CLAUDE_CODE_OAUTH_TOKEN         atelic-keys/claude-code-oauth
#   RESEND_API_KEY                  atelic-keys/resend-api-key
#   STRAVA_CLIENT_ID                forni-keys/strava-client-id
#   STRAVA_CLIENT_SECRET            forni-keys/strava-client-secret
#   STRAVA_REFRESH_TOKEN            forni-keys/strava-refresh-token
#   GWS_OAUTH_TOKEN_PERSONAL_JSON   forni-keys/gws-oauth-token-personal (authorized_user JSON); the
#                                   personal mailbox, the takeout tally, and all three calendars.
#                                   GWS_OAUTH_TOKEN_JSON, the retro job's name for it, still works
#   GWS_OAUTH_TOKEN_ATELIC_JSON     atelic-keys/gws-oauth-token-atelic; the practice's mailbox. Optional:
#                                   without it the Atelic inbox is not read and the mail says so
#   HUBSPOT_SERVICE_KEY             atelic-keys/hubspot-service-key-atelic (read only use here)
#   YNAB_API_KEY                    forni-keys/ynab-token; both budgets. Optional, degrades to not read
#   TODOIST_API_TOKEN               forni-keys/todoist-api-token. Optional, degrades to not read
#   LINEAR_API_KEY                  atelic-keys/linear-cli-atelic. Optional, degrades to not read
#   EUDY_DEPLOY_KEY                 forni-keys/github-deploy-key-eudy (read only deploy key on mattforni/Eudaimonia)
#   ATELIC_DEPLOY_KEY               atelic-keys/github-deploy-key-atelic (read only deploy key on the Atelic repo); required
#                                   up front whenever the pulls run and no checkout is at $ATELIC
# Plain configuration:
#   REPORT_RECIPIENT          where the brief goes
#   REPORT_SENDER             defaults to Claude <claude@atelic.me>
#   BRIEF_WRITE               1 applies the high rows; anything else proposes only (the default)
#   RUNNER_MODEL              the model for the one call; defaults to opus, since a high row becomes a write
#   YNAB_BUDGETS              "Personal=<id>,Atelic=<id>"; defaults to the two budgets' ids
#   CALENDARS                 "life=primary,atelic=<address>,todoist=<feed id>"; defaults to the three
#   STRAVA_SECRET_RESOURCE    defaults to projects/forni-keys/secrets/strava-refresh-token
#   ATELIC                    the Atelic checkout, whose funnel rules the HubSpot pull runs and whose
#                             Tools/ carry the practice's budget and label rules; defaults to its place
#                             inside Eudaimonia under $HOME, which is where a local run finds the real one
#   HOMEBASE                  a homebase checkout, whose assist plugin carries the planning rules; defaults
#                             to its place under $HOME when that exists, else a shallow clone of the public repo
#   WEEK                      optional YYYY-Www override for a test fire; default is the previous week, the ISO week that closed most recently
#   DRY_RUN                   1 renders the email, skips the send, and never writes; the local loop
#   SKIP_PULLS                1 reuses the JSON already in $WORK instead of pulling again
#   VAULT_ACCESS_TOKEN        optional; a local container run's write back credential for the rotated Strava token, minted on the host by bin/runner/run-local, since the image has no gcloud and no metadata server
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

# The brief is for the ISO week that is closing and the one that opens next.
# job.json says when the job fires; whether that is the closing week's last
# hours or the morning its successor opens, the default week is read off
# yesterday's date rather than today's, so Saturday, Sunday and the small
# hours of Monday all name the week that is closing.
runner_init brief "Brief" previous

# The week ahead, the planning target: the one that opens on NEXT_MONDAY.
NEXT_SUNDAY="$(shift_days "$NEXT_MONDAY" 6)"
NEXT_NEXT_MONDAY="$(shift_days "$NEXT_MONDAY" 7)"
NEXT_WEEK="$(node -e 'const d=new Date(process.argv[1]+"T12:00:00Z");const t=new Date(d);t.setUTCDate(t.getUTCDate()+3-((t.getUTCDay()+6)%7));const y=t.getUTCFullYear();const w=Math.ceil(((t-new Date(Date.UTC(y,0,4)))/864e5+((new Date(Date.UTC(y,0,4)).getUTCDay()+6)%7)+1)/7);console.log(`${y}-W${String(w).padStart(2,"0")}`)' "$NEXT_MONDAY")"
TODAY="$(date +%F)"
echo "planning: $NEXT_WEEK ($NEXT_MONDAY to $NEXT_SUNDAY)"

BRIEF_WRITE="${BRIEF_WRITE:-0}"
RUNNER_MODEL="${RUNNER_MODEL:-opus}"
STRAVA_SECRET_RESOURCE="${STRAVA_SECRET_RESOURCE:-projects/forni-keys/secrets/strava-refresh-token}"
AFTER_EPOCH="$(midnight_epoch "$MONDAY")"
BEFORE_EPOCH="$(midnight_epoch "$NEXT_MONDAY")"
GWS_OAUTH_TOKEN_PERSONAL_JSON="${GWS_OAUTH_TOKEN_PERSONAL_JSON:-${GWS_OAUTH_TOKEN_JSON:-}}"
YNAB_BUDGETS="${YNAB_BUDGETS:-Personal=a55b71e6-76e4-46d9-a5c6-336b36ddd14c,Atelic=e0d471f0-bf90-452c-8232-b1153b7411be}"
CALENDARS="${CALENDARS:-life=primary,atelic=matt@atelic.me,todoist=e673764afca2f4c2515eae6f102db4fe60e6cb6add06a133e912b7b9032b08c1@group.calendar.google.com}"

# The Atelic checkout the HubSpot pull runs its funnel rules from (the pull
# itself says why), and whose Tools/ hold the practice's budget policy and
# label tree for the model. Named here because whether its deploy key is
# needed is decided with the rest of the environment, below.
ATELIC="${ATELIC:-$HOME/Eudaimonia/Craft/Vocation/Atelic}"
ATELIC_REPO="${ATELIC_REPO:-git@github.com:atelic-action/practice.git}"
ATELIC_RULES="plugins/atelic/scripts/lib/hubspot.mjs"

# The homebase checkout the planning rules are read from: the assist plugin's
# learned rules, the payee map, the email rules, the label map. Homebase is
# public, so a run with no checkout in place clones it over https with no key.
HOMEBASE_DEFAULT="$HOME/Eudaimonia/Craft/Development/personal/homebase"
HOMEBASE_RULES=".claude/local-skills/plugins/assist/learned-rules.md"
HOMEBASE_REPO="${HOMEBASE_REPO:-https://github.com/mattforni/homebase.git}"
if [[ -z "${HOMEBASE:-}" ]]; then
    if [[ -f "$HOMEBASE_DEFAULT/$HOMEBASE_RULES" ]]; then HOMEBASE="$HOMEBASE_DEFAULT"; else HOMEBASE="$WORK/homebase"; fi
fi

# What a run needs depends on what it will do. A dry run never sends, and a run
# over cached pulls never authenticates anywhere, so demanding every secret
# every time would make the fast local loops impossible. The retro half's
# sources are required when the pulls run; the planning half's keys are each
# optional, and a missing one makes its section say "not read this run"
# rather than failing the mail. ATELIC_DEPLOY_KEY is needed whenever the pulls
# run and no Atelic checkout is already in place, which is every production
# run. It is asked for here with the rest and not at the clone, so a job
# without it mapped fails before the Strava pull rotates a refresh token for a
# run that cannot finish.
required=(CLAUDE_CODE_OAUTH_TOKEN)
[[ "$DRY_RUN" == "1" ]] || required+=(RESEND_API_KEY REPORT_RECIPIENT)
[[ "$SKIP_PULLS" == "1" ]] || required+=(STRAVA_CLIENT_ID STRAVA_CLIENT_SECRET STRAVA_REFRESH_TOKEN GWS_OAUTH_TOKEN_PERSONAL_JSON EUDY_DEPLOY_KEY HUBSPOT_SERVICE_KEY)
[[ "$SKIP_PULLS" == "1" || -f "$ATELIC/$ATELIC_RULES" ]] || required+=(ATELIC_DEPLOY_KEY)
require "${required[@]}" || exit 1
require_tools claude jq curl node timeout git || exit 1

# ---------- the pull ledger ----------
# One line per planning source, read by the mail: which were read and which
# were not, with the reason. The retro half's pulls stay fatal and do not
# appear here, since a brief without its retrospective is not a brief.
PULLS_JSON="$WORK/pulls.json"
pull_note() {
    # Usage: pull_note <name> <ok|failed> [note]
    # A note after the ledger closed (the token minted again at apply time)
    # is not a pull and goes nowhere; the apply step says its own piece.
    [[ "$PULLS_CLOSED" == 1 ]] && return 0
    local ok=false
    [[ "$2" == "ok" ]] && ok=true
    jq -n --arg n "$1" --argjson ok "$ok" --arg note "${3:-}" '{name: $n, ok: $ok, note: $note}' >> "$PULLS_JSON.lines"
}
pulls_close() {
    if [[ -s "$PULLS_JSON.lines" ]]; then jq -s '.' "$PULLS_JSON.lines" > "$PULLS_JSON"; else echo '[]' > "$PULLS_JSON"; fi
    rm -f "$PULLS_JSON.lines"
    PULLS_CLOSED=1
}
PULLS_CLOSED=0

# ---------- Eudaimonia ----------
# The first pull is the repo itself: the block doc is the one source for what
# the retro grades, and the prompt reads it rather than carrying a copy.
EUDY="$WORK/eudy"
EUDY_REPO="${EUDY_REPO:-git@github.com:mattforni/Eudaimonia.git}"
BLOCK_DOC="Constitution/Fitness/2026-recomp-block.md"
eudy_pull() {
    mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
    printf '%s\n' "$EUDY_DEPLOY_KEY" > "$HOME/.ssh/eudy_deploy_key"
    chmod 600 "$HOME/.ssh/eudy_deploy_key"
    export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/eudy_deploy_key -o IdentitiesOnly=yes -o UserKnownHostsFile=$HOME/.ssh/known_hosts -o StrictHostKeyChecking=yes"
    rm -rf "$EUDY"
    if ! timeout 2m git clone --quiet --depth 1 "$EUDY_REPO" "$EUDY" 2>"$WORK/git-stderr.txt"; then
        fail_reason="Eudaimonia clone failed: $(head -c 300 "$WORK/git-stderr.txt")"
        return 1
    fi
    # The block doc is the only thing the retro grades against; without it the
    # mail would still render, graded against nothing, so fail closed here.
    if [[ ! -f "$EUDY/$BLOCK_DOC" ]]; then
        fail_reason="Eudaimonia clone is missing $BLOCK_DOC"
        return 1
    fi
    echo "eudy: $(git -C "$EUDY" log -1 --format='%h %s' | cut -c1-80)"
}

# ---------- homebase (the planning rules) ----------
homebase_pull() {
    if [[ -f "$HOMEBASE/$HOMEBASE_RULES" ]]; then
        if [[ "$HOMEBASE" != "$WORK/homebase" ]]; then
            echo "homebase: using the checkout at $HOMEBASE ($(git -C "$HOMEBASE" log -1 --format=%h 2>/dev/null || echo 'not a git checkout'))"
            return 0
        fi
        # A clone this runner made on an earlier run is replaced, not reused,
        # so the rules are today's; it is public, shallow and takes seconds.
    elif [[ -e "$HOMEBASE" && "$HOMEBASE" != "$WORK/homebase" ]]; then
        # Only a clone this script made, under its own work directory, is
        # ever removed. Anything else at the path was put there by someone.
        fail_reason="$HOMEBASE exists but has no $HOMEBASE_RULES; refusing to clone over it"
        return 1
    fi
    [[ "$HOMEBASE" == "$WORK/homebase" ]] && rm -rf "$HOMEBASE"
    if ! GIT_SSH_COMMAND="" timeout 2m git clone --quiet --depth 1 "$HOMEBASE_REPO" "$HOMEBASE" 2>"$WORK/homebase-stderr.txt"; then
        fail_reason="homebase clone failed: $(head -c 300 "$WORK/homebase-stderr.txt")"
        return 1
    fi
    if [[ ! -f "$HOMEBASE/$HOMEBASE_RULES" ]]; then
        fail_reason="the homebase clone is missing $HOMEBASE_RULES"
        return 1
    fi
    echo "homebase: $(git -C "$HOMEBASE" log -1 --format='%h %s' | cut -c1-80)"
}

# ---------- Strava ----------
strava_pull() {
    local resp
    resp="$(curl -sS --max-time 30 -X POST https://www.strava.com/api/v3/oauth/token \
        -d client_id="$STRAVA_CLIENT_ID" -d client_secret="$STRAVA_CLIENT_SECRET" \
        -d grant_type=refresh_token -d refresh_token="$STRAVA_REFRESH_TOKEN")"
    local access new_refresh
    access="$(jq -r '.access_token // empty' <<<"$resp")"
    new_refresh="$(jq -r '.refresh_token // empty' <<<"$resp")"
    if [[ -z "$access" ]]; then
        fail_reason="Strava token refresh failed: $(jq -c 'del(.access_token, .refresh_token)' <<<"$resp" 2>/dev/null | head -c 300)"
        return 1
    fi
    if [[ -n "$new_refresh" && "$new_refresh" != "$STRAVA_REFRESH_TOKEN" ]]; then
        vault_write_back "$new_refresh" || echo "WARNING: rotated Strava refresh token not written back; the next run will fail to refresh"
    fi
    curl -sS --max-time 60 -H "Authorization: Bearer $access" \
        "https://www.strava.com/api/v3/athlete/activities?after=$AFTER_EPOCH&before=$BEFORE_EPOCH&per_page=200" \
        | jq '[.[] | {name, sportType: .sport_type, startDateLocal: .start_date_local, distanceMi: ((.distance // 0) / 1609.344 * 100 | round / 100), elevationFt: ((.total_elevation_gain // 0) * 3.28084 | round), movingMin: ((.moving_time // 0) / 60 | round), elapsedMin: ((.elapsed_time // 0) / 60 | round), averageHeartrate: .average_heartrate, maxHeartrate: .max_heartrate, relativeEffort: .suffer_score, averageSpeed: .average_speed, athleteCount: .athlete_count}]' \
        > "$WORK/strava.json" || { fail_reason="Strava activities pull failed"; return 1; }
    echo "strava: $(jq length "$WORK/strava.json") activities"
}

vault_write_back() {
    # Adds a version to the Strava refresh token secret via the metadata
    # server's access token; the job's service account holds
    # secretmanager.versions.add on that one secret and nothing else.
    local sa_token
    sa_token="$(curl -sS --max-time 10 -H 'Metadata-Flavor: Google' \
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' 2>/dev/null | jq -r '.access_token // empty')"
    # No metadata server means this is a local run, and a local run cannot be
    # allowed to swallow the rotation: Strava invalidated the old token the
    # moment it issued this one, so if the vault does not take the new one the
    # next cloud run cannot refresh at all. Fall back to the operator's own
    # credentials, which reach the same secret: an access token handed in by
    # run-local when this is its container (the image has no gcloud), else
    # this machine's gcloud login.
    [[ -n "$sa_token" ]] || sa_token="${VAULT_ACCESS_TOKEN:-}"
    if [[ -z "$sa_token" ]]; then
        if command -v gcloud >/dev/null 2>&1; then
            local secret_name secret_project
            secret_name="${STRAVA_SECRET_RESOURCE##*/}"
            secret_project="${STRAVA_SECRET_RESOURCE#projects/}"
            secret_project="${secret_project%%/*}"
            # gcloud's stderr is the whole diagnosis (an expired login, a
            # missing permission, the wrong project), and the failure line is
            # all an operator has when the next cloud run cannot refresh.
            local gcloud_err
            if gcloud_err="$(printf '%s' "$1" | gcloud secrets versions add "$secret_name" \
                --project="$secret_project" --data-file=- 2>&1 >/dev/null)"; then
                echo "strava: rotated refresh token written back to $secret_project with gcloud"
                return 0
            fi
            echo "strava: gcloud write back to $secret_project/$secret_name failed: $(tr '\n' ' ' <<<"$gcloud_err" | head -c 300)"
        else
            echo "strava: no metadata server and no gcloud; cannot write the rotated token back"
        fi
        return 1
    fi
    local payload
    payload="$(jq -n --arg d "$(printf '%s' "$1" | base64 | tr -d '\n')" '{payload: {data: $d}}')"
    local code
    code="$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' \
        -X POST "https://secretmanager.googleapis.com/v1/$STRAVA_SECRET_RESOURCE:addVersion" \
        -H "Authorization: Bearer $sa_token" -H "Content-Type: application/json" -d "$payload")"
    [[ "$code" =~ ^2 ]] && { echo "strava: rotated refresh token written back to the vault"; return 0; }
    echo "strava: vault write back returned HTTP $code"
    return 1
}

# ---------- Google tokens ----------
# Minted once each and kept for every Google pull and for the apply step.
PERSONAL_TOKEN=""
ATELIC_TOKEN=""
google_tokens() {
    # google_access_token sets fail_reason inside the command substitution,
    # where it cannot reach this shell, so the reason is spelled out here.
    if [[ -z "$GWS_OAUTH_TOKEN_PERSONAL_JSON" ]]; then
        fail_reason="no GWS_OAUTH_TOKEN_PERSONAL_JSON (or GWS_OAUTH_TOKEN_JSON) in the environment"
        return 1
    fi
    PERSONAL_TOKEN="$(google_access_token "$GWS_OAUTH_TOKEN_PERSONAL_JSON")" || { fail_reason="the personal Google token could not be refreshed; the vaulted authorized_user JSON may be revoked or stale"; return 1; }
    if [[ -n "${GWS_OAUTH_TOKEN_ATELIC_JSON:-}" ]]; then
        ATELIC_TOKEN="$(google_access_token "$GWS_OAUTH_TOKEN_ATELIC_JSON")" || {
            echo "atelic Google token: could not be refreshed; the Atelic inbox is not read this run"
            pull_note inbox-atelic failed "the Atelic mailbox was not read; its token could not be refreshed"
            ATELIC_TOKEN=""
        }
    else
        pull_note inbox-atelic failed "the Atelic mailbox was not read; no GWS_OAUTH_TOKEN_ATELIC_JSON in the environment"
    fi
}

# Every file the planning pulls write, cleared before a fresh pull so a
# failed pull cannot leave an earlier run's file beside the ledger that says
# it was not read; the arithmetic's outputs (spend.json, the lint) go too,
# since they are derived from these.
PLANNING_FILES=(calendar.json calendar-lint.json inbox-personal.json inbox-atelic.json ynab-personal.json ynab-personal-history.json ynab-atelic.json ynab-atelic-history.json spend.json linear.json todoist.json)
planning_clear() {
    local f
    for f in "${PLANNING_FILES[@]}"; do rm -f "$WORK/$f"; done
}

# ---------- Gmail (the overconsumption tally) ----------
gmail_pull() {
    # Gmail's before: is exclusive, so the bound is the Monday after the week.
    local q
    q="(Domino OR \"Illegal Pete\" OR DoorDash OR Grubhub OR \"Uber Eats\" OR Postmates) -from:claude@atelic.me after:${MONDAY//-//} before:${NEXT_MONDAY//-//}"
    # An error body would read as zero candidates, so a failed list or fetch
    # fails the run rather than reporting a clean week.
    local ids
    if ! ids="$(curl -fsS --max-time 30 -G -H "Authorization: Bearer $PERSONAL_TOKEN" \
        --data-urlencode "q=$q" --data-urlencode "maxResults=50" \
        https://gmail.googleapis.com/gmail/v1/users/me/messages | jq -r '.messages[]?.id')"; then
        fail_reason="Gmail message list pull failed"
        return 1
    fi
    : > "$WORK/takeout.jsonl"
    local id
    for id in $ids; do
        if ! curl -fsS --max-time 30 -H "Authorization: Bearer $PERSONAL_TOKEN" \
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/$id?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date" \
            | jq -c '{id, snippet, headers: (.payload.headers | map({(.name): .value}) | add)}' >> "$WORK/takeout.jsonl"; then
            fail_reason="Gmail message pull failed for $id"
            return 1
        fi
    done
    echo "gmail: $(wc -l < "$WORK/takeout.jsonl") takeout candidates"
}

# ---------- HubSpot (the Atelic week) ----------
# The joins behind these tables have traps that a model reading raw JSON would
# get wrong quietly, so the arithmetic is done in code and the prompt is
# handed three finished tables to write one sentence about. The code is the
# Atelic repo's own: plugins/atelic/scripts/lib/hubspot.mjs, whose `week`
# command is this pull. It is the one copy of the funnel rules, read by the
# plumber runner and by the manual commands in that repo too (ATE-656,
# 2026-10-13). So the pull needs an Atelic checkout: the one already at
# $ATELIC (this machine's own, or a read only mount of it in a container
# rehearsal), or a shallow clone over the read only deploy key, which is the
# production path. No image carries the rules, so a rule changed there is live
# on the next run.
atelic_pull() {
    runner_checkout "$ATELIC" "$ATELIC_REPO" "$ATELIC_RULES" ATELIC_DEPLOY_KEY atelic_deploy_key || return 1
    # The same Denver midnight epochs the Strava pull uses, so both weeks close
    # at the same instant; hubspot.mjs says why a date string would not do.
    # Bounded like the other external steps, since a hung HubSpot call would
    # otherwise hold the job until Cloud Run's own deadline killed it.
    local rc
    HUBSPOT_SERVICE_KEY="$HUBSPOT_SERVICE_KEY" timeout 10m node "$ATELIC/$ATELIC_RULES" week "$AFTER_EPOCH" "$BEFORE_EPOCH" > "$WORK/atelic.json" 2>"$WORK/hubspot-stderr.txt"
    rc=$?
    if (( rc == 124 )); then
        fail_reason="HubSpot pull timed out after 10m"
        return 1
    elif (( rc != 0 )); then
        fail_reason="HubSpot pull failed: $(head -c 300 "$WORK/hubspot-stderr.txt")"
        return 1
    fi
    echo "hubspot: $(jq -r '.totals.companies' "$WORK/atelic.json") companies, $(jq -r '.totals.sends' "$WORK/atelic.json") sends"
}

# ---------- the planning pulls ----------
# Each one is a node script beside this file, bounded by timeout, and never
# fatal: a tracker that is down costs its section, not the mail. The script
# writes the file; a failure removes any partial file so the model never
# reads half a pull, and the reason goes into the pull ledger.
planning_pull() {
    # Usage: planning_pull <name> <file> <timeout> <command...>
    local name="$1" file="$2" limit="$3"; shift 3
    local rc err="$WORK/$name-stderr.txt"
    # A failure removes the pull's every output, the siblings included (the
    # YNAB history files, the calendar lint), so nothing partial is read.
    local siblings=()
    case "$name" in
        ynab)     siblings=(ynab-personal.json ynab-personal-history.json ynab-atelic.json ynab-atelic-history.json spend.json) ;;
        calendar) siblings=(calendar.json calendar-lint.json) ;;
        inbox)    siblings=(inbox-personal.json inbox-atelic.json) ;;
        *)        siblings=("$file") ;;
    esac
    rm -f "${siblings[@]/#/$WORK/}"
    timeout "$limit" "$@" 2>"$err"
    rc=$?
    if (( rc == 124 )); then
        rm -f "${siblings[@]/#/$WORK/}"
        pull_note "$name" failed "the read timed out after $limit"
        echo "$name: not read, timed out after $limit"
    elif (( rc != 0 )) || [[ ! -s "$WORK/$file" ]]; then
        rm -f "${siblings[@]/#/$WORK/}"
        local why
        why="$(tail -n 1 "$err" 2>/dev/null | head -c 160 | tr '\n' ' ')"
        pull_note "$name" failed "${why:-the read returned nothing}"
        echo "$name: not read, ${why:-the read returned nothing}"
    else
        pull_note "$name" ok ""
        tail -n 3 "$err" 2>/dev/null | sed 's/^/  /'
    fi
    return 0
}

calendar_pull() {
    GCAL_TOKEN="$PERSONAL_TOKEN" CALENDARS="$CALENDARS" planning_pull calendar calendar.json 4m node "$SELF_DIR/calendar.mjs" pull "$WORK" "$NEXT_MONDAY" "$NEXT_NEXT_MONDAY"
}
inbox_pull() {
    # One script, two mailboxes, each judged on its own file: the script
    # writes one per mailbox it could read and names the one it could not on
    # stderr, so a failure in one never removes or misreports the other.
    local err="$WORK/inbox-stderr.txt" rc name why
    rm -f "$WORK/inbox-personal.json" "$WORK/inbox-atelic.json"
    GMAIL_TOKEN_PERSONAL="$PERSONAL_TOKEN" GMAIL_TOKEN_ATELIC="$ATELIC_TOKEN" timeout 10m node "$SELF_DIR/inbox.mjs" pull "$WORK" 2>"$err"
    rc=$?
    for name in personal atelic; do
        if [[ "$name" == atelic && -z "$ATELIC_TOKEN" ]]; then continue; fi   # already in the ledger from google_tokens
        if [[ -s "$WORK/inbox-$name.json" ]]; then
            pull_note "inbox-$name" ok ""
            grep "^inbox: $name:" "$err" 2>/dev/null | head -n 1 | sed 's/^/  /'
        else
            if (( rc == 124 )); then why="the read timed out after 10m"; else why="$(grep "^inbox: $name: not read" "$err" 2>/dev/null | head -n 1 | sed 's/^inbox: [a-z]*: not read, //' | head -c 160)"; fi
            pull_note "inbox-$name" failed "${why:-the read returned nothing}"
            echo "inbox-$name: not read, ${why:-the read returned nothing}"
        fi
    done
    return 0
}
ynab_pull() {
    if [[ -z "${YNAB_API_KEY:-}" ]]; then pull_note ynab failed "no YNAB_API_KEY in the environment"; echo "ynab: not read, no key"; return 0; fi
    YNAB_API_KEY="$YNAB_API_KEY" YNAB_BUDGETS="$YNAB_BUDGETS" planning_pull ynab ynab-personal.json 6m node "$SELF_DIR/ynab.mjs" pull "$WORK" "$TODAY"
    if [[ -s "$WORK/ynab-personal.json" ]]; then
        # The tables are their own ledger line: the queue can be read while
        # the arithmetic fails, and the mail then says so under Money.
        if node "$SELF_DIR/ynab.mjs" week "$WORK" "$TODAY" 2>"$WORK/ynab-week-stderr.txt"; then
            pull_note spend ok ""
            sed 's/^/  /' "$WORK/ynab-week-stderr.txt"
        else
            rm -f "$WORK/spend.json"
            pull_note spend failed "the spend tables could not be computed: $(tail -n 1 "$WORK/ynab-week-stderr.txt" | head -c 160)"
            echo "spend: not computed, $(tail -n 1 "$WORK/ynab-week-stderr.txt" | head -c 160)"
        fi
    fi
}
linear_pull() {
    if [[ -z "${LINEAR_API_KEY:-}" ]]; then pull_note linear failed "no LINEAR_API_KEY in the environment"; echo "linear: not read, no key"; return 0; fi
    LINEAR_API_KEY="$LINEAR_API_KEY" planning_pull linear linear.json 4m node "$SELF_DIR/linear.mjs" pull "$WORK" ATE
}
todoist_pull() {
    if [[ -z "${TODOIST_API_TOKEN:-}" ]]; then pull_note todoist failed "no TODOIST_API_TOKEN in the environment"; echo "todoist: not read, no key"; return 0; fi
    # The landing Monday is the one that opens the week being planned, where
    # deferrals accumulate; the filter's bound is the Monday after it, as an
    # explicit date, since Todoist reads "next monday" differently on a
    # Sunday night and a Monday morning.
    TODOIST_API_TOKEN="$TODOIST_API_TOKEN" planning_pull todoist todoist.json 4m node "$SELF_DIR/todoist.mjs" pull "$WORK" "$NEXT_MONDAY" "$NEXT_NEXT_MONDAY"
}

if [[ "$SKIP_PULLS" == "1" ]]; then
    # Reusing the last run's pulls is what makes prompt iteration cheap, but a
    # missing retro file would reach Claude as an empty week rather than an
    # error, so every retro input the prompt names is checked before the call.
    # The planning files are optional by design, so each one that is on disk
    # is reused and each one that is not is noted as not read.
    for cached in strava.json takeout.jsonl atelic.json; do
        [[ -f "$WORK/$cached" ]] || { fail_reason="SKIP_PULLS is set but $WORK/$cached is missing; run once without it"; exit 1; }
    done
    [[ -f "$EUDY/$BLOCK_DOC" ]] || { fail_reason="SKIP_PULLS is set but the Eudaimonia clone at $EUDY has no $BLOCK_DOC; run once without it"; exit 1; }
    # The rules clone is keyless and cheap, so a reused run still makes it
    # when none is on disk; the model reads the rules as they stand today.
    homebase_pull || exit 1
    rm -f "$PULLS_JSON.lines"
    if [[ "${PLANNING_PULLS:-0}" == "1" ]]; then
        # The retro half's pulls are what rotate a token and cost a HubSpot
        # walk; the planning half's rotate nothing, so a rehearsal of the
        # planning half can reuse the retro files and still pull fresh here.
        # Without a Google token the two Google pulls are not read and the
        # rest still run; the retro half's own Gmail pull is reused here, so
        # nothing is fatal about it.
        planning_clear
        if google_tokens; then
            calendar_pull
            inbox_pull
        else
            pull_note calendar failed "$fail_reason"
            pull_note inbox failed "$fail_reason"
            echo "calendar, inbox: not read, $fail_reason"
            fail_reason=""
        fi
        ynab_pull
        linear_pull
        todoist_pull
        echo "pulls: retro files reused from $WORK, planning pulls fresh"
    else
        for pair in calendar:calendar.json inbox:inbox-personal.json ynab:ynab-personal.json linear:linear.json todoist:todoist.json; do
            if [[ -s "$WORK/${pair#*:}" ]]; then pull_note "${pair%%:*}" ok "reused from the last pull"; else pull_note "${pair%%:*}" failed "the pulls were skipped and no read was saved"; fi
        done
        echo "pulls: skipped, reusing $WORK"
    fi
    pulls_close
else
    rm -f "$PULLS_JSON.lines"
    planning_clear
    eudy_pull || exit 1
    homebase_pull || exit 1
    strava_pull || exit 1
    google_tokens || exit 1
    gmail_pull || exit 1
    atelic_pull || exit 1
    calendar_pull
    inbox_pull
    ynab_pull
    linear_pull
    todoist_pull
    pulls_close
fi
if [[ ! -s "$WORK/spend.json" ]]; then echo '{"personal": null, "atelic": null}' > "$WORK/spend.json"; fi

# ---------- Claude ----------
# The model is named rather than defaulted, and it is Opus by default: a bare
# config resolves to the current Sonnet on this token, which is what the retro
# ran on at about 0.28 USD a run (ATE-521), but here a row the model bands
# high becomes a write to the books or the inbox, and that asymmetry is the
# reason for the stronger model (the treasurer agent made the same call).
# RUNNER_MODEL puts it back on Sonnet for a side by side.
#
# The whole run has to end inside job.json's task timeout (7200 seconds) or
# Cloud Run kills the task before the EXIT trap can mail anything, not even
# the failure page. The worst case adds up to about 95 minutes: two attempts
# of 20 minutes, the bounded pulls (ten for HubSpot, ten for the inboxes, six
# for YNAB, four each for the calendar, Linear and Todoist, a few for the
# clones), and ten for the apply step. Raise one and look at the other.
ATTEMPT_TIMEOUT="${ATTEMPT_TIMEOUT:-20m}"
runner_claude "$(fill_prompt "$PROMPT_FILE")" --model "$RUNNER_MODEL" --allowedTools "Read" || exit 1
# The retro keys are the mail: without them there is nothing to send. The
# planning keys degrade: an answer that carries the retro but a malformed
# planning half still mails the retro, with every planning section empty and
# the ledger saying why, the same way a failed pull costs its section.
runner_draft '(.headline | type == "string") and (.coverage | type == "array") and (.whatMoved | type == "array")
    and (.movementRead | type == "string") and (.takeout | type == "array") and (.takeoutRead | type == "string")
    and (.atelicRead | type == "string") and (.blindSpots | type == "string")' || exit 1
if ! jq -e '(.board | type == "array") and (.money | type == "object") and (.money.rows | type == "array")
    and (.inbox | type == "object") and (.inbox.rows | type == "array")
    and (.work | type == "object") and (.calendar | type == "object") and (.tasks | type == "object")' "$DRAFT_JSON" >/dev/null 2>&1; then
    echo "planning: the model's planning half did not validate; the retro goes out alone and every planning section is empty"
    jq '. + {board: [], money: {read: "", rows: [], deletes: [], trips: []}, inbox: {rows: []}, work: {read: "", flags: [], unplaced: []}, calendar: {read: "", findings: []}, tasks: {read: "", rows: []}}' "$DRAFT_JSON" > "$DRAFT_JSON.fixed" \
        && mv "$DRAFT_JSON.fixed" "$DRAFT_JSON"
    jq '. + [{name: "planning", ok: false, note: "the planning half of the answer did not validate, so every planning section is empty this run"}]' "$PULLS_JSON" > "$PULLS_JSON.next" && mv "$PULLS_JSON.next" "$PULLS_JSON"
fi

# ---------- the apply step ----------
# Only when writes are on and this is not a dry run, and only the rows the
# model banded high: YNAB rows approved at their category, inbox rows labeled
# (and archived when the rule says archive, never otherwise)
# and archived. The scripts resolve every name to an id through their own
# pulls and drop a row whose name does not resolve, so a misspelled category
# or label is a line in the mail, never a guess in the books. What was done
# and what was dropped goes into applied.json for the Handled rollups.
APPLIED="$WORK/applied.json"
echo '{"writes": false, "ynab": [], "gmail": [], "dropped": []}' > "$APPLIED"
# Writes need this run's own pulls: a reused queue or inbox is a night old at
# best, and a PATCH against it would land on rows that may have moved.
if [[ "$BRIEF_WRITE" == "1" && "$DRY_RUN" != "1" && "$SKIP_PULLS" != "1" ]]; then
    # The Google tokens were minted before the pulls and live an hour, which
    # the pulls and the model call together can outrun, so they are minted
    # again here; a failure costs the inbox moves, never the mail.
    TOKENS_FOR_APPLY=1
    google_tokens || { echo "apply: $fail_reason; the inbox moves stay proposed"; TOKEN_FAILURE="$fail_reason"; fail_reason=""; PERSONAL_TOKEN=""; ATELIC_TOKEN=""; TOKENS_FOR_APPLY=0; }
    # High with a rule cited, or it is not high: the rule is what the band
    # rests on, and a row without one goes to dropped below.
    jq '[.money.rows[] | select((.band // "" | ascii_downcase) == "high" and ((.rule // "") != "")) | {budget, id, category}]' "$DRAFT_JSON" > "$WORK/apply-ynab.json"
    jq '[.inbox.rows[] | select((.band // "" | ascii_downcase) == "high" and ((.rule // "") != "") and (.action == "label" or .action == "archive")) | {mailbox, id, labels: (.labels // []), archive: (.action == "archive")}]' "$DRAFT_JSON" > "$WORK/apply-gmail.json"
    # A high row the apply never tries is still accounted for: an action the
    # runner never performs (a star, a trash, a task) and, with no YNAB key,
    # every money row. Each lands in dropped with its reason, so the mail
    # never shows a high row as handled that nothing touched.
    jq --arg nokey "$([[ -n "${YNAB_API_KEY:-}" ]] && echo 0 || echo 1)" '
        [.inbox.rows[] | select((.band // "" | ascii_downcase) == "high" and ((.rule // "") != "") and (.action != "label" and .action != "archive"))
            | {kind: "gmail", id, reason: ("the runner never performs \(.action); the Monday session does")}]
        + [.inbox.rows[] | select((.band // "" | ascii_downcase) == "high" and ((.rule // "") == ""))
            | {kind: "gmail", id, reason: "banded high with no rule cited, so it stays proposed"}]
        + [.money.rows[] | select((.band // "" | ascii_downcase) == "high" and ((.rule // "") == ""))
            | {kind: "ynab", id, reason: "banded high with no rule cited, so it stays proposed"}]
        + (if $nokey == "1" then [.money.rows[] | select((.band // "" | ascii_downcase) == "high") | {kind: "ynab", id, reason: "no YNAB key in the environment, so the row stays proposed"}] else [] end)' \
        "$DRAFT_JSON" | jq 'unique_by(.kind + .id)' > "$WORK/apply-skipped.json"
    echo '{"ynab": [], "dropped": []}' > "$WORK/ynab-applied.json"
    echo '{"gmail": [], "dropped": []}' > "$WORK/gmail-applied.json"
    if [[ "$(jq length "$WORK/apply-ynab.json")" != "0" ]]; then
        if [[ -n "${YNAB_API_KEY:-}" ]]; then
            YNAB_API_KEY="$YNAB_API_KEY" timeout 5m node "$SELF_DIR/ynab.mjs" apply "$WORK" "$WORK/apply-ynab.json" > "$WORK/ynab-applied.json" 2>"$WORK/ynab-apply-stderr.txt" \
                || { echo "apply: the YNAB batch failed: $(tail -n 1 "$WORK/ynab-apply-stderr.txt" | head -c 200)"; echo '{"ynab": [], "dropped": [{"kind": "ynab", "id": "every high row", "reason": "the apply script failed or timed out, so whether the books hold these rows is unknown; check the queue"}]}' > "$WORK/ynab-applied.json"; }
        else
            echo "apply: no YNAB_API_KEY, the YNAB rows stay proposed"
        fi
    fi
    if [[ "$(jq length "$WORK/apply-gmail.json")" != "0" ]]; then
        if [[ "$TOKENS_FOR_APPLY" == 1 ]]; then
            GMAIL_TOKEN_PERSONAL="$PERSONAL_TOKEN" GMAIL_TOKEN_ATELIC="$ATELIC_TOKEN" timeout 5m node "$SELF_DIR/inbox.mjs" apply "$WORK" "$WORK/apply-gmail.json" > "$WORK/gmail-applied.json" 2>"$WORK/gmail-apply-stderr.txt" \
                || { echo "apply: the inbox moves failed: $(tail -n 1 "$WORK/gmail-apply-stderr.txt" | head -c 200)"; echo '{"gmail": [], "dropped": [{"kind": "gmail", "id": "every high row", "reason": "the apply script failed or timed out, so whether the moves landed is unknown; check the inbox"}]}' > "$WORK/gmail-applied.json"; }
        else
            # No token, so nothing is tried, and the reason is the real one.
            jq --arg why "the Google token could not be minted again at apply time: ${TOKEN_FAILURE:-unknown}" '{gmail: [], dropped: [.[] | {kind: "gmail", id, reason: $why}]}' "$WORK/apply-gmail.json" > "$WORK/gmail-applied.json"
        fi
    fi
    jq -s '{writes: true, ynab: (.[0].ynab // []), gmail: (.[1].gmail // []), dropped: ((.[0].dropped // []) + (.[1].dropped // []) + (.[2] // []))}' "$WORK/ynab-applied.json" "$WORK/gmail-applied.json" "$WORK/apply-skipped.json" > "$APPLIED"
    echo "apply: $(jq -r '"\(.ynab | length) YNAB rows approved, \(.gmail | length) messages moved, \(.dropped | length) dropped"' "$APPLIED")"
else
    echo "apply: writes are off (BRIEF_WRITE=$BRIEF_WRITE, DRY_RUN=$DRY_RUN); every row stays proposed"
fi

# The YNAB plan rides as an attachment for the Monday session: every row the
# model proposed with its band, the deletes and the trips, grouped by budget,
# plus the skips (the unapproved transfers and card payments the model was
# told not to list), so the session approves those uncategorized and applies
# the corrected rows without recomputing anything.
skips() {
    local f="$WORK/ynab-$1.json"
    if [[ -s "$f" ]]; then jq -c '[.queue[] | select(.transferAccountId != null) | {id, date, amount, payee: .payeeName, account: .accountName}]' "$f"; else echo '[]'; fi
}
jq --argjson ps "$(skips personal)" --argjson atelicSkips "$(skips atelic)" --slurpfile applied "$APPLIED" \
    '{personal: [.money.rows[] | select((.budget // "" | ascii_downcase) == "personal")], atelic: [.money.rows[] | select((.budget // "" | ascii_downcase) == "atelic")], deletes: (.money.deletes // []), trips: (.money.trips // []), skips: {personal: $ps, atelic: $atelicSkips},
      inbox: [.inbox.rows[] | select((.band // "" | ascii_downcase) != "decision") | {mailbox, id, threadId, from, subject, action, labels: (.labels // []), star, band, rule}],
      work: (.work // {}), calendar: (.calendar // {}), tasks: (.tasks // {}), board: (.board // []),
      applied: $applied[0]}' \
    "$DRAFT_JSON" > "$WORK/plan.json" && ATTACHMENT="$WORK/plan.json"

# The Atelic tables, the Strava sessions, the spend tables, the pull ledger
# and the apply record are data, not draft: they go in after the model, so
# nothing it writes can move a number, and the renderer builds its tables
# from them directly.
if ! jq -s '.[0] * {atelic: .[1], strava: .[2], spend: .[3], applied: .[4], pulls: .[5]}' \
        "$DRAFT_JSON" "$WORK/atelic.json" "$WORK/strava.json" "$WORK/spend.json" "$APPLIED" "$PULLS_JSON" > "$DRAFT_JSON.merged" 2>"$WORK/merge-stderr.txt"; then
    fail_reason="could not merge the data into the brief: $(head -c 300 "$WORK/merge-stderr.txt")"
    exit 1
fi
mv "$DRAFT_JSON.merged" "$DRAFT_JSON"

runner_render || exit 1
runner_render_text || exit 1
status="success"
