# shellcheck shell=bash
# The headless Chrome identities: which port and which user data dir each one
# owns.
#
# Sourced by bin/chrome/launch-identity (which runs an instance), by
# bin/chrome/stop-identity, and by the bin/agent-browser shim (which turns
# `--identity <name>` into `--cdp <port>` and starts the instance when it is
# not up). One table, three callers, so a port can never mean one identity to
# the launcher and another to the shim.
#
# Each identity is its own Chrome instance, because Chrome allows one instance
# per user data dir and each instance gets its own CDP port. Binding by port is
# therefore binding by identity: nothing on 9223 can be signed in as anyone but
# matt@atelic.me.
#
# The names match the .account profiles in account-profile.sh, so a task that
# already knows its gws profile knows its browser.
#
# Two layers. The identities every machine has (atelic, personal) are the
# table below. Identities that belong to one engagement or one machine, and
# so have no business in a public repo, come from an overlay file,
# ~/.config/chrome-identities, one identity per line:
#
#   <name> <port> <user data dir>
#
# Blank lines and # comments are skipped, the dir may start with ~, and a
# line whose name is already in the table below is ignored with a warning,
# so the overlay can add identities but never redefine one. A name is a
# single path component (letters, digits, _ and -) and a port is digits, the
# same rule account-profile.sh applies to a profile name, since the dir is
# handed to Chrome and the name to the shell. The engagement that owns an
# overlay identity documents its line in its own repo, never here.
#
# Contract:
#   chrome_identity_port <name> -> the CDP port, or exit 1 for an unknown name
#   chrome_identity_dir <name>  -> the user data dir, or exit 1
#   CHROME_IDENTITY_NAMES       -> every known name, space separated
#   CHROME_IDENTITY_BIN         -> the Chrome binary the launcher execs
#   CHROME_IDENTITY_OVERLAY     -> the overlay file read, settable by the caller
#
# Kept to bash 3.2 (no associative arrays), since /usr/bin/env bash can resolve
# to the system bash in a bare shell.

# Read by the scripts that source this file, which shellcheck cannot see.
# shellcheck disable=SC2034
CHROME_IDENTITY_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_IDENTITY_OVERLAY="${CHROME_IDENTITY_OVERLAY:-$HOME/.config/chrome-identities}"

chrome_identity_builtin_port() {
    case "$1" in
        atelic) echo 9223 ;;
        personal) echo 9224 ;;
        *) return 1 ;;
    esac
}

chrome_identity_builtin_dir() {
    case "$1" in
        atelic) echo "$HOME/Library/Application Support/Google/Chrome-Atelic" ;;
        personal) echo "$HOME/Library/Application Support/Google/Chrome-Personal" ;;
        *) return 1 ;;
    esac
}

# Print "<port> <dir>" for an overlay identity, or exit 1. The dir is the
# remainder of the line, so it may hold spaces (Application Support does).
chrome_identity_overlay_entry() {
    local want="$1" line name port dir overlay="${CHROME_IDENTITY_OVERLAY:-$HOME/.config/chrome-identities}"
    [[ -r "$overlay" ]] || return 1
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%%#*}"
        [[ -z "${line//[[:space:]]/}" ]] && continue
        read -r name port dir <<< "$line"
        [[ "$name" == "$want" ]] || continue
        [[ "$name" =~ ^[A-Za-z0-9_-]+$ && "$port" =~ ^[0-9]+$ && -n "$dir" ]] || return 1
        dir="${dir/#\~/$HOME}"
        printf '%s %s' "$port" "$dir"
        return 0
    done < "$overlay"
    return 1
}

chrome_identity_port() {
    local entry
    chrome_identity_builtin_port "$1" && return 0
    entry="$(chrome_identity_overlay_entry "$1")" || return 1
    printf '%s\n' "${entry%% *}"
}

chrome_identity_dir() {
    local entry
    chrome_identity_builtin_dir "$1" && return 0
    entry="$(chrome_identity_overlay_entry "$1")" || return 1
    printf '%s\n' "${entry#* }"
}

# Every known name: the table, then each well formed overlay line that does
# not reuse a table name.
chrome_identity_names() {
    local names="atelic personal" line name port dir overlay="${CHROME_IDENTITY_OVERLAY:-$HOME/.config/chrome-identities}"
    if [[ -r "$overlay" ]]; then
        while IFS= read -r line || [[ -n "$line" ]]; do
            line="${line%%#*}"
            [[ -z "${line//[[:space:]]/}" ]] && continue
            read -r name port dir <<< "$line"
            if ! [[ "$name" =~ ^[A-Za-z0-9_-]+$ && "$port" =~ ^[0-9]+$ && -n "$dir" ]]; then
                echo "chrome-identity: ignoring malformed line in $overlay: $line" >&2
                continue
            fi
            if chrome_identity_builtin_port "$name" >/dev/null; then
                echo "chrome-identity: ignoring overlay line for '$name', which the table already defines" >&2
                continue
            fi
            names="$names $name"
        done < "$overlay"
    fi
    printf '%s' "$names"
}

# shellcheck disable=SC2034
CHROME_IDENTITY_NAMES="$(chrome_identity_names)"
