#!/usr/bin/env bash
# The Retro Runner. Fires Monday 05:00 Denver from Cloud Scheduler.
#
# Shape: deterministic pulls first (curl, into $WORK/*.json), then one headless
# Claude Code call that reads those files and writes the retrospective, then
# one Resend send as "YYYY-Www Retro". Read only against the world, with one
# exception: Strava invalidates the old refresh token whenever it issues a new
# one, so the rotated token is written back to the vault through the Secret
# Manager REST API using the job's service account.
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

# The retro is for the previous week, the ISO week that closed most recently.
# The job fires Monday 05:00 Denver, by which hour that week is over, so the
# default is read off yesterday's date rather than today's.
runner_init retro "Retro" previous

STRAVA_SECRET_RESOURCE="${STRAVA_SECRET_RESOURCE:-projects/forni-keys/secrets/strava-refresh-token}"
AFTER_EPOCH="$(midnight_epoch "$MONDAY")"
BEFORE_EPOCH="$(midnight_epoch "$NEXT_MONDAY")"

# What a run needs depends on what it will do. A dry run never sends, and a run
# over cached pulls never authenticates to Strava, Google, HubSpot or GitHub, so
# demanding all nine every time would make the fast local loops impossible.
required=(CLAUDE_CODE_OAUTH_TOKEN)
[[ "$DRY_RUN" == "1" ]] || required+=(RESEND_API_KEY REPORT_RECIPIENT)
[[ "$SKIP_PULLS" == "1" ]] || required+=(STRAVA_CLIENT_ID STRAVA_CLIENT_SECRET STRAVA_REFRESH_TOKEN GWS_OAUTH_TOKEN_JSON EUDY_DEPLOY_KEY HUBSPOT_SERVICE_KEY)
require "${required[@]}" || exit 1
require_tools claude jq curl node timeout git || exit 1

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
# three finished tables to write one sentence about. See the shared
# lib/hubspot.mjs, whose `week` command is this pull (it moved there from this
# directory on 2026-09-15, ATE-551, so the outreach sweep could share it).
atelic_pull() {
    # The same Denver midnight epochs the Strava pull uses, so both weeks close
    # at the same instant; hubspot.mjs says why a date string would not do.
    # Bounded like the other external steps, since a hung HubSpot call would
    # otherwise hold the job until Cloud Run's own deadline killed it.
    local rc
    HUBSPOT_SERVICE_KEY="$HUBSPOT_SERVICE_KEY" timeout 10m node "$LIB_DIR/hubspot.mjs" week "$AFTER_EPOCH" "$BEFORE_EPOCH" > "$WORK/atelic.json" 2>"$WORK/hubspot-stderr.txt"
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
# The model is named rather than defaulted. A bare config resolves to the
# current Sonnet on this token, which is what every production run has used
# and what the 0.28 USD per run (ATE-521) was measured on; a laptop's own
# config resolved the same call to Opus at high effort and cost 2.17 USD.
# Naming it here makes the two places agree by construction.
ATTEMPT_TIMEOUT="${ATTEMPT_TIMEOUT:-20m}"
runner_claude "$(fill_prompt "$PROMPT_FILE")" --model sonnet --allowedTools "Read" || exit 1
runner_draft '(.headline | type == "string") and (.movement | type == "array") and (.coverage | type == "array")
    and (.movement_read | type == "string") and (.takeout | type == "array") and (.takeout_read | type == "string")
    and (.atelic_read | type == "string") and (.blind_spots | type == "string")' || exit 1

# The Atelic tables are data, not draft: they go in after the model, so nothing
# it writes can move a number.
if ! jq -s '.[0] * {atelic: .[1]}' "$DRAFT_JSON" "$WORK/atelic.json" > "$DRAFT_JSON.merged" 2>"$WORK/merge-stderr.txt"; then
    fail_reason="could not merge the Atelic tables into the retro: $(head -c 300 "$WORK/merge-stderr.txt")"
    exit 1
fi
mv "$DRAFT_JSON.merged" "$DRAFT_JSON"

runner_render || exit 1
status="success"
