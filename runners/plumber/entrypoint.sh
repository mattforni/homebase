#!/usr/bin/env bash
# The Pipeline Runner. Fired by hand before the Tuesday desk block (and by
# Cloud Scheduler once the cost earns a timer), so the week's outreach roster
# is rebuilt and drafted before the block opens.
#
# Shape, the recruiter's (ATE-543): the repos first (the checkouts already
# present, or shallow clones over read only deploy keys), then the pulls (the
# portal sweep, both mailboxes, the One Pager, and the candidate sites as
# text), then one headless Claude Code call running the `plumber` agent,
# which reads the method and the samples from the Atelic checkout and the
# pulled files from the work directory, sorts the week, drafts every touch,
# writes the roster into the work directory and returns a summary as JSON;
# the node renderer turns that into the designed email and Resend delivers it as
# "YYYY-Www Pipeline" with the roster attached. Read only against the world:
# the agent writes nothing outside its work directory, and Forni places the
# roster in the repo himself, the way he already commits it.
#
# Until 2026-09-15 (ATE-551) the agent did every read itself, one hs or gws
# command per model turn, and a pass cost 7.54 USD; the fetching was most of
# the bill. The browser walk stays out of this runner for now: a fetch is not
# a walk, and the Google captures come from Forni's own browser regardless.
#
# Secrets arrive as environment variables, injected by Cloud Run from the
# vault, or by bin/runner/run-local from this machine:
#   CLAUDE_CODE_OAUTH_TOKEN         atelic-keys/claude-code-oauth
#   RESEND_API_KEY                  atelic-keys/resend-api-key
#   HUBSPOT_SERVICE_KEY             atelic-keys/hubspot-service-key-atelic (read only use here)
#   GWS_OAUTH_TOKEN_ATELIC_JSON     atelic-keys/gws-oauth-token-atelic (authorized_user JSON)
#   GWS_OAUTH_TOKEN_PERSONAL_JSON   forni-keys/gws-oauth-token-personal
#   EUDY_DEPLOY_KEY                 forni-keys/github-deploy-key-eudy; only when no checkout is at $EUDY
#   ATELIC_DEPLOY_KEY               atelic-keys/github-deploy-key-atelic; only when no checkout is at $ATELIC
# Plain configuration:
#   REPORT_RECIPIENT          where the report goes; the Atelic mailbox, since
#                             this is Atelic work
#   REPORT_SENDER             defaults to Claude <claude@atelic.me>
#   EUDY                      the Eudaimonia checkout; defaults to $HOME/Eudaimonia
#   ATELIC                    the Atelic checkout; defaults to its place inside Eudy
#   ONE_PAGER_ID              the One Pager's Google Doc id
#   WEEK                      optional YYYY-Www override; default is this week
#   DRY_RUN                   1 renders the email and skips the send
#   SKIP_PULLS                1 skips every pull and runs the agent over the
#                             files already in $WORK, so a prompt change costs
#                             one model call and no fetches
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

runner_init plumber "Pipeline" current

required=(CLAUDE_CODE_OAUTH_TOKEN)
[[ "$DRY_RUN" == "1" ]] || required+=(RESEND_API_KEY REPORT_RECIPIENT)
[[ "$SKIP_PULLS" == "1" ]] || required+=(HUBSPOT_SERVICE_KEY GWS_OAUTH_TOKEN_ATELIC_JSON GWS_OAUTH_TOKEN_PERSONAL_JSON)
require "${required[@]}" || exit 1
require_tools claude jq curl node xargs timeout git || exit 1

# The agent's definition names its sources as ~/Eudaimonia/... paths, and the
# Atelic repo sits inside Eudy on disk (gitignored, its own repo). Inside the
# image HOME is /home/runner, so a checkout there makes every one of those
# paths resolve without the brief having to say anything about it; on this
# machine the same defaults are the real checkouts.
EUDY="${EUDY:-$HOME/Eudaimonia}"
EUDY_REPO="${EUDY_REPO:-git@github.com:mattforni/Eudaimonia.git}"
ATELIC="${ATELIC:-$EUDY/Craft/Vocation/Atelic}"
ATELIC_REPO="${ATELIC_REPO:-git@github.com:mattforni/atelic.git}"
ONE_PAGER_ID="${ONE_PAGER_ID:-1SraHDzvUebGSpAW54AV78tKpCi4_PqeXQvG6FHCOVtg}"
PULLS="$WORK/pulls"
SITES="$PULLS/sites"
PULLS_MD="$WORK/pulls.md"
ROSTER_MD="$WORK/$WEEK-roster.md"
TEXT="${TEXT:-$LIB_DIR/text.mjs}"
FETCH_UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
FETCH_TIMEOUT="${FETCH_TIMEOUT:-40}"
FETCH_PARALLEL="${FETCH_PARALLEL:-6}"
SITE_PAGES="${SITE_PAGES:-4}"
SITE_HOME_CHARS="${SITE_HOME_CHARS:-6000}"
SITE_PAGE_CHARS="${SITE_PAGE_CHARS:-2000}"

# ---------- the repos ----------
# A checkout that is already there is used as it is and never touched: on this
# machine that is the real repository, and in a container rehearsal it is a
# read only mount of it. Only an absent checkout is cloned, shallow, over its
# read only deploy key, which is the production path. Eudy first, then Atelic
# into its place inside Eudy, since Eudy gitignores it.
checkout_ready() {
    local path="$1" repo="$2" marker="$3" keyvar="$4" keyfile="$HOME/.ssh/$5"
    if [[ -f "$path/$marker" ]]; then
        echo "repo: using the checkout at $path ($(git -C "$path" log -1 --format=%h 2>/dev/null || echo 'not a git checkout'))"
        return 0
    fi
    if [[ -e "$path" ]]; then
        fail_reason="$path exists but has no $marker; refusing to clone over it"
        return 1
    fi
    require "$keyvar" || return 1
    mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
    printf '%s\n' "${!keyvar}" > "$keyfile"
    chmod 600 "$keyfile"
    if ! GIT_SSH_COMMAND="ssh -i $keyfile -o IdentitiesOnly=yes -o UserKnownHostsFile=$HOME/.ssh/known_hosts -o StrictHostKeyChecking=yes" \
        timeout 2m git clone --quiet --depth 1 "$repo" "$path" 2>"$WORK/git-stderr.txt"; then
        fail_reason="clone of $repo failed: $(head -c 300 "$WORK/git-stderr.txt")"
        return 1
    fi
    if [[ ! -f "$path/$marker" ]]; then
        fail_reason="the clone of $repo is missing $marker"
        return 1
    fi
    echo "repo: $repo at $(git -C "$path" log -1 --format='%h %s' | cut -c1-80)"
}

# ---------- the pulls ----------
# The portal, both mailboxes, the One Pager, and the sites. Each writes files
# the prompt names; the portal sweep also writes the two lists the mailbox and
# site pulls read (mail-terms.txt, sites.txt), which is why it runs first.
portal_pull() {
    local rc
    HUBSPOT_SERVICE_KEY="$HUBSPOT_SERVICE_KEY" timeout 10m node "$LIB_DIR/hubspot.mjs" sweep "$MONDAY" "$WORK" \
        > "$WORK/portal-counts.json" 2>"$WORK/hubspot-stderr.txt"
    rc=$?
    if (( rc == 124 )); then fail_reason="HubSpot sweep timed out after 10m"; return 1; fi
    if (( rc != 0 )); then fail_reason="HubSpot sweep failed: $(head -c 300 "$WORK/hubspot-stderr.txt")"; return 1; fi
    echo "portal: $(jq -r '"\(.funnel_companies) funnel companies; Next Up \(.next_up) (\(.next_up_with_new) with a NEW contact), unscored \(.unscored); sections \(.sections | to_entries | map("\(.key) \(.value)") | join(", "))"' "$WORK/portal-counts.json")"
}

# The two access tokens are minted once and kept for the One Pager pull.
ATELIC_TOKEN=""
PERSONAL_TOKEN=""
mailbox_pull() {
    local rc
    ATELIC_TOKEN="$(google_access_token "$GWS_OAUTH_TOKEN_ATELIC_JSON")" || { fail_reason="atelic mailbox: $fail_reason"; return 1; }
    PERSONAL_TOKEN="$(google_access_token "$GWS_OAUTH_TOKEN_PERSONAL_JSON")" || { fail_reason="personal mailbox: $fail_reason"; return 1; }
    GMAIL_TOKEN_ATELIC="$ATELIC_TOKEN" GMAIL_TOKEN_PERSONAL="$PERSONAL_TOKEN" timeout 10m node "$LIB_DIR/gmail.mjs" "$WORK/mail-terms.txt" "$WORK" \
        > "$WORK/mailbox-counts.json" 2>"$WORK/gmail-stderr.txt"
    rc=$?
    if (( rc == 124 )); then fail_reason="mailbox pull timed out after 10m"; return 1; fi
    if (( rc != 0 )); then fail_reason="mailbox pull failed: $(head -c 300 "$WORK/gmail-stderr.txt")"; return 1; fi
    echo "mailbox: $(jq -r '"atelic \(.mailboxes.atelic.messages // "skipped"), personal \(.mailboxes.personal.messages // "skipped") messages; \(.terms_with_mail) terms with mail"' "$WORK/mailbox-counts.json")"
}

# The One Pager as text, from the Drive export endpoint, with the Atelic
# identity first and the personal one as the fallback (both reach the shared
# drive). Not fatal: the ICP statement matters, but a roster without it is
# still a roster, and the failure is named in pulls.md and the report.
onepager_pull() {
    local token
    for token in "$ATELIC_TOKEN" "$PERSONAL_TOKEN"; do
        [[ -n "$token" ]] || continue
        if curl -fsS --max-time 60 -H "Authorization: Bearer $token" \
            "https://www.googleapis.com/drive/v3/files/$ONE_PAGER_ID/export?mimeType=text/plain&supportsAllDrives=true" \
            -o "$WORK/one-pager.md" 2>"$WORK/onepager-stderr.txt" && [[ -s "$WORK/one-pager.md" ]]; then
            echo "- The One Pager: pulled as text to $WORK/one-pager.md ($(wc -c < "$WORK/one-pager.md" | tr -d ' ') bytes)." >> "$PULLS_MD"
            echo "one pager: $(wc -c < "$WORK/one-pager.md" | tr -d ' ') bytes"
            return 0
        fi
    done
    rm -f "$WORK/one-pager.md"
    echo "- The One Pager: NOT pulled ($(head -c 160 "$WORK/onepager-stderr.txt" 2>/dev/null | tr '\n' ' ')). Say so under unverified; the ICP statement was not read this run." >> "$PULLS_MD"
    echo "one pager: failed, $(head -c 160 "$WORK/onepager-stderr.txt" 2>/dev/null | tr '\n' ' ')"
}

# site_fetch_one "<domain>|<company>|<section>": one file per domain,
# $SITES/<domain>.md, capped so twenty of them fit in a context together:
# what the head of the home page says (title, description, canonical, the
# structured data types, the analytics and widget hosts), robots.txt, the
# home page as text, and up to SITE_PAGES internal pages linked from it, each
# truncated. The raw home page HTML stays beside it for a claim that needs
# the code. Runs under xargs, so it is exported and takes what it needs from
# the environment.
site_fetch_one() {
    local domain company section dir final code err n=0 url slug last="" out html
    IFS='|' read -r domain company section <<<"$1"
    dir="$SITES/$domain"
    mkdir -p "$dir"
    err="$dir/fetch.err"
    out="$SITES/$domain.md"
    html="$dir/home.html"
    : > "$err"
    final=""
    for url in "https://$domain/" "http://$domain/"; do
        final="$(curl -sS -L -A "$FETCH_UA" --max-time "$FETCH_TIMEOUT" -o "$html" -w '%{url_effective} %{http_code}' "$url" 2>>"$err")" || final=""
        code="${final##* }"
        final="${final% *}"
        [[ "$code" == "200" ]] && break
        last="http $code${final:+ at $final}"
        final=""
    done
    if [[ -z "$final" ]]; then
        # A challenge page (Cloudflare's 403) is the usual reason, and it is
        # the fetch that was refused, never a site that is down.
        printf '# %s (%s)\n\n%s\n\nNOT pulled: %s %s\n' "$company" "$section" "$domain" "$last" "$(tail -n 1 "$err" | head -c 200)" > "$out"
        echo "pull: $domain: failed ($last $(tail -n 1 "$err" | head -c 120))"
        return 0
    fi
    {
        printf '# %s (%s)\n\n%s, final url %s. The raw home page is %s.\n\n## What the code says\n\n' "$company" "$section" "$domain" "$final" "$html"
        node "$TEXT" head "$html" "$final" 2>>"$err" || echo "(the head could not be read)"
        printf '\n## robots.txt\n\n```text\n'
        curl -sS -L -A "$FETCH_UA" --max-time 20 "https://$domain/robots.txt" 2>>"$err" | head -c 1500 || :
        printf '\n```\n\n## Home page\n\n'
        node "$TEXT" html "$html" "$final" 2>>"$err" | head -c "$SITE_HOME_CHARS"
        printf '\n'
    } > "$out"
    # Internal links off the home page, same host, no files or anchors, a
    # handful of them. The order is the page's own, so the nav comes first.
    local host="${final#*://}"; host="${host%%/*}"; host="${host#www.}"
    while read -r url; do
        (( n < SITE_PAGES )) || break
        slug="$(printf '%s' "${url#*://}" | sed 's#^[^/]*/##; s#[?\#].*$##; s#/$##; s#[^A-Za-z0-9._-]#-#g' | cut -c1-60)"
        [[ -n "$slug" ]] || continue
        if curl -sS -L -A "$FETCH_UA" --max-time "$FETCH_TIMEOUT" -o "$dir/page.html" "$url" 2>>"$err"; then
            {
                printf '\n## %s\n\n%s\n\n' "$slug" "$url"
                node "$TEXT" html "$dir/page.html" "$url" 2>>"$err" | head -c "$SITE_PAGE_CHARS"
                printf '\n'
            } >> "$out"
            n=$((n + 1))
        fi
    done < <(grep -o '](https\?://[^)]*)' <(node "$TEXT" html "$html" "$final" 2>/dev/null) | sed 's/^](//; s/)$//' \
        | grep -iE "^https?://(www\.)?${host//./\\.}(/|$)" \
        | grep -viE '\.(pdf|jpe?g|png|gif|svg|webp|mp4|zip|ics)(\?|$)|#|mailto:|tel:' \
        | awk '!seen[$0]++')
    rm -f "$dir/page.html"
    echo "pull: $domain: home plus $n pages, $(wc -c < "$out" | tr -d ' ') bytes"
}
export -f site_fetch_one
export SITES TEXT FETCH_UA FETCH_TIMEOUT SITE_PAGES SITE_HOME_CHARS SITE_PAGE_CHARS

sites_pull() {
    rm -rf "$SITES"
    mkdir -p "$SITES" || { fail_reason="cannot create $SITES"; return 1; }
    if [[ ! -s "$WORK/sites.txt" ]]; then
        echo "- Sites: nothing to pull; the sweep named no name to draft for." >> "$PULLS_MD"
        echo "sites: none named"
        return 0
    fi
    xargs -P "$FETCH_PARALLEL" -I{} bash -c 'site_fetch_one "$1"' _ {} < "$WORK/sites.txt"
    {
        echo "- Sites: one file per domain, $SITES/<domain>.md, opening with the company, the section it was pulled for, what the head of the home page code says, robots.txt, then the home page and a few internal pages as text:"
        local f
        for f in "$SITES"/*.md; do
            [[ -f "$f" ]] || continue
            printf -- '  - %s: %s\n' "$(basename "$f")" "$(sed -n '1s/^# //p' "$f")$(grep -q 'NOT pulled' "$f" && printf ' (NOT pulled)')"
        done
    } >> "$PULLS_MD"
    echo "sites: $(find "$SITES" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ') domains, $(grep -l 'NOT pulled' "$SITES"/*.md 2>/dev/null | wc -l | tr -d ' ') failed"
}

pull_all() {
    {
        echo "# What the runner pulled for $WEEK"
        echo
        echo "Pulled $(date -Iseconds) into $WORK. The portal sweep is portal.md (with portal.json beside it), the mailboxes are mailbox.md (mailbox.json), and the rest:"
        echo
    } > "$PULLS_MD"
    portal_pull || return 1
    mailbox_pull || return 1
    onepager_pull
    sites_pull || return 1
}

pulls_ready() {
    local f
    for f in portal.md portal-detail.md portal.json mailbox.md pulls.md; do
        [[ -s "$WORK/$f" ]] || { fail_reason="SKIP_PULLS is set but $WORK/$f is missing; run once without it"; return 1; }
    done
    echo "pulls: skipped, reusing $WORK"
}

# ---------- the agent ----------
# Everything the plumber's method needs from here and nothing it does not:
# the reads, WebSearch for a verification angle, WebFetch for the Granola
# links the meeting bodies carry, a scratch directory, and the few commands a
# one file script needs. No hs, no gws, no browser, no git: the pulls replaced
# the first three and the fourth was never the agent's.
ALLOWED_TOOLS=(
    "Read"
    "Grep"
    "Glob"
    "WebSearch"
    "WebFetch"
    "Bash(node:*)"
    "Bash(jq:*)"
    "Bash(curl:*)"
    "Bash(date:*)"
    "Bash(cat:*)"
    "Bash(ls:*)"
    "Bash(wc:*)"
    # Bare, on purpose. A path scoped Write rule is denied by `claude -p`
    # whatever its form (relative, absolute, double slash prefixed, star or
    # double star: all four tested 2026-09-15, and two runs burned on the
    # first before the write probe existed). Bare Write is safe here because
    # the run is a container whose checkouts are mounted read only and whose
    # filesystem is discarded, so the work directory is the only place a
    # write can land and matter, and the prompt names it as the only place.
    "Write"
)

checkout_ready "$EUDY" "$EUDY_REPO" "VOICE.md" EUDY_DEPLOY_KEY eudy_deploy_key || exit 1
checkout_ready "$ATELIC" "$ATELIC_REPO" "Pipeline/README.md" ATELIC_DEPLOY_KEY atelic_deploy_key || exit 1
if [[ ! -f "$ATELIC/Pipeline/$WEEK-roster.md" ]]; then
    fail_reason="the Atelic repo has no skeleton at Pipeline/$WEEK-roster.md; cut one first"
    exit 1
fi
if [[ "$SKIP_PULLS" == "1" ]]; then
    pulls_ready || exit 1
else
    pull_all || exit 1
fi
rm -f "$ROSTER_MD"

# The model is the agent's own unless RUNNER_MODEL says otherwise, which is
# how a side by side on the same pulls is run (Opus against Sonnet, W38).
runner_probe_write --agent plumber --allowedTools "${ALLOWED_TOOLS[@]}" || exit 1
model_args=()
[[ -z "${RUNNER_MODEL:-}" ]] || model_args=(--model "$RUNNER_MODEL")
runner_claude "$(fill_prompt "$PROMPT_FILE")" --agent plumber "${model_args[@]}" --allowedTools "${ALLOWED_TOOLS[@]}" || exit 1
runner_draft '(.headline | type == "array") and (.lede | type == "string")
    and (.scoreboard | type == "array") and (.checklist | type == "array")
    and (.counts | type == "object") and (.flags | type == "array")
    and (.unverified | type == "array") and (.not_in_block | type == "array")' || exit 1

# The funnel strip and its stage lists are the pull's, never the model's:
# fold them into the draft the renderer reads, so the email's numbers come
# straight off the portal and cost no turn.
if jq -e '.funnel' "$WORK/portal.json" >/dev/null 2>&1; then
    jq -s '.[0] + {funnel: .[1].funnel}' "$DRAFT_JSON" "$WORK/portal.json" > "$WORK/draft-merged.json" \
        && mv "$WORK/draft-merged.json" "$DRAFT_JSON"
    echo "funnel: $(jq -r '[.funnel.stages[] | "\(.label) \(.now)"] | join(", ")' "$DRAFT_JSON")"
else
    echo "funnel: portal.json carries no funnel; the email renders without the strip"
fi

# The roster is the artifact, and a summary without it is a failed run.
if [[ ! -s "$ROSTER_MD" ]] || ! grep -q "Scoreboard" "$ROSTER_MD"; then
    fail_reason="the agent did not write the roster at $ROSTER_MD (or it has no scoreboard)"
    exit 1
fi
echo "roster: $(wc -w < "$ROSTER_MD" | tr -d ' ') words in $ROSTER_MD"
ATTACHMENT="$ROSTER_MD"

runner_render || exit 1
runner_render_text || exit 1
status="success"
