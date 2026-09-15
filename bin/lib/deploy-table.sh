#!/usr/bin/env bash
# The single source of truth for what homebase deploys to $HOME.
#
# Sourced by setup.sh, which reconciles $HOME against it. It exists because this
# list used to be four lists that disagreed: a symlink allowlist in setup.sh, an
# rsync exclusion array, SYNC_FILES in .functions, and a hand-maintained subset
# in bin/claude-profiles-init.sh that had already drifted, missing agents, hooks
# and workflows. That fourth consumer retired with the Claude profile split on
# 2026-08-12 (ATE-463), leaving one table and one reader.
#
# Defines DEPLOY_TABLE, LEGACY_PATHS and MANIFEST. No side effects.
#
# Everything here is consumed by whoever sources the file, so static analysis
# sees each definition as an unused assignment. That is the nature of a library
# of declarations rather than a defect.
# shellcheck disable=SC2034

# How homebase reaches $HOME. This one table replaced four lists that used to
# disagree with each other: a symlink allowlist here, an rsync exclusion list in
# deploy_homebase, SYNC_FILES in .functions, and a fourth in the retired
# bin/claude-profiles-init.sh. Anything not named here is never deployed.
#
# Modes:
#   link   Symlink into the repo, so a git pull is live with no deploy step.
#          Only for paths nothing but a human or git ever writes. A tool that
#          saves by writing a temp file and renaming over the target REPLACES
#          the symlink with a regular file; Claude Code, VS Code and macOS
#          `sed -i` all do this, and the link is gone with no error.
#   copy   Plain file copy, for a tracked file living inside a directory that
#          receives foreign writes. Files only, never directories.
#   merge  JSON merge by top level key: keys the repo declares are replaced,
#          keys it does not are left alone. For files the owning app rewrites
#          for itself. A key the repo declares is replaced whole, so dropping an
#          entry from inside one (a permission out of permissions.allow) does
#          reach $HOME. Deleting an entire top-level key from the repo does NOT
#          remove it downstream: once undeclared it is indistinguishable from a
#          key the app owns. Delete those by hand, or add key tracking to the
#          manifest if that ever becomes common.
#
# Never link a directory that receives foreign writes. ~/.claude is the reason:
# it holds sessions, projects, history and credentials that Claude Code writes
# constantly, so its tracked children are listed individually instead.
#
# Format: mode|repo path[|destination]. Destination defaults to the repo path
# relative to $HOME; an absolute destination is used verbatim.
DEPLOY_TABLE=(
  # Shell. zsh is the only shell; see the Key Shell Configurations section of
  # CLAUDE.md for why there is no bash config.
  "link|.aliases"
  "link|.functions"
  "link|.zshrc"
  "link|.zsh"
  "link|.gitconfig"
  "link|.vimrc"
  "link|.vim"
  "link|.screenrc"

  # Scripts. A single directory link, so a new script in bin/ is on PATH
  # immediately without re running setup.sh.
  "link|bin"

  # Claude Code
  "link|CLAUDE.md"
  "link|.claude/CLAUDE.md"
  "link|.claude/agents"
  "link|.claude/commands"
  "link|.claude/output-styles"
  "link|.claude/hooks"
  "link|.claude/local-skills"
  "link|.claude/references"
  "link|.claude/skills"
  "link|.claude/statusline.sh"
  "link|.claude/workflows"
  # User level rules. Sourced from a directory of its own because .claude/rules
  # is this repo's project scoped rules with homebase relative globs; linking
  # that into ~/.claude/rules would fire them in every repo on the machine.
  "link|.claude/user-rules|$HOME/.claude/rules"
  # Claude Code adds its own keys here (theme, language, and whatever it
  # gains next), so the repo owns only the keys it declares.
  "merge|.claude/settings.json"
  # Inside .claude/plugins, which Claude Code fills with caches and marketplace
  # state, so these are copies rather than links.
  "copy|.claude/plugins/blocklist.json"
  "copy|.claude/plugins/config.json"
  "copy|.claude/plugins/marketplace-sources.txt"

  # IDE. Antigravity keeps user settings under Application Support rather than
  # in a dotfile, and rewrites the file whenever a setting changes in the UI.
  "merge|ide/settings.json|$HOME/Library/Application Support/Antigravity IDE/User/settings.json"

  # Runtime versions. mise reads this only when the current directory declares
  # nothing of its own.
  "link|mise/config.toml|$HOME/.config/mise/config.toml"

  # Login agents. Copied rather than linked because ~/Library/LaunchAgents is
  # full of foreign writes (Google, Grammarly, Steam and Homebrew all drop
  # plists there), which is exactly what the copy mode exists for. A copy also
  # means an edit here needs a setup.sh run and a reload to take effect, rather
  # than silently diverging from the job launchd already has loaded.
  "copy|launchd/me.atelic.brave-debug-port.plist|$HOME/Library/LaunchAgents/me.atelic.brave-debug-port.plist"
)

# One time cleanup. Older setup.sh runs rsynced the whole repo into $HOME with
# an opt-out exclusion list and no --delete, so every directory added to
# homebase since that list was written landed in the home directory and stayed.
# These are removed only after confirming provenance (see path_is_ours).
#
# Delete this array, and the prune_legacy call, once every machine has run it.
#
# ~/.env.local is deliberately absent: .zshrc sources it for tokens and secrets,
# the repo copy is untracked so it exists only where it was created, and a fresh
# clone never had one. It is neither deployed nor pruned.
LEGACY_PATHS=(
  plugins
  docs
  coderabbit
  intellij
  .claude-plugin
  .worktrees
  .bashrc
  .bash_profile
  .profile
  .bashrc.go
)

# Where the record of the last deployment lives. Without it nothing can be
# pruned, because the script cannot tell a path it placed from one it did not.
MANIFEST="$HOME/.local/state/homebase/manifest"

