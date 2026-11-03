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

# ---------- waiting on a Cloud Build ----------
# promote submits a build without waiting and follows it here, because
# gcloud's own wait is tied to a log read the deploy identity may be refused
# (bin/runner/promote says how that was learned). Every number is overridable
# from the environment, which is also how bin/lint/runner-build-test drives
# the wait in seconds against a fake gcloud.

# Where a build writes its log: a directory in the project's own Cloud Build
# bucket, named the way gcloud names that bucket. The default logs bucket is
# readable only by a project Viewer or Owner; this one is readable by anyone
# granted on the bucket, which the deploy identity is. Set it empty to fall
# back to the default logs bucket.
RUNNER_BUILD_LOG_DIR="${RUNNER_BUILD_LOG_DIR-gs://${RUNNER_PROJECT}_cloudbuild/logs}"

# How long a build may take, submit to verdict, before it is cancelled and the
# promote fails. Twenty minutes: the twelve builds before this was written all
# finished in under two, so this is ten times the worst of them, and it is
# under the thirty the promote workflow gives a job, so the cancel here runs
# before GitHub kills the job and leaves the build behind. Cloud Build's own
# default is sixty minutes, which nothing here could wait out.
RUNNER_BUILD_DEADLINE="${RUNNER_BUILD_DEADLINE:-1200}"

# Seconds between status reads, how long reads may fail in a row before the
# wait gives up, and how often a quiet wait says it is alive.
RUNNER_BUILD_POLL="${RUNNER_BUILD_POLL:-5}"
RUNNER_BUILD_MISS_LIMIT="${RUNNER_BUILD_MISS_LIMIT:-120}"
RUNNER_BUILD_HEARTBEAT="${RUNNER_BUILD_HEARTBEAT:-30}"

# Usage: runner_build_cancel <build-id>
# Only what gcloud prints on success is dropped. Its errors come through, so
# a cancel that fails shows why.
runner_build_cancel() {
    gcloud builds cancel "$1" --project="$RUNNER_PROJECT" >/dev/null
}

# Usage: runner_build_wait <build-id> [started]
# Follows a build to its end by its status and returns 0 only for SUCCESS.
#   1  the build ended some other way (failed, cancelled, timed out, expired)
#   2  the deadline passed; the build was cancelled
#   3  its status could not be read for too long; the build was cancelled
#   4  either of those two, and the cancel itself failed: the build may still
#      be running, and the caller must say so and never call it cancelled
# So when this returns below 4 the build is over or has been told to stop,
# and a caller has nothing left running to clean up. `started` is $SECONDS at
# the submit, so the deadline covers the whole build and not only this wait.
#
# The heartbeat prints whether or not a log is streaming beside this. A
# refused log read leaves gcloud waiting in silence until the build ends, so
# "is the stream alive" says nothing about whether anything is being printed,
# and one status line every half minute is a small price in a live log.
#
# The status is read before the deadline is checked, on purpose: a build that
# succeeds on the last read is a success, and cancelling it there would leave
# a pushed image no job was pointed at.
runner_build_wait() {
    local id="$1" started="${2:-$SECONDS}"
    local build_status miss_since="" last_beat="$SECONDS" errfile
    errfile="$(mktemp)" || return 3
    while :; do
        if build_status="$(gcloud builds describe "$id" --project="$RUNNER_PROJECT" \
            --format='value(status)' 2>"$errfile")" && [[ -n "$build_status" ]]; then
            miss_since=""
            case "$build_status" in
                SUCCESS)
                    rm -f "$errfile"; return 0 ;;
                QUEUED|PENDING|WORKING|STATUS_UNKNOWN) ;;
                *)
                    echo "build $id ended as $build_status" >&2
                    rm -f "$errfile"; return 1 ;;
            esac
        else
            # One dropped read must not fail a promote whose build is fine, so
            # a run of them is forgiven for a while. When it is not, the last
            # error is shown, since it is the only clue there is.
            build_status="unread"
            [[ -n "$miss_since" ]] || miss_since="$SECONDS"
            if (( SECONDS - miss_since >= RUNNER_BUILD_MISS_LIMIT )); then
                echo "the status of build $id could not be read for $(( SECONDS - miss_since )) seconds; the last error was:" >&2
                sed 's/^/    /' "$errfile" >&2
                echo "cancelling build $id so it is not left running" >&2
                rm -f "$errfile"
                runner_build_cancel "$id" && return 3
                echo "the cancel of build $id failed, so it may still be running" >&2
                return 4
            fi
        fi
        if (( SECONDS - started >= RUNNER_BUILD_DEADLINE )); then
            echo "build $id is still $build_status after $(( SECONDS - started )) seconds, past the $RUNNER_BUILD_DEADLINE allowed; cancelling it" >&2
            rm -f "$errfile"
            runner_build_cancel "$id" && return 2
            echo "the cancel of build $id failed, so it may still be running" >&2
            return 4
        fi
        if (( SECONDS - last_beat >= RUNNER_BUILD_HEARTBEAT )); then
            last_beat="$SECONDS"
            echo "build $id: $build_status, $(( SECONDS - started )) seconds in"
        fi
        sleep "$RUNNER_BUILD_POLL"
    done
}

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

# Resolve and validate a runner into its source directory. The one resolver:
# every command hands its first argument here and works from what comes back.
#
# A bare name is runners/<name> in this repository, as it always was. Anything
# with a slash in it is a path to a runner directory, absolute or relative to
# where the command was typed, which is how a runner that lives in another
# repository is named: that repository checks this one out and runs these
# commands against its own directory. The path is resolved physically, so the
# name every caller takes from it (the last component, which names the Cloud
# Run job and the image) is the directory's real one and never a symlink's or
# a trailing dot's.
runner_dir() {
    local name="${1:-}" root dir
    [[ -n "$name" ]] || die "usage: ${0##*/} <runner-name-or-path> [options]"
    if [[ "$name" == */* ]]; then
        dir="$(cd -P "$name" 2>/dev/null && pwd)" || die "no runner directory at '$name'"
    else
        root="$(runner_repo_root)"
        dir="$root/runners/$name"
        [[ -d "$dir" ]] || die "no runner named '$name' (looked in $root/runners)"
    fi
    [[ -f "$dir/entrypoint.sh" ]] || die "$dir has no entrypoint.sh"
    printf '%s' "$dir"
}

# Usage: runner_source_root <runner-dir>
# The top of the repository a runner lives in, printed physical, or the runner
# directory itself when it is in no repository. This is the fence a manifest
# may reach up to and never past.
#
# git's own variables are dropped for the one call because a commit hook
# exports where its repository is, and with those set the answer would be the
# repository being committed to, whatever directory was asked about.
runner_source_root() {
    local top
    if top="$(env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_PREFIX -u GIT_COMMON_DIR \
        git -C "$1" rev-parse --show-toplevel 2>/dev/null)" && [[ -n "$top" ]]; then
        (cd -P "$top" && pwd)
    else
        printf '%s\n' "$1"
    fi
}

# Usage: runner_source_path <runner-dir> <relative-path> <what it is, for the error>
# Resolves a path a manifest names, relative to the runner directory, and
# prints it absolute and physical. It may reach up with `..`, since what a
# runner ships can sit elsewhere in its own repository, and it is refused the
# moment it resolves outside that repository: a manifest that could name any
# file on the machine would put it in an image. Resolved physically for that
# reason, so a symlinked directory is judged by where it really is, and a
# file that is itself a symlink is refused outright rather than followed.
runner_source_path() {
    local dir="$1" rel="$2" what="$3" abs parent fence
    case "$rel" in
        ""|/*) echo "$what '$rel' has to be a path relative to $dir" >&2; return 1 ;;
    esac
    if [[ -d "$dir/$rel" ]]; then
        abs="$(cd -P "$dir/$rel" && pwd)" || return 1
    elif [[ -L "$dir/$rel" ]]; then
        echo "$what '$rel' is a symlink to a file, which is not followed; name the file itself" >&2
        return 1
    elif [[ -f "$dir/$rel" ]]; then
        parent="$(cd -P "$(dirname "$dir/$rel")" && pwd)" || return 1
        abs="$parent/$(basename "$rel")"
    else
        echo "$what '$rel' does not exist (looked from $dir)" >&2
        return 1
    fi
    fence="$(runner_source_root "$dir")"
    if [[ "$abs" != "$fence" && "$abs" != "$fence"/* ]]; then
        echo "$what '$rel' resolves to $abs, which is outside $fence; a runner ships files from its own repository only" >&2
        return 1
    fi
    printf '%s' "$abs"
}

# Usage: runner_source_ignored <runner-dir> <absolute-path>
# Whether a file or a folder is one its repository ignores, which is 0 for
# yes. What a manifest names has to be something git can see: promote's
# dirty gate asks git status about every source, and status says nothing at
# all about an ignored path, so one named by a `context` line or brought as
# an agent would ship in an image from a tree the gate had called clean, and
# no commit would ever hold what shipped. A folder counts when it is ignored
# itself or sits under one that is, a gitignored clone being the likely
# case. A tracked file is never reported here, whatever pattern it matches,
# and a runner in no repository has no gate to route around, so both are 1.
#
# Only the folder a line names is asked, never what is inside it: the
# ignored contents of a folder git can see (an install, a build) are that
# folder's own business, and the staging already leaves .git and .env.local
# out of one.
runner_source_ignored() {
    local fence
    fence="$(runner_source_root "$1")"
    env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_PREFIX -u GIT_COMMON_DIR \
        git -C "$fence" check-ignore -q -- "$2" 2>/dev/null
}

# Usage: runner_lexical_path <path>
# A path with its `.` and `..` folded away by the text alone, no filesystem
# asked, and returns non zero when it climbs above where it started. This is
# for bin/runner/changed, which reads manifests out of a commit and has no
# tree on disk to resolve against; the staging resolves the real thing with
# runner_source_path. Prints `.` for the starting point itself.
runner_lexical_path() {
    local parts=() out=() part IFS=/
    read -r -a parts <<< "$1"
    for part in ${parts[@]+"${parts[@]}"}; do
        case "$part" in
            ""|.) ;;
            ..)   (( ${#out[@]} )) || return 1
                  unset "out[$(( ${#out[@]} - 1 ))]" ;;
            *)    out+=("$part") ;;
        esac
    done
    if (( ${#out[@]} )); then printf '%s' "${out[*]}"; else printf '.'; fi
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
# A runner shipped without the first two and every scheduled run died in
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

    # The Pinole work API token, under the Keychain service the pinole CLI
    # itself reads on this machine. It still has to be exported: a container
    # has no Keychain, so the CLI inside it reads PINOLE_API_TOKEN or nothing.
    if [[ -z "${PINOLE_API_TOKEN:-}" ]]; then
        PINOLE_API_TOKEN="$(security find-generic-password -s pinole-mcp-token -w)" || true
        [[ -n "$PINOLE_API_TOKEN" ]] && export PINOLE_API_TOKEN || unset PINOLE_API_TOKEN
    fi

    # The YNAB and Todoist tokens the brief runner's planning pulls read, under
    # the Keychain services the ynab and td CLIs keep them in (the vault secret
    # of each carries the same name). Exported for the same reason as above: a
    # container has no Keychain. Only for the brief: a credential a runner does
    # not need never enters its container, since a runner that reads untrusted
    # pages (the recruiter) and holds curl is one injection from sending it out.
    if [[ "$runner" == "brief" ]]; then
        if [[ -z "${YNAB_API_KEY:-}" ]]; then
            YNAB_API_KEY="$(security find-generic-password -s ynab-token -w 2>/dev/null)" || true
            [[ -n "$YNAB_API_KEY" ]] && export YNAB_API_KEY || unset YNAB_API_KEY
        fi
        if [[ -z "${TODOIST_API_TOKEN:-}" ]]; then
            TODOIST_API_TOKEN="$(security find-generic-password -s todoist-api-token -w 2>/dev/null)" || true
            [[ -n "$TODOIST_API_TOKEN" ]] && export TODOIST_API_TOKEN || unset TODOIST_API_TOKEN
        fi
    fi

    # Who a runner reports to is a property of the runner, not of the machine:
    # the brief is personal and the outreach roster is Atelic work, and they go
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
        printf '%s\n' CLAUDE_CODE_OAUTH_TOKEN RESEND_API_KEY PINOLE_API_TOKEN REPORT_RECIPIENT REPORT_SENDER TZ RUNNER_MODEL
        # The planning credentials and flags cross only into the brief's
        # container; every other runner's names come from its own .env.local.
        if [[ "$(basename "$1")" == "brief" ]]; then
            printf '%s\n' YNAB_API_KEY TODOIST_API_TOKEN LINEAR_API_KEY GWS_OAUTH_TOKEN_PERSONAL_JSON GWS_OAUTH_TOKEN_ATELIC_JSON BRIEF_WRITE PLANNING_PULLS
        fi
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

    # Where the entrypoint side library is, for every runner alike. One in
    # this repository finds runner.sh a level above itself and never reads
    # this. One that lives in another repository has no such neighbour, so
    # its entrypoint tries $RUNNER_LIB_DIR/runner.sh after the copy an image
    # sets beside it, and the scaffold then finds the pull scripts and this
    # runner's bundle from that same directory. Set unconditionally: a value
    # inherited from a shell that ran another checkout's commands would
    # source that checkout's library under this one's driver.
    RUNNER_LIB_DIR="$(dirname "$(runner_entrypoint_lib)")"
    export RUNNER_LIB_DIR

    # This runner's own bundle, built or refreshed before the entrypoint is
    # started, since on this path nothing else builds one and the scaffold
    # only ever reads the file. A bundle that will not build is said out loud
    # and the run goes on: the scaffold says the same at its render step and
    # mails the failure page, which is where a missing bundle always ended.
    runner_email_bundle "$dir" >/dev/null \
        || echo "WARNING: could not build the email bundle for $(basename "$dir"); the render step will fail" >&2

    "$dir/entrypoint.sh"
}

# What sits in a runner's directory and never reaches its staged context, as
# names relative to that directory. Stated once because two things have to
# agree on it: runner_build_context, which leaves these out of the image, and
# bin/runner/changed, which must not promote a runner over a change to one of
# them. A copy kept in each would drift toward a merge that changes an image
# and promotes nothing. `agents`, `context` and `mounts` are the manifests
# that drive the staging and never ship themselves, though a change to
# `agents` or `context` changes what does, and changed knows that.
RUNNER_CONTEXT_EXCLUDES="out .build .env.local agents context mounts tst job.json"

# Usage: runner_manifest_lines < <manifest>
# A manifest's lines: blank lines and comments dropped, and the whitespace
# around a line with them, since that is what `read` does.
runner_manifest_lines() {
    local n
    # The second test is for a last line with no newline after it: `read`
    # fills the variable and still reports failure there, and a bare
    # `while read` would drop that line. IFS is left alone on purpose, since
    # the trimming is `read` splitting on it.
    while read -r n || [[ -n "$n" ]]; do
        [[ -n "$n" && "$n" != \#* ]] || continue
        printf '%s\n' "$n"
    done
}

# Usage: runner_agent_names < <agents manifest>
# The agents a manifest names, one `name=path` per line. A manifest line is
# either a bare name, which is .claude/agents/<name>.md in this repository
# and comes out here as `name=` with nothing after it, or `name=path`, which
# is a definition the runner brings from its own repository, the path
# relative to the runner directory. The second form is how a runner that
# lives elsewhere ships an agent this repository has never heard of. Either
# way the image gets agents/<name>.md.
#
# The one reader of the format, for the same reason as the list above: the
# staging and the promote rules must see the same names. A caller splits a
# line with ${line%%=*} and ${line#*=}.
runner_agent_names() {
    local n
    while read -r n; do
        case "$n" in
            *=*) printf '%s\n' "$n" ;;
            *)   printf '%s=\n' "$n" ;;
        esac
    done < <(runner_manifest_lines)
}

# Usage: runner_context_entries < <context manifest>
# What a `context` manifest asks to be added to the staged context, one
# `source:dest` per line. The source is relative to the runner directory and
# may be a file or a directory; the dest is where it lands, relative to the
# staged context. Read here and judged by the caller, since the staging
# refuses a bad line and the promote rules only need to know what is named.
runner_context_entries() { runner_manifest_lines; }

# Usage: runner_email_stage <runner-dir> <dest-dir>
# The renderer's sources as one flat project in <dest-dir>: this repository's
# runners/email (its node_modules and its build left behind), then whatever
# the runner keeps in an email/ folder of its own, copied in beside them. So a
# page that lives with its runner imports ./jq, ./local, ./text, ./types and
# ./records as though it had been written in runners/email, and resolves the
# same packages from the same install.
#
# A file of the runner's that would land on one of the shared sources is
# refused and never overwritten: the copy that lost would be the one nobody
# was reading, in every image built from here.
runner_email_stage() {
    local dir="$1" dest="$2" root f rel
    root="$(runner_repo_root)"
    mkdir -p "$dest" || return 1
    (cd "$root/runners/email" && tar --exclude=./node_modules --exclude=./dist -cf - .) \
        | (cd "$dest" && tar -xf -) || return 1
    [[ -d "$dir/email" ]] || return 0
    while IFS= read -r -d '' f; do
        rel="${f#"$dir/email/"}"
        if [[ -e "$dest/$rel" ]]; then
            echo "$dir/email/$rel has the name of a file in runners/email, and neither may replace the other; rename it" >&2
            return 1
        fi
        mkdir -p "$(dirname "$dest/$rel")" && cp "$f" "$dest/$rel" || return 1
    done < <(find "$dir/email" \( -name node_modules -o -name dist \) -prune -o -type f -print0)
}

# Usage: runner_build_context <runner-dir> [staging-dir]
# Stages what a runner's image is built from and prints the directory. The
# staging directory is the runner's own .build/ unless a second argument
# names another, which is how a check stages a context without wiping the
# one a promote or a run-local in another session is building from. A Docker
# context cannot reach above its own root, and neither can the tarball gcloud
# builds submit uploads, yet a runner shares runners/lib/runner.sh and may ship
# an agent definition from .claude/agents/. So the context is assembled: the
# runner's own files (out/, .env.local and any prior staging left out),
# lib/ and email/ from this repository, agents/<name>.md for each agent the
# runner's `agents` file names, and whatever its `context` file adds. Built
# fresh every time, under the runner's gitignored .build/, so a stale copy of
# the library can never ship.
#
# The runner directory may be anywhere. One in another repository gets the
# same lib/ and the same renderer from this one, and brings the rest itself:
# a page in its own email/ folder, an agent by path, and through `context`
# any other file of its repository the image needs.
runner_build_context() {
    local dir="$1" root staged staged_real n p src dest entry excludes=() e
    root="$(runner_repo_root)"
    staged="${2:-$dir/.build}"
    rm -rf "$staged" && mkdir -p "$staged/lib" || return 1
    staged_real="$(cd -P "$staged" && pwd)" || return 1
    # The manifests drive this side and never ship; and `agents` the file
    # would collide with agents/ the directory below. A runner's own email/
    # is left for runner_email_stage, which sets it beside the shared
    # renderer and refuses a clash that a copy here would hide.
    for e in $RUNNER_CONTEXT_EXCLUDES email; do excludes+=("--exclude=./$e"); done
    (cd "$dir" && tar "${excludes[@]}" -cf - .) \
        | (cd "$staged" && tar -xf -) || return 1
    # The whole shared library: runner.sh for the entrypoint, the pull
    # scripts, and whatever joins them. Files only: this copy is flat, so a
    # directory under runners/lib makes cp fail and every promote and every
    # container run of every runner dies here, staging its context. That
    # shipped once (ATE-630, the unit tests, 2026-10-07) and bin/lint/runners
    # refuses it since.
    cp "$root/runners/lib/"* "$staged/lib/" || return 1
    # The node renderer's sources, as a sibling of lib/ rather than a child,
    # because the flat copy above carries files and not directories. Its
    # node_modules and its build stay behind: the image's first stage installs
    # and builds its own, so nothing here can ship a stale bundle.
    runner_email_stage "$dir" "$staged/email" || return 1
    if [[ -r "$dir/agents" ]]; then
        mkdir -p "$staged/agents" || return 1
        while read -r entry; do
            n="${entry%%=*}"; p="${entry#*=}"
            if [[ -z "$n" || "$n" == */* ]]; then
                echo "'$n' is not an agent name (listed in $dir/agents)" >&2
                return 1
            fi
            if [[ -n "$p" ]]; then
                # The runner's own definition, from its own repository.
                src="$(runner_source_path "$dir" "$p" "the agent '$n' in $dir/agents, at")" || return 1
                if [[ ! -f "$src" ]]; then
                    echo "the agent '$n' in $dir/agents names $p, which is not a file" >&2
                    return 1
                fi
                if runner_source_ignored "$dir" "$src"; then
                    echo "the agent '$n' in $dir/agents names $p, which git ignores; the dirty gate cannot see an ignored file, so it is never staged" >&2
                    return 1
                fi
            else
                src="$root/.claude/agents/$n.md"
                if [[ ! -r "$src" ]]; then
                    echo "no agent named '$n' in .claude/agents (listed in $dir/agents)" >&2
                    return 1
                fi
            fi
            cp "$src" "$staged/agents/$n.md" || return 1
        done < <(runner_agent_names < "$dir/agents")
    fi
    # Last, so a line here can be held against everything already staged: a
    # dest that is taken is refused, since the two files would otherwise ship
    # as whichever was copied second.
    if [[ -r "$dir/context" ]]; then
        while read -r entry; do
            src="${entry%%:*}"; dest="${entry#*:}"
            if [[ "$entry" != *:* || -z "$src" || -z "$dest" ]]; then
                echo "'$entry' in $dir/context is not source:dest" >&2
                return 1
            fi
            case "$dest" in
                /*|..|../*|*/..|*/../*)
                    echo "the dest '$dest' in $dir/context has to stay inside the staged context" >&2
                    return 1 ;;
            esac
            src="$(runner_source_path "$dir" "$src" "the context source")" || return 1
            # A source that holds the staging directory would be copied into
            # itself: the runner's own directory or anything above it, while
            # the context is staged in .build/.
            if [[ "$staged_real" == "$src" || "$staged_real" == "$src"/* ]]; then
                echo "the context source '${entry%%:*}' in $dir/context holds the staging directory $staged_real; name something narrower" >&2
                return 1
            fi
            if [[ -e "$staged/$dest" ]]; then
                echo "the dest '$dest' in $dir/context is already in the staged context, and nothing is overwritten" >&2
                return 1
            fi
            if runner_source_ignored "$dir" "$src"; then
                if [[ -d "$src" ]]; then
                    echo "the context source '${entry%%:*}' in $dir/context is a folder git ignores; the dirty gate cannot see an ignored folder, so it is never staged" >&2
                else
                    echo "the context source '${entry%%:*}' in $dir/context is a file git ignores; the dirty gate cannot see an ignored file, so it is never staged" >&2
                fi
                return 1
            fi
            mkdir -p "$(dirname "$staged/$dest")" || return 1
            if [[ -d "$src" ]]; then
                # A repository's own directory and a fetched environment
                # file are never what a line here means, wherever they sit.
                mkdir "$staged/$dest" || return 1
                (cd "$src" && tar --exclude=.git --exclude=.env.local -cf - .) \
                    | (cd "$staged/$dest" && tar -xf -) || return 1
            else
                cp "$src" "$staged/$dest" || return 1
            fi
        done < <(runner_context_entries < "$dir/context")
    fi
    printf '%s' "$staged"
}

# Usage: runner_source_paths <runner-dir>
# Every path outside this repository's shared directories that a runner's
# image is built from, absolute, one per line: the runner directory, each
# source its `context` names, and each agent it brings by path. What promote
# asks git about before it builds, so a manifest cannot route an uncommitted
# file around the dirty gate.
runner_source_paths() {
    local dir="$1" entry p
    printf '%s\n' "$dir"
    if [[ -r "$dir/agents" ]]; then
        while read -r entry; do
            p="${entry#*=}"
            [[ -n "$p" ]] || continue
            runner_source_path "$dir" "$p" "the agent '${entry%%=*}' in $dir/agents, at" || return 1
            echo
        done < <(runner_agent_names < "$dir/agents")
    fi
    if [[ -r "$dir/context" ]]; then
        while read -r entry; do
            runner_source_path "$dir" "${entry%%:*}" "the context source" || return 1
            echo
        done < <(runner_context_entries < "$dir/context")
    fi
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
    # next cloud run could not refresh (vault_write_back in the brief's
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

    local context
    context="$(runner_build_context "$dir")" || die "could not stage the build context for $name"
    local build=(docker build -q -t "$image")
    [[ -z "${RUNNER_PLATFORM:-}" ]] || build+=(--platform "$RUNNER_PLATFORM")
    echo "docker: building $image from $context"
    "${build[@]}" "$context" >/dev/null || die "docker build failed for $name"

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

    # A runner may name host paths to mount for a local run in its `mounts`
    # file, one host:container[:ro] per line with $HOME expanded: a checkout
    # standing in for a deploy key clone, an agent's memory directory. Only a
    # local run sees these; the job gets its inputs the production way.
    local mounts=(-v "$WORK:/home/runner/work") m
    if [[ -r "$dir/mounts" ]]; then
        while read -r m; do
            [[ -n "$m" && "$m" != \#* ]] || continue
            m="${m//\$HOME/$HOME}"
            [[ -e "${m%%:*}" ]] || die "mount source ${m%%:*} (from $dir/mounts) does not exist"
            mounts+=(-v "$m")
        done < "$dir/mounts"
    fi

    echo "docker: running $image with $WORK mounted at /home/runner/work"
    docker run --rm "${args[@]}" "${mounts[@]}" "$image"
}

# Usage: runner_email_artifact <work-dir>
# The rendered email a runner left behind, which `mail` sends and `run-local`
# opens: $WORK/email.html, written by the scaffold's runner_render (or its
# failure page) for every runner since ATE-543.
runner_email_artifact() {
    local work="$1"
    [[ -s "$work/email.html" ]] && { printf '%s' "$work/email.html"; return 0; }
    return 1
}

# Usage: runner_email_bundle <runner-dir>
# One runner's bundle of the node renderer (its page and the failure page),
# built first when it is missing or stale, and its path printed. This is the
# driver side, which is the half allowed to know this machine has npm on it;
# the entrypoint side only ever reads the file. An image builds its own copy
# in its first stage.
#
# A bundle per runner, dist/render-<name>.cjs, because a bundle carries one
# page: a single file would be the last runner's, and the next one to render
# would be told its page is unknown. Stale means older than any source, the
# runner's own email/ folder included, or built for another directory: a
# runner in another repository may wear the name of one in here, and the
# directory a bundle was built from is written beside it so the two never
# pass for each other.
#
# A runner with an email/ folder of its own is built from a merged copy of
# the sources under dist/, the same merge an image is built from, which sits
# below runners/email so the packages still resolve from the one install.
runner_email_bundle() {
    local dir="$1" root email name bundle stamp merged newer="" own=""
    root="$(runner_repo_root)"
    email="$root/runners/email"
    name="$(basename "$dir")"
    bundle="$email/dist/render-$name.cjs"
    stamp="$bundle.from"
    [[ -d "$email" ]] || { echo "no runners/email under $root" >&2; return 1; }
    [[ ! -d "$dir/email" ]] || own="$dir/email"
    if [[ -s "$bundle" ]]; then
        if [[ "$(cat "$stamp" 2>/dev/null)" != "$dir" ]]; then
            newer="built for another directory"
        else
            newer="$(find "$email" ${own:+"$own"} \( -name node_modules -o -name dist \) -prune -o \
                -type f -newer "$bundle" -print -quit 2>/dev/null)"
        fi
    fi
    if [[ ! -s "$bundle" || -n "$newer" ]]; then
        [[ -d "$email/node_modules" ]] || npm --prefix "$email" install --no-audit --no-fund >&2 || return 1
        rm -f "$stamp"
        if [[ -n "$own" ]]; then
            merged="$email/dist/src-$name"
            rm -rf "$merged" || return 1
            runner_email_stage "$dir" "$merged" >&2 || return 1
            RUNNER="$name" npm --prefix "$merged" run build >&2 || return 1
            cp "$merged/dist/render-$name.cjs" "$bundle" || return 1
        else
            RUNNER="$name" npm --prefix "$email" run build >&2 || return 1
        fi
        printf '%s\n' "$dir" > "$stamp" || return 1
    fi
    printf '%s' "$bundle"
}
