#!/usr/bin/env bash
# The Outreach Runner. Run by hand before the Tuesday desk block, so the week's
# outreach roster is rebuilt and drafted before the block opens. It sat on a
# Monday 06:00 LaunchAgent for exactly one morning: a weekly timer spends a
# full pass whether or not the week needs one, so the trigger is a person
# deciding it does (#217, 2026-08-31).
#
# Shape: one headless Claude Code call running the `outreacher` agent, which
# does its own reads through the local CLIs, then one Resend send reporting
# what it did. Prep only. The agent never emails anyone, never moves a Lead
# Status, and never posts to a client surface; every send waits for Forni's
# explicit yes inside the Tuesday block.
#
# This runner is local only, and that is a design position rather than a gap.
# It reads HubSpot through `hs`, both mailboxes and the One Pager through
# `gws`, both authenticated on this machine, and it writes the roster as a file
# in the Atelic checkout, which is also only here; and its customer path walk
# requires a real browser, because a Cloudflare challenge, a per visit phone
# number and a lazy loaded form all lie to a fetch. runners/outreach/README.md
# carries what promoting it to Cloud Run would actually take. Until then
# `bin/runner/run-local outreach --send`, started by hand, is production.
#
# Secrets arrive as environment variables, injected by bin/runner/run-scheduled
# from this machine's vaults (and by Cloud Run from Secret Manager, if this
# runner is ever promoted):
#   CLAUDE_CODE_OAUTH_TOKEN   Keychain claude-code-oauth
#   RESEND_API_KEY            Keychain resend-api-key
# Plain configuration:
#   REPORT_RECIPIENT          where the report goes; locally this resolves to
#                             ~/.config/headless-report/recipient-outreach,
#                             which is the Atelic mailbox rather than the
#                             personal one, because this is Atelic work
#   REPORT_SENDER             defaults to Claude <claude@atelic.me>
#   ATELIC                    the practice repo, whose .account marker is what
#                             points hs and gws at the right identity
#   WEEK                      optional YYYY-Www override; default is this week
#   DRY_RUN                   1 renders the report and skips the send
#   SKIP_PULLS                1 replays the saved agent result instead of
#                             running the agent again; this runner's only
#                             pull is the agent itself
# fail_reason, result, DRAFT_JSON and status cross into the scaffold in
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

runner_init outreach "Outreach" current
ATELIC="${ATELIC:-$HOME/Eudaimonia/Craft/Vocation/Atelic}"
SUCCESS_LINE="Outreach roster prepped for $WEEK"

# What a run needs depends on what it will do. A dry run never sends, and a
# replayed run never calls the agent, so demanding everything every time would
# make the fast local loops impossible.
required=()
[[ "$SKIP_PULLS" == "1" ]] || required+=(CLAUDE_CODE_OAUTH_TOKEN)
[[ "$DRY_RUN" == "1" ]] || required+=(RESEND_API_KEY REPORT_RECIPIENT)
if (( ${#required[@]} )); then
    require "${required[@]}" || exit 1
fi

# ---------- the agent ----------
# Rather than --dangerously-skip-permissions, the invocation pre allows only
# what the agent needs. Each entry matches a single plain command; the agent is
# told to keep every Bash call that shape and to put multi step logic in a
# python script under the work dir.
ALLOWED_TOOLS=(
    "Bash(hs:*)"
    "Bash(gws:*)"
    # An allow rule does not match past an env assignment it does not
    # recognize, so the profile pinned form the agent is told to use needs its
    # own entries.
    "Bash(GWS_FORCE_PROFILE=atelic gws:*)"
    "Bash(GWS_FORCE_PROFILE=personal gws:*)"
    "Bash(curl:*)"
    # The customer path walk runs in a real browser, never curl alone.
    "Bash(agent-browser:*)"
    "Bash(python3:*)"
    "Bash(security:*)"
    "Bash(date:*)"
    "Bash(cat:*)"
    "Bash(ls:*)"
    "Read"
    "Grep"
    "Glob"
    "WebFetch"
    "WebSearch"
    "Write($WORK/*)"
    # The one write the agent makes outside its own work directory: this run's
    # roster file in the Atelic repo. Pinned to $WEEK, which is validated by
    # runner_init, so the rest of Outreach/ (the method, the CLAUDE.md, the
    # Voice samples) and every prior week's roster stay out of reach; prose
    # forbidding it is the weakest kind of rule. A pattern that fails to match
    # shows up as a permission denial in the log, visible rather than silent.
    "Write($ATELIC/Outreach/$WEEK-roster.md)"
)

if [[ "$SKIP_PULLS" == "1" ]]; then
    runner_replay || exit 1
else
    # The agent's whole job is reading systems of record through these, so a
    # missing one is a failed run and not a degraded one.
    require_tools claude jq curl timeout hs gws agent-browser || exit 1
    # The .account marker under this directory is what points hs at the Atelic
    # portal and gws at the atelic mailbox. Running from anywhere else silently
    # reads the wrong CRM, which is the expensive failure, so this is a hard
    # gate rather than a warning.
    if [[ ! -d "$ATELIC" ]]; then
        fail_reason="the Atelic repo is not at $ATELIC"
        exit 1
    fi
    cd "$ATELIC" || { fail_reason="cannot enter $ATELIC"; exit 1; }
    prompt="Prep the weekly outreach roster for ISO week $WEEK. Write the roster to $ATELIC/Outreach/$WEEK-roster.md, the one path outside the scratch directory you may write; do not stage it and do not commit it. Scratch directory for scripts and working files: $WORK. Run the full method in your definition and end with the success line."
    runner_claude "$prompt" --agent outreacher --allowedTools "${ALLOWED_TOOLS[@]}" || exit 1
fi

# A completed turn is not enough: the success line the agent is told to end
# with is what actually confirms the roster was written.
if ! jq -e --arg line "$SUCCESS_LINE" '(.result // "") | contains($line)' <<<"$result" >/dev/null; then
    fail_reason="the agent did not confirm the roster: expected \"$SUCCESS_LINE\""
    exit 1
fi

# The report renders from the agent's own result: there is no draft object
# here, the roster is the artifact and it lives in the Atelic repo.
DRAFT_JSON="$RESULT_JSON"
runner_render || exit 1
status="success"
