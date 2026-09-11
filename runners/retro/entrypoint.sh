#!/usr/bin/env bash
# The Retro Runner. Fires Monday 05:00 Denver from Cloud Scheduler.
#
# Shape: deterministic pulls first (curl, into /work/*.json), then one headless
# Claude Code call that reads those files and writes the retrospective, then
# one Resend send. Read only against the world, with one exception: Strava
# invalidates the old refresh token whenever it issues a new one, so the
# rotated token is written back to the vault through the Secret Manager REST
# API using the job's service account.
#
# Secrets arrive as environment variables injected by Cloud Run from the vault:
#   CLAUDE_CODE_OAUTH_TOKEN   atelic-keys/claude-code-oauth
#   RESEND_API_KEY            atelic-keys/resend-api-key
#   STRAVA_CLIENT_ID          forni-keys/strava-client-id
#   STRAVA_CLIENT_SECRET      forni-keys/strava-client-secret
#   STRAVA_REFRESH_TOKEN      forni-keys/strava-refresh-token
#   GWS_OAUTH_TOKEN_JSON      forni-keys/gws-oauth-token-personal (authorized_user JSON)
#   HUBSPOT_SERVICE_KEY       atelic-keys/hubspot-service-key-atelic (read only use here)
#   EUDY_DEPLOY_KEY           forni-keys/github-deploy-key-eudy (read only deploy key on mattforni/Eudaimonia)
# Plain configuration:
#   REPORT_RECIPIENT          where the retro goes
#   REPORT_SENDER             defaults to Claude <claude@atelic.me>
#   STRAVA_SECRET_RESOURCE    defaults to projects/forni-keys/secrets/strava-refresh-token
#   WEEK                      optional YYYY-Www override for a test fire; default is the previous week, the ISO week that closed most recently
#   DRY_RUN                   1 renders the email and skips the send; the local loop
#   SKIP_PULLS                1 reuses the JSON already in $WORK instead of pulling again
set -uo pipefail

DRY_RUN="${DRY_RUN:-0}"
SKIP_PULLS="${SKIP_PULLS:-0}"

# The runner directory, whichever it is: /home/runner inside the image, the
# repo's runners/retro on a local run. The prompt and the renderer sit
# beside this script in both, so one expression finds them either way.
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Under the runner's home: the container runs non root and / is read only to it.
WORK="${WORK:-$HOME/work}"
mkdir -p "$WORK"
LOG="$WORK/run.log"
exec > >(tee -a "$LOG") 2>&1

REPORT_SENDER="${REPORT_SENDER:-Claude <claude@atelic.me>}"
STRAVA_SECRET_RESOURCE="${STRAVA_SECRET_RESOURCE:-projects/forni-keys/secrets/strava-refresh-token}"
RETRO_JSON="$WORK/retro.json"
RETRO_HTML="$WORK/retro.html"
RENDER="${RENDER:-$SELF_DIR/render.jq}"
PROMPT_FILE="${PROMPT_FILE:-$SELF_DIR/prompt.md}"
status="failure"
fail_reason=""

require() {
    local missing=()
    for v in "$@"; do [[ -n "${!v:-}" ]] || missing+=("$v"); done
    if (( ${#missing[@]} > 0 )); then
        fail_reason="missing environment: ${missing[*]}"
        return 1
    fi
}

# ---------- dates ----------
# The image carries GNU date; a local run on macOS gets BSD date, which cannot
# read GNU's relative expressions at all. Four helpers, one implementation each
# way, so the week math below is written once and reads the same in both
# places. BSD's -f leaves unspecified fields at their current value, which is
# why midnight has to name its seconds. Every one of them reads the local
# clock, and the image pins TZ to America/Denver, so a day here is a Denver day
# and yesterday is Denver's yesterday.
if date -d 2026-01-04 +%F >/dev/null 2>&1; then
    day_of_week()       { date -d "$1" +%u; }
    shift_days()        { date -d "$1 $2 days" +%F; }
    midnight_epoch()    { date -d "$1 00:00" +%s; }
    previous_week() { date -d yesterday +%G-W%V; }
else
    day_of_week()       { date -j -f %Y-%m-%d "$1" +%u; }
    shift_days()        { local off="$2"; [[ "$off" == -* ]] || off="+$off"; date -j -v"${off}d" -f %Y-%m-%d "$1" +%F; }
    midnight_epoch()    { date -j -f '%Y-%m-%d %H:%M:%S' "$1 00:00:00" +%s; }
    previous_week() { date -v-1d +%G-W%V; }
fi

# ---------- the week ----------
# The retro is for the previous week, the ISO week that closed most recently.
# The job fires Monday 05:00 Denver, by which hour that week is over, so the
# default is read off yesterday's date rather than today's. Yesterday shares its
# ISO week with today on every day but Monday, so a test fire on any other day
# still reads the week in progress.
WEEK="${WEEK:-$(previous_week)}"
iso_year="${WEEK%-W*}"
iso_week="${WEEK#*-W}"
# Monday of the ISO week, computed from January 4 (always in week 1).
jan4_dow="$(day_of_week "${iso_year}-01-04")"
week1_monday="$(shift_days "${iso_year}-01-04" "-$((jan4_dow - 1))")"
MONDAY="$(shift_days "$week1_monday" "$(( (10#$iso_week - 1) * 7 ))")"
NEXT_MONDAY="$(shift_days "$MONDAY" 7)"
SUNDAY="$(shift_days "$MONDAY" 6)"
AFTER_EPOCH="$(midnight_epoch "$MONDAY")"
BEFORE_EPOCH="$(midnight_epoch "$NEXT_MONDAY")"
echo "=== $(date -Iseconds) retro start: $WEEK ($MONDAY to $SUNDAY) ==="

# ---------- Resend ----------
send_email() {
    # $1 subject, $2 html body
    local payload
    payload="$(jq -n --arg from "$REPORT_SENDER" --arg to "$REPORT_RECIPIENT" \
        --arg subject "$1" --arg html "$2" \
        '{from: $from, to: [$to], subject: $subject, html: $html}')"
    local code
    code="$(curl -sS --max-time 30 -o "$WORK/resend.json" -w '%{http_code}' \
        -X POST https://api.resend.com/emails \
        -H "Authorization: Bearer $RESEND_API_KEY" \
        -H "Content-Type: application/json" \
        -d "$payload")"
    if [[ "$code" =~ ^2 ]]; then
        echo "email: sent ($1)"
        return 0
    fi
    echo "email: failed with HTTP $code: $(head -c 500 "$WORK/resend.json")"
    return 1
}

html_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

finish() {
    if [[ "$status" == "success" ]]; then
        if [[ "$DRY_RUN" == "1" ]]; then
            echo "dry run: nothing sent. html at $RETRO_HTML"
            sleep 1
            return
        fi
        # A failed delivery is a failed run: Cloud Run has to see it.
        send_email "$WEEK Retro" "$(cat "$RETRO_HTML")" || { sleep 1; exit 1; }
    else
        echo "FAILED: $fail_reason"
        # A local run reports its failure on stdout, where the person reading
        # it already is; only the cloud run needs the failure mailed out.
        if [[ "$DRY_RUN" == "1" ]]; then
            sleep 1
            exit 1
        fi
        local body
        body="<body style=\"margin:0;padding:40px 16px;background:#f6f1e7;font-family:Geist,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#151515;\"><div style=\"max-width:760px;margin:0 auto;background:#fdfbf6;border:1px solid #ece8de;border-radius:20px;padding:36px 40px;\"><div style=\"font-family:'Geist Mono',Menlo,monospace;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:#55503f;\">Retro</div><div style=\"font-size:28px;font-weight:600;margin-top:18px;\">The retro did not run.</div><p style=\"font-size:15px;line-height:1.55;color:#55503f;\">$(printf '%s' "$fail_reason" | html_escape)</p><pre style=\"font-family:'Geist Mono',Menlo,monospace;font-size:12px;white-space:pre-wrap;color:#55503f;border-top:1px solid #d9d4c8;padding-top:14px;\">$(tail -n 60 "$LOG" | html_escape)</pre></div></body>"
        send_email "$WEEK Retro" "$body" || true
        sleep 1
        exit 1
    fi
    # Let the tee behind stdout flush before the container exits, or the
    # last lines never reach the Cloud Run log.
    sleep 1
}
trap finish EXIT

# What a run needs depends on what it will do. A dry run never sends, and a run
# over cached pulls never authenticates to Strava, Google, HubSpot or GitHub, so
# demanding all nine every time would make the fast local loops impossible.
required=(CLAUDE_CODE_OAUTH_TOKEN)
[[ "$DRY_RUN" == "1" ]] || required+=(RESEND_API_KEY REPORT_RECIPIENT)
[[ "$SKIP_PULLS" == "1" ]] || required+=(STRAVA_CLIENT_ID STRAVA_CLIENT_SECRET STRAVA_REFRESH_TOKEN GWS_OAUTH_TOKEN_JSON EUDY_DEPLOY_KEY HUBSPOT_SERVICE_KEY)
require "${required[@]}" || exit 1

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
    # The block doc is the only thing the prompt grades against; without it the
    # retro would still render, graded against nothing, so fail closed here.
    if [[ ! -f "$EUDY/$BLOCK_DOC" ]]; then
        fail_reason="Eudaimonia clone is missing $BLOCK_DOC"
        return 1
    fi
    echo "eudy: $(git -C "$EUDY" log -1 --format='%h %s' | cut -c1-80)"
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
        | jq '[.[] | {name, sport_type, start_date_local, distance_mi: ((.distance // 0) / 1609.344 * 100 | round / 100), elevation_ft: ((.total_elevation_gain // 0) * 3.28084 | round), moving_min: ((.moving_time // 0) / 60 | round), elapsed_min: ((.elapsed_time // 0) / 60 | round), average_heartrate, max_heartrate, relative_effort: .suffer_score, average_speed}]' \
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
    # gcloud credentials, which reach the same secret.
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
    payload="$(jq -n --arg d "$(printf '%s' "$1" | base64 -w0)" '{payload: {data: $d}}')"
    local code
    code="$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' \
        -X POST "https://secretmanager.googleapis.com/v1/$STRAVA_SECRET_RESOURCE:addVersion" \
        -H "Authorization: Bearer $sa_token" -H "Content-Type: application/json" -d "$payload")"
    [[ "$code" =~ ^2 ]] && { echo "strava: rotated refresh token written back to the vault"; return 0; }
    echo "strava: vault write back returned HTTP $code"
    return 1
}

# ---------- Gmail (the overconsumption tally) ----------
gmail_pull() {
    local resp access
    resp="$(curl -sS --max-time 30 -X POST https://oauth2.googleapis.com/token \
        -d client_id="$(jq -r .client_id <<<"$GWS_OAUTH_TOKEN_JSON")" \
        -d client_secret="$(jq -r .client_secret <<<"$GWS_OAUTH_TOKEN_JSON")" \
        -d refresh_token="$(jq -r .refresh_token <<<"$GWS_OAUTH_TOKEN_JSON")" \
        -d grant_type=refresh_token)"
    access="$(jq -r '.access_token // empty' <<<"$resp")"
    if [[ -z "$access" ]]; then
        fail_reason="Google token refresh failed: $(jq -c 'del(.access_token)' <<<"$resp" 2>/dev/null | head -c 300)"
        return 1
    fi
    # Gmail's before: is exclusive, so the bound is the Monday after the week.
    local q
    q="(Domino OR \"Illegal Pete\" OR DoorDash OR Grubhub OR \"Uber Eats\" OR Postmates) -from:claude@atelic.me after:${MONDAY//-//} before:${NEXT_MONDAY//-//}"
    # An error body would read as zero candidates, so a failed list or fetch
    # fails the run rather than reporting a clean week.
    local ids
    if ! ids="$(curl -fsS --max-time 30 -G -H "Authorization: Bearer $access" \
        --data-urlencode "q=$q" --data-urlencode "maxResults=50" \
        https://gmail.googleapis.com/gmail/v1/users/me/messages | jq -r '.messages[]?.id')"; then
        fail_reason="Gmail message list pull failed"
        return 1
    fi
    : > "$WORK/takeout.jsonl"
    local id
    for id in $ids; do
        if ! curl -fsS --max-time 30 -H "Authorization: Bearer $access" \
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
# get wrong quietly, so the arithmetic is done here and the prompt is handed
# three finished tables to write one sentence about. See hubspot.mjs.
atelic_pull() {
    # The same Denver midnight epochs the Strava pull uses, so both weeks close
    # at the same instant; hubspot.mjs says why a date string would not do.
    # Bounded like the other external steps, since a hung HubSpot call would
    # otherwise hold the job until Cloud Run's own deadline killed it.
    local rc
    HUBSPOT_SERVICE_KEY="$HUBSPOT_SERVICE_KEY" timeout 10m node "$SELF_DIR/hubspot.mjs" "$AFTER_EPOCH" "$BEFORE_EPOCH" > "$WORK/atelic.json" 2>"$WORK/hubspot-stderr.txt"
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

if [[ "$SKIP_PULLS" == "1" ]]; then
    # Reusing the last run's pulls is what makes prompt iteration cheap, but a
    # missing file would reach Claude as an empty week rather than an error, so
    # every input the prompt names is checked before the call.
    for cached in strava.json takeout.jsonl atelic.json; do
        [[ -f "$WORK/$cached" ]] || { fail_reason="SKIP_PULLS is set but $WORK/$cached is missing; run once without it"; exit 1; }
    done
    [[ -f "$EUDY/$BLOCK_DOC" ]] || { fail_reason="SKIP_PULLS is set but the Eudaimonia clone at $EUDY has no $BLOCK_DOC; run once without it"; exit 1; }
    echo "pulls: skipped, reusing $WORK"
else
    eudy_pull || exit 1
    strava_pull || exit 1
    gmail_pull || exit 1
    atelic_pull || exit 1
fi

# ---------- Claude ----------
prompt="$(sed -e "s/{{WEEK}}/$WEEK/g" -e "s/{{MONDAY}}/$MONDAY/g" -e "s/{{SUNDAY}}/$SUNDAY/g" -e "s/{{TODAY}}/$(date +%F)/g" -e "s#{{WORK}}#$WORK#g" -e "s#{{EUDY}}#$EUDY#g" "$PROMPT_FILE")"
result="$(timeout 20m claude -p "$prompt" \
    --allowedTools "Read" \
    --output-format json 2>"$WORK/claude-stderr.txt")"
rc=$?
# The whole result is kept: the total alone cannot say where a run's money
# went, and ATE-521 spent a week on a cost no run had recorded the shape of.
printf '%s\n' "$result" > "$WORK/claude-result.json"
if [[ $rc -ne 0 ]]; then
    fail_reason="claude exited $rc: $(head -c 400 "$WORK/claude-stderr.txt")"
    exit 1
fi
if ! jq -e '.subtype == "success" and .is_error == false' <<<"$result" >/dev/null; then
    fail_reason="claude did not complete: $(jq -r '.subtype // "unknown"' <<<"$result")"
    exit 1
fi
# The result is the JSON object the prompt asked for; tolerate a stray code
# fence, then require every key the renderer reads.
# Cut the object out of whatever surrounds it: a code fence, or prose the
# model wrote before it despite the brief.
raw="$(jq -r '.result // ""' <<<"$result")"
if [[ "$raw" == *"{"* && "$raw" == *"}"* ]]; then
    raw="{${raw#*\{}"
    raw="${raw%\}*}}"
fi
printf '%s\n' "$raw" > "$RETRO_JSON"
if ! jq -e 'type == "object" and has("headline") and has("movement") and has("coverage") and has("movement_read") and has("takeout") and has("takeout_read") and has("atelic_read") and has("blind_spots")' "$RETRO_JSON" >/dev/null 2>&1; then
    fail_reason="claude did not return the retro shape: $(head -c 300 "$RETRO_JSON")"
    exit 1
fi
usage="$(jq -r '"\(.num_turns // "?") turns; " + ((.modelUsage // {}) | to_entries | map("\(.key) in \(.value.inputTokens // 0) out \(.value.outputTokens // 0) cache read \(.value.cacheReadInputTokens // 0) write \(.value.cacheCreationInputTokens // 0)") | join("; "))' <<<"$result")"
echo "claude: retro drafted (cost $(jq -r '.total_cost_usd // "?"' <<<"$result") USD; $usage)"

# The Atelic tables are data, not draft: they go in after the model, so nothing
# it writes can move a number.
if ! jq -s '.[0] * {atelic: .[1]}' "$RETRO_JSON" "$WORK/atelic.json" > "$RETRO_JSON.merged" 2>/dev/null; then
    fail_reason="could not merge the Atelic tables into the retro"
    exit 1
fi
mv "$RETRO_JSON.merged" "$RETRO_JSON"

# ---------- render ----------
if ! jq -r --arg week "$WEEK" --arg monday "$MONDAY" --arg sunday "$SUNDAY" -f "$RENDER" "$RETRO_JSON" > "$RETRO_HTML" 2>"$WORK/render-stderr.txt" || [[ ! -s "$RETRO_HTML" ]]; then
    fail_reason="render failed: $(head -c 300 "$WORK/render-stderr.txt")"
    exit 1
fi
echo "render: $(wc -c < "$RETRO_HTML") bytes of html"
status="success"
