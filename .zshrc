# ~/.zshrc: executed by zsh(1) for non-login shells.

source ~/.zsh/history.zsh

# Include any alias definitions which have been abstracted into
# their own file to keep this file lean and mean.
alias_file=~/.aliases
if [ -f $alias_file ]; then
    . $alias_file
fi

# Include any function definitions which have been abstracted into
# their own file to keep this file lean and mean.
function_file=~/.functions
if [ -f $function_file ]; then
    . $function_file
fi

# Load environment variables from .env.local if it exists
# Walks up the directory tree from PWD looking for .env.local
# Falls back to global ~/.env.local if no local file is found
if type find_and_source_env &>/dev/null; then
    find_and_source_env
fi

# Always source global .env.local for tokens and secrets
[[ -f ~/.env.local ]] && source ~/.env.local

# Pinole API token lives in the macOS Keychain (not a plaintext dotfile).
# Export it for setup.sh's pinole MCP registration. Reads silently; no-op if absent.
if [[ -z "${PINOLE_API_TOKEN:-}" ]] && command -v security &>/dev/null; then
  PINOLE_API_TOKEN="$(security find-generic-password -s pinole-mcp-token -w 2>/dev/null)"
  [[ -n "$PINOLE_API_TOKEN" ]] && export PINOLE_API_TOKEN || unset PINOLE_API_TOKEN
fi

# Homebrew keg-only binaries. Three things were wrong here until 2026-08-11:
# a stray comma made the first element "...postgresql@15/bin," which could never
# match; the prefix was the Intel /usr/local path rather than /opt/homebrew; and
# the test was -s (non-empty file) rather than -d (directory). $HOME/bin is not
# listed because the block at the bottom of this file prepends it, which is
# where it belongs.
directories=("$(brew --prefix 2>/dev/null)/opt/postgresql@15/bin")
for directory in "${directories[@]}"; do
  if [[ -d "${directory}" ]] && [[ ":$PATH:" != *":${directory}:"* ]]; then
    export PATH="${PATH}:${directory}"
  fi
done

export EDITOR=vim
eval "$(fzf --zsh)"

# mise: shims and auto-switching for node and ruby, reading the same
# .node-version and .ruby-version files fnm and rbenv did. Replaced both on
# 2026-08-11. Global fallback versions live in ~/.config/mise/config.toml.
#
# This is the runtime version manager (jdx/mise), not the assist:mise skill.
command -v mise &>/dev/null && eval "$(mise activate zsh)"

export PATH="$HOME/.local/bin:$PATH"

# bun itself is installed via Homebrew (see brew/Brewfile), so the binary lives
# on /opt/homebrew/bin and needs no wiring. Packages installed with
# `bun install -g` are a different matter: they land in ~/.bun/bin, which is on
# no default PATH, and bun only prints a warning about it at install time. The
# `ynab` CLI arrives that way (see install_bun_globals), so add it here.
export PATH="$HOME/.bun/bin:$PATH"

# cargo installs binaries to ~/.cargo/bin; the toggl CLI arrives that way
# (`cargo install toggl`, rust toolchain in brew/Brewfile), and cargo does
# not wire its own PATH.
export PATH="$HOME/.cargo/bin:$PATH"

# PATH precedence finalization. Place LAST so it wins over every earlier
# prepend in this file. `typeset -U path` keeps PATH unique on each
# re-source of .zshrc; the explicit prepend ensures $HOME/bin (where the
# homebase shims `gws`, `hs` and `toggl` live) resolves before installers that
# dropped binaries into $HOME/.local/bin, $HOME/.bun/bin or $HOME/.cargo/bin.
typeset -U path
export PATH="$HOME/bin:$PATH"
