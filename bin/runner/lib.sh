# shellcheck shell=bash
# Shared plumbing for the runner commands.
#
# Sourced by bin/runner/*, which would otherwise each hard-code the GCP
# coordinates and each grow its own copy of the "which gcloud identity can read
# this vault" dance. The same three-copies problem already produced
# bin/lib/account-profile.sh and bin/lib/vault.sh; this is the third instance
# of the lesson, not the first.

RUNNER_PROJECT="${RUNNER_PROJECT:-atelic}"
RUNNER_REGION="${RUNNER_REGION:-us-central1}"
RUNNER_REGISTRY="${RUNNER_REGISTRY:-us-central1-docker.pkg.dev/$RUNNER_PROJECT/runners}"

die() { echo "${0##*/}: $*" >&2; exit 1; }

# The repository root, found from this library rather than from $PWD, so every
# command works from anywhere.
#
# The -P is load bearing and its absence shipped broken. $HOME/bin is a symlink
# to this repo's bin/, so a caller reached through it (the LaunchAgent names
# $HOME/bin/runner/run-scheduled, and so does anyone typing the short path)
# gets a logical $PWD, and `..` then walks the symlink's parent rather than the
# real one: /Users/<user>/bin/runner/../.. is /Users/<user>, not the repo. Every
# runner then resolved against $HOME/runners, which does not exist. Resolving
# this directory physically first makes `..` walk the real tree.
runner_repo_root() {
    local here
    here="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    cd "$here/../.." && pwd
}

# Resolve and validate a runner name into its source directory.
runner_dir() {
    local name="${1:-}" root dir
    [[ -n "$name" ]] || die "usage: ${0##*/} <runner-name> [options]"
    root="$(runner_repo_root)"
    dir="$root/runners/$name"
    [[ -d "$dir" ]] || die "no runner named '$name' (looked in $root/runners)"
    [[ -f "$dir/entrypoint.sh" ]] || die "$dir has no entrypoint.sh"
    printf '%s' "$dir"
}

# The vaults answer to two identities and the active gcloud account is only
# ever one of them, so a read that spans both projects has to try each. The
# working account is cached per project for the life of the process, since a
# fetch-env run reads eight secrets and probing on every one is slow.
#
# A newline delimited "project<TAB>account" string rather than an associative
# array, for the same reason bin/vault/push-secrets uses one: the shebang is
# `env bash`, which resolves to bash 3.2 on a Mac with no homebrew bash on
# PATH, and 3.2 has no `declare -A`. Sourcing this would fail outright there.
RUNNER_VAULT_ACCOUNTS=""

runner_vault_account() {
    printf '%s\n' "$RUNNER_VAULT_ACCOUNTS" | while IFS="$(printf '\t')" read -r p a; do
        [[ "$p" == "$1" ]] || continue
        printf '%s' "$a"
        break
    done
}

runner_access_secret() {
    # $1 project, $2 secret name, $3 version
    local project="$1" name="$2" version="${3:-latest}" account value cached
    cached="$(runner_vault_account "$project")"
    if [[ -n "$cached" ]]; then
        gcloud secrets versions access "$version" --secret="$name" --project="$project" \
            --account="$cached" 2>/dev/null && return 0
        return 1
    fi
    while read -r account; do
        [[ -n "$account" ]] || continue
        if value="$(gcloud secrets versions access "$version" --secret="$name" --project="$project" --account="$account" 2>/dev/null)"; then
            RUNNER_VAULT_ACCOUNTS="$RUNNER_VAULT_ACCOUNTS$project$(printf '\t')$account
"
            printf '%s' "$value"
            return 0
        fi
    done < <(gcloud auth list --filter=-status:INVALID --format='value(account)' 2>/dev/null)
    return 1
}

# ---------- this machine's side of a local run ----------
# Everything below knows it is on Forni's Mac. The entrypoint library
# (runners/lib/runner.sh) deliberately knows nothing of the sort, so this is
# where the Keychain, ~/.config and the PATH live. A runner running in Cloud
# Run never reaches any of it.

# The entrypoint side library, found from this file so a caller can source it
# without knowing the layout.
runner_entrypoint_lib() { printf '%s/runners/lib/runner.sh' "$(runner_repo_root)"; }

# The PATH a locally executed runner needs, which is longer than it looks like
# it needs to be. $HOME/bin carries the gws and hs shims and has to win, the
# same precedence .zshrc finalizes with; $HOME/.local/share/mise/shims is how a
# non interactive shell reaches what `mise activate` wires for an interactive
# one, and the real hs is an npm global under mise managed node.
# $HOME/.local/bin must stay ahead of /opt/homebrew/bin or `claude` resolves to
# the brew build, which has no plugin context and answers every skill with
# "Unknown skill".
#
# The Outreacher shipped without the first two and every Monday run died in
# preflight on "hs not on PATH" (2026-08-31). launchd starts a job with an
# empty environment and never sources a shell, so this cannot be inherited and
# has to be stated. Keep it identical in launchagents/*.plist, which cannot
# read it from here.
runner_local_path() {
    printf '%s' "$HOME/bin:$HOME/.local/bin:$HOME/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
}

# Fills in, from this machine's vaults, the environment variables Cloud Run
# would inject from Secret Manager. Only ever fills a gap: anything already set
# wins, so a .env.local fetched from a deployed job keeps production parity and
# an explicit override on the command line always survives.
#
# Missing credentials are not fatal here. What a run actually needs depends on
# what it will do, and the entrypoint's own `require` is the place that knows;
# failing here would make a dry run over cached pulls impossible.
#
# Usage: runner_local_credentials [runner-name]
# The name is optional and only steers the recipient.
runner_local_credentials() {
    local runner="${1:-}"
    local config_dir="$HOME/.config/headless-report"

    if [[ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
        CLAUDE_CODE_OAUTH_TOKEN="$(security find-generic-password -s claude-code-oauth -w)" || true
        # The file fallback predates the Keychain entry and is still how a
        # freshly imaged machine gets going before `claude setup-token` runs.
        if [[ -z "$CLAUDE_CODE_OAUTH_TOKEN" && -r "$HOME/.claude/.oauth-token" ]]; then
            CLAUDE_CODE_OAUTH_TOKEN="$(cat "$HOME/.claude/.oauth-token")"
        fi
        [[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]] && export CLAUDE_CODE_OAUTH_TOKEN || unset CLAUDE_CODE_OAUTH_TOKEN
    fi

    if [[ -z "${RESEND_API_KEY:-}" ]]; then
        RESEND_API_KEY="$(security find-generic-password -s resend-api-key -w)" || true
        [[ -n "$RESEND_API_KEY" ]] && export RESEND_API_KEY || unset RESEND_API_KEY
    fi

    # Who a runner reports to is a property of the runner, not of the machine:
    # the retro is personal and the outreach roster is Atelic work, and they go
    # to different mailboxes. So a runner may name its own recipient in
    # recipient-<name>, and recipient is the shared fallback for the rest.
    #
    # The addresses live in ~/.config rather than in the repo because homebase
    # is public. That was already true of the shared file and stays true here;
    # a per runner file is the same convention, not a new one.
    if [[ -z "${REPORT_RECIPIENT:-}" ]]; then
        local candidates=() f
        # An explicit file override wins outright, which is how a test run
        # sends somewhere harmless.
        [[ -n "${EMAIL_REPORT_RECIPIENT_FILE:-}" ]] && candidates+=("$EMAIL_REPORT_RECIPIENT_FILE")
        [[ -n "$runner" ]] && candidates+=("$config_dir/recipient-$runner")
        candidates+=("$config_dir/recipient")
        for f in "${candidates[@]}"; do
            [[ -r "$f" ]] || continue
            # First non empty, non comment line, with any stray whitespace
            # stripped. Fails loud rather than sending to a Frankenstein
            # recipient if the file ever grows comments or a second address.
            REPORT_RECIPIENT="$(awk 'NF && !/^[[:space:]]*#/ {print; exit}' "$f" | tr -d '[:space:]')"
            [[ -n "$REPORT_RECIPIENT" ]] && break
        done
        [[ -n "${REPORT_RECIPIENT:-}" ]] && export REPORT_RECIPIENT || unset REPORT_RECIPIENT
    fi
}

# The variables a local run hands a runner, whichever way it runs it: what the
# deployed job's .env.local names, plus what runner_local_credentials fills in
# from this machine. The container path passes exactly these names through to
# docker run, so a secret that is not on this list never reaches the container
# and one that is never has to be written to a file or a command line.
#
# Usage: runner_env_names <runner-dir>
runner_env_names() {
    local envfile="$1/.env.local"
    {
        [[ -r "$envfile" ]] && sed -n "s/^export \\([A-Za-z_][A-Za-z0-9_]*\\)=.*/\\1/p" "$envfile"
        printf '%s\n' CLAUDE_CODE_OAUTH_TOKEN RESEND_API_KEY REPORT_RECIPIENT REPORT_SENDER TZ
    } | awk 'NF && !seen[$0]++'
}

# Usage: runner_local_env <runner-dir>
# Puts a runner's environment together from this machine, in the same shape
# Cloud Run would inject it. Shared by the host and container paths so the two
# differ in where the entrypoint runs and never in what it is handed.
#
# Environment precedence, weakest last: anything already exported wins, then
# the runner's .env.local if it has been fetched from a deployed job, then this
# machine's Keychain. A runner with no Cloud Run job yet has no .env.local at
# all, and that is a supported state rather than an error, because a runner
# lives locally before it is ever promoted.
runner_local_env() {
    local dir="$1"
    local envfile="$dir/.env.local"

    local local_path
    local_path="$(runner_local_path)"
    export PATH="$local_path"

    if [[ -r "$envfile" ]]; then
        echo "env: $envfile"
        # Only what is not already set. `set -a; . file` overwrites, which made
        # the documented precedence a lie: an explicit override on the command
        # line lost to the file, so a test run pointed at a harmless recipient
        # would have mailed the real one. fetch-env writes one
        # `export NAME='value'` per variable and single quotes the value, so a
        # line beginning with export at column zero is a name and a newline
        # inside a multi line value never is.
        local saved names n
        saved="$(mktemp)"
        names="$(sed -n "s/^export \\([A-Za-z_][A-Za-z0-9_]*\\)=.*/\\1/p" "$envfile")"
        for n in $names; do
            [[ -n "${!n:-}" ]] && printf 'export %s=%q\n' "$n" "${!n}" >> "$saved"
        done
        set -a
        # shellcheck source=/dev/null
        . "$envfile"
        set +a
        if [[ -s "$saved" ]]; then
            # shellcheck source=/dev/null
            . "$saved"
        fi
        rm -f "$saved"
    else
        echo "env: no $envfile; this machine's vaults only"
    fi
    runner_local_credentials "$(basename "$dir")"
}

# Usage: runner_execute <runner-dir> <send 0|1> <reuse 0|1> [week]
# Runs a runner's own entrypoint on this machine, which is the path
# `run-scheduled` takes and the one `run-local --host` takes. Having one of
# these rather than two is the point: the difference between iterating by hand
# and firing under launchd should be which flags are passed and where the
# output goes, never which code runs.
#
# A runner that has a Dockerfile is a container in production, and on this
# machine a headless `claude -p` is not what the container runs: it resolves
# the model, effort and settings from this machine's own Claude Code config,
# so a cost or a draft measured here is not production's. That is why
# `run-local` prefers runner_execute_container for such a runner and reaches
# this only on --host.
runner_execute() {
    local dir="$1" send="$2" reuse="$3" week="${4:-}"
    runner_local_env "$dir"

    WORK="${WORK:-$dir/out}"
    mkdir -p "$WORK"
    export WORK
    export DRY_RUN=$(( send ? 0 : 1 ))
    export SKIP_PULLS="$reuse"
    [[ -z "$week" ]] || export WEEK="$week"

    "$dir/entrypoint.sh"
}

# Usage: runner_execute_container <runner-dir> <send 0|1> <reuse 0|1> [week]
# Runs a runner in its own image on this machine: the Dockerfile promote ships
# is built here, and the container gets the same environment names a host run
# would, with out/ mounted as its work directory so --reuse, the rendered
# email and the saved result all land where every other local loop expects.
#
# The image is built for this machine's architecture rather than Cloud Run's,
# because the base image is multi arch and the point of the rehearsal is the
# runtime inside it (the pinned Claude Code, the bare config, the model the
# entrypoint names), none of which changes with the CPU. RUNNER_PLATFORM
# overrides that for a run that needs the exact production architecture.
runner_execute_container() {
    local dir="$1" send="$2" reuse="$3" week="${4:-}"
    local name image
    name="$(basename "$dir")"
    image="runner-$name:local"

    [[ -f "$dir/Dockerfile" ]] || die "$name has no Dockerfile, so it only runs on this machine"
    command -v docker >/dev/null 2>&1 || die "docker not found on PATH"
    docker info >/dev/null 2>&1 || die "the Docker daemon is not running; start Docker Desktop, or pass --host to run the entrypoint on this machine"

    runner_local_env "$dir"

    # The image has no gcloud and no metadata server, so a Strava rotation
    # inside it would have nowhere to write the new refresh token back and the
    # next cloud run could not refresh (vault_write_back in the retro's
    # entrypoint). A run that pulls gets this operator's own access token,
    # minted here, for exactly that one call; a --reuse run never refreshes.
    if (( ! reuse )) && [[ -z "${VAULT_ACCESS_TOKEN:-}" ]]; then
        if VAULT_ACCESS_TOKEN="$(gcloud auth print-access-token 2>/dev/null)" && [[ -n "$VAULT_ACCESS_TOKEN" ]]; then
            export VAULT_ACCESS_TOKEN
        else
            unset VAULT_ACCESS_TOKEN
            echo "WARNING: no gcloud access token on this machine; a Strava token rotation in this run would not be written back to the vault" >&2
        fi
    fi

    WORK="${WORK:-$dir/out}"
    mkdir -p "$WORK"
    export WORK

    local build=(docker build -q -t "$image")
    [[ -z "${RUNNER_PLATFORM:-}" ]] || build+=(--platform "$RUNNER_PLATFORM")
    echo "docker: building $image from $dir"
    "${build[@]}" "$dir" >/dev/null || die "docker build failed for $name"

    # Names, never values: `-e NAME` takes the value from this process's
    # environment, so a multi line secret (a deploy key, an OAuth JSON) crosses
    # intact and no secret is ever written to a file or shows in `ps`.
    local args=() n
    while read -r n; do
        [[ -n "${!n:-}" ]] && args+=(-e "$n")
    done < <(runner_env_names "$dir")
    args+=(-e "DRY_RUN=$(( send ? 0 : 1 ))" -e "SKIP_PULLS=$reuse" -e "WORK=/home/runner/work")
    [[ -z "${VAULT_ACCESS_TOKEN:-}" ]] || args+=(-e VAULT_ACCESS_TOKEN)
    [[ -z "$week" ]] || args+=(-e "WEEK=$week")
    [[ -z "${RUNNER_PLATFORM:-}" ]] || args+=(--platform "$RUNNER_PLATFORM")

    echo "docker: running $image with $WORK mounted at /home/runner/work"
    docker run --rm "${args[@]}" -v "$WORK:/home/runner/work" "$image"
}

# Usage: runner_email_artifact <work-dir>
# The rendered email a runner left behind, which `mail` sends and `run-local`
# opens. New runners write $WORK/email.html.
#
# The retro predates the convention and writes retro.html, so it is checked
# second. Folding the retro onto runners/lib/runner.sh is deliberately its own
# piece of work: it is the one runner in production, this machine has no
# .env.local for it, and a local run of it rotates the real Strava refresh
# token, so a change to it cannot be proven cheaply. The fallback goes away
# with that pass, not before.
runner_email_artifact() {
    local work="$1" candidate
    for candidate in "$work/email.html" "$work/retro.html"; do
        [[ -s "$candidate" ]] && { printf '%s' "$candidate"; return 0; }
    done
    return 1
}
