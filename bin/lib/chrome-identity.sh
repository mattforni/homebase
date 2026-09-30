# shellcheck shell=bash
# The headless Chrome identities: which port and which user data dir each one
# owns.
#
# Sourced by bin/chrome/launch-identity (which runs an instance) and by the
# bin/agent-browser shim (which turns `--identity <name>` into `--cdp <port>`
# and starts the instance when it is not up).
# One table, two callers, so a port can never mean one identity to the launcher
# and another to the shim.
#
# Each identity is its own Chrome instance, because Chrome allows one instance
# per user data dir and each instance gets its own CDP port. Binding by port is
# therefore binding by identity: nothing on 9223 can be signed in as anyone but
# matt@atelic.me.
#
# The names match the .account profiles in account-profile.sh, so a task that
# already knows its gws profile knows its browser.
#
# Contract:
#   chrome_identity_port <name> -> the CDP port, or exit 1 for an unknown name
#   chrome_identity_dir <name>  -> the user data dir, or exit 1
#   CHROME_IDENTITY_NAMES       -> every known name, space separated
#   CHROME_IDENTITY_BIN         -> the Chrome binary the launcher execs
#
# Kept to bash 3.2 (no associative arrays), since /usr/bin/env bash can resolve
# to the system bash in a bare shell.

# Read by the scripts that source this file, which shellcheck cannot see.
# shellcheck disable=SC2034
CHROME_IDENTITY_NAMES="atelic personal"
# shellcheck disable=SC2034
CHROME_IDENTITY_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

chrome_identity_port() {
    case "$1" in
        atelic) echo 9223 ;;
        personal) echo 9224 ;;
        *) return 1 ;;
    esac
}

chrome_identity_dir() {
    case "$1" in
        atelic) echo "$HOME/Library/Application Support/Google/Chrome-Atelic" ;;
        personal) echo "$HOME/Library/Application Support/Google/Chrome-Personal" ;;
        *) return 1 ;;
    esac
}
