# shellcheck shell=bash
# Shared .account profile resolution.
#
# Sourced by ~/bin/gws, ~/bin/hs and .functions, which read the same `.account`
# marker convention and would otherwise each carry their own copy of this logic.
# That duplication was not theoretical: a path traversal fix on 2026-08-07 had to
# be applied three separate times, and the copy in the since retired ~/bin/claude
# wrapper was missed twice before a review caught it. One copy, three callers.
#
# Contract:
#   account_resolve_profile   -> prints the profile name for $PWD, never empty
#   account_marker_profile    -> nearest .account marker, or empty
#   account_ambient_profile   -> ~/.config/gws-current, defaulting to home
#   account_valid_profile <s> -> exit status only
#
# Callers set ACCOUNT_LOG_PREFIX to label warnings, and ACCOUNT_QUIET=1 to
# suppress them. .functions sets ACCOUNT_QUIET because it resolves on every
# chpwd and would otherwise warn on every prompt inside a tree with a broken
# marker. Keep ACCOUNT_QUIET unexported so child processes stay loud.
#
# Must stay sourceable by both bash and zsh; .functions is read by both.

# A profile name is joined straight into "$HOME/.config/gws-$profile" and
# "$HOME/.claude-$profile", so it has to be a single path component. Anything
# holding a slash or a dot could walk out of those directories. Reject rather
# than sanitize: a malformed marker silently resolving to another account is the
# exact failure the marker system exists to prevent.
account_valid_profile() {
    [[ "$1" =~ ^[A-Za-z0-9_-]+$ ]]
}

account_warn() {
    [[ -n "${ACCOUNT_QUIET:-}" ]] && return 0
    echo "${ACCOUNT_LOG_PREFIX:-account}: $1" >&2
}

# Read a one line profile name from a file. Prints nothing when the file is
# absent, empty, or holds a name that is not a single path component.
#
# The local is named `src`, not `path`, deliberately. In zsh `path` is a special
# variable tied to $PATH as an array, so `local path=...` clobbers command
# lookup for the rest of the function; any external command then fails to
# resolve and every marker silently reads as empty. Both shims are bash and
# never saw it. This library is the first copy zsh sources, so the trap is live
# here. Avoid zsh special names throughout: path, status, prompt, cdpath,
# manpath, dirstack, argv.
#
# Only leading and trailing whitespace is trimmed, never internal. Stripping
# every space would fold a marker reading "a telic" into the valid profile
# "atelic",
# selecting an account the file never named; internal whitespace instead falls
# through to the validator and is rejected loudly. Reading via $(<...) rather
# than an external command keeps this free of PATH entirely and lets an
# unreadable marker report its own error rather than vanishing into /dev/null.
account_read_profile_file() {
    local src="$1" name=""
    [[ -f "$src" ]] || return 0
    name="$(<"$src")" || return 0
    while [[ "$name" == [[:space:]]* ]]; do name="${name#?}"; done
    while [[ "$name" == *[[:space:]] ]]; do name="${name%?}"; done
    [[ -n "$name" ]] || return 0
    if ! account_valid_profile "$name"; then
        account_warn "ignoring malformed profile name in $src"
        return 0
    fi
    # Three retired names normalize forward. The zero profile retired with the
    # Zero Homes W2 and its dirs are gone; the home profile was renamed to
    # personal on 2026-08-14; the tpf profile retired 2026-09-30 with the
    # venture it served.
    # A stale marker or pointer on any machine still resolves rather than
    # landing on a config dir that no longer exists.
    [[ "$name" == "zero" || "$name" == "home" || "$name" == "tpf" ]] && name="personal"
    printf '%s' "$name"
}

# Nearest .account marker walking up from $PWD. A marker that exists but holds
# an unusable name stops the walk rather than leaking resolution to a parent,
# which would be a silent account switch.
account_marker_profile() {
    local dir="${1:-$PWD}" name=""
    while :; do
        if [[ -f "$dir/.account" ]]; then
            name="$(account_read_profile_file "$dir/.account")"
            printf '%s' "$name"
            return 0
        fi
        [[ "$dir" == "$HOME" || "$dir" == "/" ]] && return 0
        dir="$(dirname "$dir")"
    done
}

# The ambient pointer, with the default baked in. An absent, empty or malformed
# ~/.config/gws-current falls back to personal, the same name the retired zero
# and home markers normalize forward to, so no resolution path can land on a
# config dir that no longer exists.
account_ambient_profile() {
    local name
    name="$(account_read_profile_file "$HOME/.config/gws-current")"
    printf '%s' "${name:-personal}"
}

# Marker first, ambient second. Never prints empty.
account_resolve_profile() {
    local name
    name="$(account_marker_profile "${1:-$PWD}")"
    [[ -n "$name" ]] || name="$(account_ambient_profile)"
    printf '%s' "$name"
}
