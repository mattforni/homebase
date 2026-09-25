#!/usr/bin/env bash
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Re-exec under Homebrew bash (4+) when available for associative array support.
# On first run, system bash (3.2) handles everything up through brew install,
# which installs modern bash. Subsequent runs pick it up immediately.
BREW_BASH=""
for candidate in /opt/homebrew/bin/bash /usr/local/bin/bash; do
  if [[ -x "$candidate" ]]; then
    BREW_BASH="$candidate"
    break
  fi
done
if [[ "${BASH_VERSINFO[0]}" -lt 4 ]] && [[ -n "$BREW_BASH" ]]; then
  exec "$BREW_BASH" "$0" "$@"
fi

# Parse flags
FORCE=false
DRY_RUN=false

usage() {
  cat <<'USAGE'
Usage: ./setup.sh [-f|--force] [-n|--dry-run]

  -f, --force     Reinstall or refresh even where something looks up to date
  -n, --dry-run   Print every change the home reconciliation would make,
                  removals included, and touch nothing
  -h, --help      This message
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--force) FORCE=true; shift ;;
    -n|--dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
done

# Detect interactive terminal (auth prompts require one)
INTERACTIVE=true
[[ ! -t 0 ]] && INTERACTIVE=false

# The deploy table, the legacy cleanup list and the manifest path live in
# bin/lib/deploy-table.sh. It was factored out when a second consumer needed the
# same list and kept its own drifting copy; that consumer has since retired, but
# the table stays split out as the single declaration of what reaches $HOME.
#
# setup.sh has nothing to do without it: every phase that touches $HOME reads
# from it, so failing loudly is the correct degraded behaviour. Contrast the
# `gws` shim, which passes through untouched when its library is unreadable
# rather than blocking the command it wraps.
DEPLOY_TABLE_LIB="$DIR/bin/lib/deploy-table.sh"
if [[ ! -r "$DEPLOY_TABLE_LIB" ]]; then
  printf 'setup.sh: cannot read %s; there is nothing to deploy without it\n' "$DEPLOY_TABLE_LIB" >&2
  exit 1
fi
# shellcheck source=bin/lib/deploy-table.sh
. "$DEPLOY_TABLE_LIB"

# Which Secret Manager project holds which credential. Unlike the deploy table,
# a missing routing table is not fatal: only the gws bootstrap reads it, and
# every other phase should still run. Fall back to the business vault, which is
# where all of these lived before the split.
VAULT_LIB="$DIR/bin/lib/vault.sh"
if [[ -r "$VAULT_LIB" ]]; then
  # shellcheck source=bin/lib/vault.sh
  . "$VAULT_LIB"
else
  printf 'setup.sh: cannot read %s; gws bootstrap will assume the business vault\n' "$VAULT_LIB" >&2
  vault_project_for_profile() { printf '%s' "${VAULT_PROJECT_ATELIC:-atelic-keys}"; }
fi

# Colors & helpers
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
RED=$'\033[0;31m'
BOLD=$'\033[1m'
NC=$'\033[0m'

info()   { printf "${GREEN}[+]${NC} %s\n" "$1"; }
warn()   { printf "${YELLOW}[!]${NC} %s\n" "$1"; }
error()  { printf "${RED}[x]${NC} %s\n" "$1" >&2; }
header() { printf "\n${BOLD}=== %s ===${NC}\n\n" "$1"; }

SUMMARY=()
FAILURES=()

run_phase() {
  local name="$1"
  if ! "$name"; then
    FAILURES+=("$name")
  fi
}

###############################################################################
# Phase functions
###############################################################################

setup_prerequisites() {
  header "Prerequisites"

  if ! command -v brew &>/dev/null; then
    warn "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [[ "$(uname -m)" == "arm64" ]] && [[ -f /opt/homebrew/bin/brew ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
    SUMMARY+=("Homebrew installed")
  fi
  info "Homebrew ready"

  if [[ "$(uname -m)" == "arm64" ]]; then
    if ! /usr/bin/pgrep -q oahd; then
      warn "Installing Rosetta 2..."
      softwareupdate --install-rosetta --agree-to-license
      SUMMARY+=("Rosetta 2 installed")
    fi
    info "Rosetta 2 ready"
  fi

  if ! xcode-select -p &>/dev/null; then
    if [[ "$INTERACTIVE" == true ]]; then
      warn "Installing Xcode Command Line Tools..."
      xcode-select --install
      echo "Press Enter after Xcode CLI tools installation completes."
      read -r
    else
      error "Xcode CLI tools missing (install manually: xcode-select --install)"
      return 1
    fi
  fi
  info "Xcode CLI tools ready"
}

install_brew_packages() {
  header "Brew packages"

  # Casks that require sudo in non-interactive sessions, either because the
  # installer prompts (whatsapp, zoom) or because brew needs to adopt an
  # existing /Applications copy (chmod -R a+rX requires sudo). Skip in
  # non-interactive sessions (e.g. Claude Code); run setup.sh in a terminal
  # to pick them up.
  local sudo_casks="whatsapp zoom docker-desktop google-chrome protonvpn raycast slack todoist-app"
  local skip_env=""
  if [[ "$INTERACTIVE" != true ]]; then
    skip_env="$sudo_casks"
    info "Non-interactive session, skipping sudo casks: $sudo_casks"
  fi

  if [[ "$FORCE" != true ]]; then
    local check_pass=true
    if [[ -n "$skip_env" ]]; then
      HOMEBREW_BUNDLE_CASK_SKIP="$skip_env" brew bundle check --file="$DIR/brew/Brewfile" &>/dev/null || check_pass=false
    else
      brew bundle check --file="$DIR/brew/Brewfile" &>/dev/null || check_pass=false
    fi
    if [[ "$check_pass" == true ]]; then
      info "All brew packages already installed"
      eval "$(brew shellenv)"
      hash -r
      return 0
    fi
  fi

  # Allow individual failures without aborting.
  if HOMEBREW_BUNDLE_CASK_SKIP="$skip_env" brew bundle --file="$DIR/brew/Brewfile" 2>&1; then
    SUMMARY+=("Brew packages installed")
  else
    warn "Some brew packages failed to install (see output above)"
    SUMMARY+=("Brew packages installed (with warnings)")
  fi

  eval "$(brew shellenv)"
  hash -r

  # Re-exec under modern bash if we just installed it
  if [[ "${BASH_VERSINFO[0]}" -lt 4 ]] && [[ -n "$BREW_BASH" ]]; then
    warn "Modern bash now available, re-launching setup..."
    # Every flag has to be forwarded by hand here. A new flag that is not added
    # to this list is silently dropped on the first run of a fresh machine,
    # which is the run where it matters most.
    local reexec_args=("$0")
    [[ "$FORCE" == true ]] && reexec_args+=("--force")
    [[ "$DRY_RUN" == true ]] && reexec_args+=("--dry-run")
    exec "$BREW_BASH" "${reexec_args[@]}"
  fi
}

# Node and Ruby, one manager. mise (jdx/mise) replaced fnm and rbenv on
# 2026-08-11; versions are pinned in mise/config.toml, which the reconciler
# deploys to ~/.config/mise/config.toml. mise reads the same per-project
# .node-version and .ruby-version files the old pair did.
#
# Named for what it does rather than for the tool, because "mise" already means
# the morning prep routine in this repo (bin/run-mise, the assist:mise skill).
setup_runtimes() {
  header "Runtimes"

  # RVM was replaced by rbenv, and rbenv by mise. Remove any lingering RVM so
  # its shims cannot shadow anything. Idempotent: a no-op once gone.
  if [[ -d "$HOME/.rvm" ]]; then
    info "Removing legacy RVM install (~/.rvm)..."
    rm -rf "$HOME/.rvm"
    SUMMARY+=("Removed legacy RVM")
  fi
  rm -f "$HOME/.rvmrc"

  if ! command -v mise &>/dev/null; then
    warn "mise not found, skipping runtime setup"
    return 0
  fi

  # ~/.rbenv/shims is prepended to PATH by anything that still sources an rbenv
  # init, and its shims would win over mise's. Flag rather than delete: the
  # directory holds compiled rubies that took a long time to build, and removing
  # them is the user's call.
  if [[ -d "$HOME/.rbenv/shims" ]]; then
    warn "$HOME/.rbenv still present; its shims can shadow mise"
    warn "  when you are satisfied mise works: brew uninstall rbenv ruby-build fnm && rm -rf \"\$HOME/.rbenv\""
  fi

  local install_args=(install)
  [[ "$FORCE" == true ]] && install_args+=(--force)

  info "Installing runtimes declared in ~/.config/mise/config.toml..."
  if ! mise "${install_args[@]}"; then
    error "mise install failed"
    return 1
  fi

  # Put the shims on PATH for the rest of this script. install_npm_globals needs
  # npm, and setup.sh is not an interactive shell, so the `mise activate zsh` in
  # .zshrc does not apply here. This is the counterpart of the
  # `eval "$(fnm env)"` the old node phase did.
  eval "$(mise activate bash --shims)"
  hash -r

  local node_version ruby_version
  node_version=$(mise exec -- node --version 2>/dev/null || echo "unavailable")
  # The `|| echo` has to sit outside the pipeline: awk exits 0 on empty input,
  # so a failing `mise exec` still yields a successful pipeline and an empty
  # string, and the summary would print "ruby " with nothing after it.
  ruby_version=$(mise exec -- ruby --version 2>/dev/null | awk '{print $2}')
  [[ -n "$ruby_version" ]] || ruby_version="unavailable"
  info "node $node_version, ruby $ruby_version"
  SUMMARY+=("Runtimes: node $node_version, ruby $ruby_version")
}

install_npm_globals() {
  header "npm globals"

  if ! command -v npm &>/dev/null; then
    warn "npm not found, skipping"
    return 0
  fi

  # @anthropic-ai/claude-code left this list on 2026-08-27: the native install
  # at ~/.local/bin/claude is the binary every terminal and headless run uses,
  # and the npm copy only ever sat shadowed behind it on PATH. update_claude_code
  # keeps the native one current and removes a leftover npm copy.
  # @doist/todoist-cli (binary `td`) and @hubspot/cli (binary `hs`) replaced the
  # Todoist and HubSpot claude.ai connectors on 2026-08-12 (ATE-463). A connector
  # is authorized against the Claude account rather than a directory, so it loads
  # in every session and can only ever reach one account; the HubSpot one was
  # bound to the TPF portal, leaving Atelic unreachable through it. Both CLIs
  # cost nothing until invoked and resolve their account per directory.
  local globals=(
    "@doist/todoist-cli"
    "@hubspot/cli"
    "typescript"
    "vercel"
    "yarn"
  )

  for pkg in "${globals[@]}"; do
    if [[ "$FORCE" != true ]] && npm list -g "$pkg" &>/dev/null; then
      info "$pkg already installed"
    else
      info "Installing $pkg..."
      npm install -g "$pkg" || return 1
      SUMMARY+=("$pkg installed")
    fi
  done

  # Globals installed from a git tag rather than the registry, as
  # name|spec|version. The loop above checks by package name, which a git spec
  # is not, so these carry the name for the check, the spec for the install,
  # and the tag's version so a bumped pin reinstalls instead of sitting behind
  # an "already installed". pinole (the Pinole work API client, 2026-09-16) is
  # not published to npm: the public repo is the package, dist/ is committed,
  # and the tag is the release. The recruiter image pins the same tag in
  # runners/recruiter/Dockerfile; bump both together.
  local git_globals=(
    "pinole|github:atelic-action/pinole-cli#v0.1.3|0.1.3"
  )

  local entry name spec want have
  for entry in "${git_globals[@]}"; do
    IFS='|' read -r name spec want <<<"$entry"
    # `npm list -g <name> --depth=0` prints the tree line `name@version`; sed
    # rather than --json and jq, since jq may not be on PATH in this phase.
    have="$(npm list -g "$name" --depth=0 2>/dev/null | sed -n "s/.* $name@\\([^ ]*\\).*/\\1/p" | head -n 1)"
    if [[ "$FORCE" != true && "$have" == "$want" ]]; then
      info "$name $have already installed"
    else
      info "Installing $name from $spec..."
      npm install -g "$spec" || return 1
      SUMMARY+=("$name $want installed")
    fi
  done
}

update_claude_code() {
  header "Claude Code"

  # The native install only auto updates when it is itself launched, and Forni
  # drives Claude Code from the VS Code extension, which ships its own binary.
  # The terminal copy therefore fell twenty releases behind without a signal
  # (2.1.226 against the extension's 2.1.246 on 2026-08-27), and every
  # headless run rode the stale one. Update it here and prove the version.
  if ! command -v claude &>/dev/null; then
    warn "claude not found on PATH; install the native build: curl -fsSL https://claude.ai/install.sh | bash"
    return 0
  fi

  if command -v npm &>/dev/null && npm list -g @anthropic-ai/claude-code &>/dev/null; then
    info "Removing the shadowed npm copy of @anthropic-ai/claude-code..."
    npm uninstall -g @anthropic-ai/claude-code >/dev/null 2>&1 || warn "could not remove the npm copy of claude-code"
  fi

  local before after
  before="$(claude --version 2>/dev/null | awk '{print $1}')"
  if ! claude update >/dev/null 2>&1; then
    warn "claude update failed; the terminal binary may be stale ($before)"
    return 0
  fi
  after="$(claude --version 2>/dev/null | awk '{print $1}')"
  if [[ -z "$after" ]]; then
    warn "claude --version returned nothing after the update"
    return 0
  fi
  if [[ "$before" != "$after" ]]; then
    info "Claude Code $before -> $after"
    SUMMARY+=("Claude Code updated to $after")
  else
    info "Claude Code $after is current"
  fi
}

install_bun_globals() {
  header "bun globals"

  # @stephendolan/ynab-cli (binary `ynab`) requires the Bun runtime, so it cannot
  # ride install_npm_globals. It replaced the ynab MCP server on 2026-08-13. The
  # server ran under Deno, which neither the Brewfile nor mise ever installed, so
  # a fresh machine would have failed with "deno: command not found"; bun is in
  # the Brewfile already. The CLI also stores its own token in the Keychain via
  # `ynab auth login -t`, which retired the bin/mcp/serve-ynab launcher.
  if ! command -v bun &>/dev/null; then
    warn "bun not found, skipping"
    return 0
  fi

  # `bun install -g` drops binaries in ~/.bun/bin, which is on no default PATH.
  # .zshrc adds it, but that only helps the NEXT shell; this process needs it
  # too, because setup_auth runs `command -v ynab` later in this same run.
  # Without this, a fresh machine installs the CLI and then silently skips
  # authenticating it, which is the exact "setup green, tool dead" failure the
  # move off Deno was meant to end.
  case ":$PATH:" in
    *":$HOME/.bun/bin:"*) ;;
    *) export PATH="$HOME/.bun/bin:$PATH" ;;
  esac

  local globals=(
    "@stephendolan/ynab-cli"
  )

  for pkg in "${globals[@]}"; do
    # `bun pm ls -g` prints the global tree; grep is the available check, since
    # bun has no per package query equivalent to `npm list -g <pkg>`.
    if [[ "$FORCE" != true ]] && bun pm ls -g 2>/dev/null | grep -q "$pkg"; then
      info "$pkg already installed"
    else
      info "Installing $pkg..."
      bun install -g "$pkg" || return 1
      SUMMARY+=("$pkg installed")
    fi
  done
}

setup_agent_browser() {
  header "agent-browser"

  if ! command -v agent-browser &>/dev/null; then
    warn "agent-browser not found, skipping"
    return 0
  fi

  # `agent-browser install` downloads Chrome for Testing into
  # ~/.agent-browser/browsers/ on first run and no-ops once present.
  if [[ "$FORCE" != true ]] && compgen -G "$HOME/.agent-browser/browsers/chrome-*" > /dev/null; then
    info "agent-browser Chrome already installed"
    return 0
  fi

  if agent-browser install; then
    SUMMARY+=("agent-browser Chrome installed")
  else
    warn "agent-browser install failed"
    return 1
  fi
}

install_brave_launcher() {
  header "Brave launcher"

  # Compiles launchd/brave-launcher.applescript into ~/Applications/Brave.app
  # with Brave's icon, for the Dock in place of Brave itself. A launch from the
  # Dock otherwise goes through LaunchServices with no --remote-debugging-port.
  # The app is built rather than tracked, since osacompile output is binary.
  local src="$DIR/launchd/brave-launcher.applescript"
  local app="$HOME/Applications/Brave.app"
  local icon="/Applications/Brave Browser.app/Contents/Resources/app.icns"
  # Outside the bundle: a file added inside it would break its signature.
  local stamp="$HOME/.local/state/homebase/brave-launcher.sha"

  if [[ ! -d "/Applications/Brave Browser.app" ]]; then
    warn "Brave not installed, skipping the launcher"
    return 0
  fi

  local sha
  sha=$(shasum -a 256 "$src" | cut -d' ' -f1)
  if [[ "$FORCE" != true ]] && [[ -f "$stamp" ]] && [[ "$(cat "$stamp")" == "$sha" ]]; then
    info "Brave launcher already built"
    return 0
  fi

  if [[ "$DRY_RUN" == true ]]; then
    dry "BUILD $app from $src"
    return 0
  fi

  mkdir -p "$HOME/Applications"
  rm -rf "$app"
  if ! osacompile -o "$app" "$src"; then
    warn "osacompile failed for the Brave launcher"
    return 1
  fi
  # osacompile ships its icon in Assets.car, which outranks applet.icns, so
  # the catalog goes and Brave's icns takes its place. Editing the bundle
  # voids osacompile's ad hoc signature, and codesign refuses a bundle
  # carrying Finder attributes, so clear them and sign again.
  if [[ -f "$icon" ]]; then
    rm -f "$app/Contents/Resources/Assets.car"
    /usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$app/Contents/Info.plist" 2>/dev/null || true
    cp "$icon" "$app/Contents/Resources/applet.icns"
  fi
  xattr -cr "$app"
  codesign --force --sign - "$app" 2>/dev/null
  touch "$app"

  # Prove the bundle is sound rather than trusting osacompile's exit code.
  if [[ -x "$app/Contents/MacOS/applet" ]] && codesign --verify "$app" 2>/dev/null; then
    mkdir -p "$(dirname "$stamp")"
    printf '%s\n' "$sha" > "$stamp"
    info "Built $app (drag it into the Dock in place of Brave)"
    SUMMARY+=("Brave launcher built at $app")
  else
    warn "Brave launcher bundle has no executable"
    return 1
  fi
}

###############################################################################
# Home reconciliation
#
# Converge $HOME on what DEPLOY_TABLE declares, and remove what homebase used to
# deploy and no longer does. The record at $MANIFEST is what makes removal
# possible at all: without it the script cannot tell a path it placed from one
# it never touched, which is why the old rsync could only ever add.
#
# Nothing is removed unless provenance checks out. setup_auth writes SSH keys
# and gws credentials into $HOME that cannot be regenerated without a terminal,
# so "only touch what we put there" is load bearing rather than defensive.
###############################################################################

dry() { printf "${YELLOW}[dry]${NC} %s\n" "$1"; }

# Byte equality against the repo source. Used for the copy to symlink migration,
# where the question is whether replacing a real file loses anything.
same_content() {
  if [[ -d "$1" ]]; then
    diff -rq "$1" "$2" >/dev/null 2>&1
  else
    cmp -s "$1" "$2"
  fi
}

# Has homebase ever tracked this path? The right question for pruning, because
# a copy left behind by an older run is expected to be STALE, not identical:
# ~/plugins still carries sdlc/skills/groom, deleted when it became groom-issues.
# Byte equality would refuse to clean exactly the paths most in need of it.
# A file homebase never tracked means something else owns the directory, so
# refuse. Consulting git history rather than the working tree is what lets this
# recognise files the repo has since deleted.
path_is_ours() {
  local home_path="$1" repo_rel="$2"
  local history
  history=$(git -C "$DIR" log --all --pretty=format: --name-only -- "$repo_rel" 2>/dev/null | sed '/^$/d' | sort -u)
  [[ -n "$history" ]] || return 1

  if [[ -L "$home_path" || -f "$home_path" ]]; then
    grep -qxF "$repo_rel" <<<"$history"
    return
  fi

  local f
  local walked=0
  while IFS= read -r f; do
    walked=1
    grep -qxF "$repo_rel/$f" <<<"$history" || return 1
  done < <(cd "$home_path" 2>/dev/null && find . \( -type f -o -type l \) 2>/dev/null | sed 's|^\./||')

  # Fail closed when the walk produced nothing. An empty directory and a walk
  # that could not run (cd refused, find failed, the path vanished mid-run) are
  # indistinguishable from here, and the previous `return 0` treated both as
  # "homebase owns this", which hands an unreadable directory straight to
  # rm -rf. Callers that legitimately have an empty directory handle it before
  # reaching this. "We could not tell" must never mean "safe to delete".
  [[ $walked -eq 1 ]]
}

deploy_link() {
  local src="$1" dst="$2" rel="$3"

  if [[ -L "$dst" ]]; then
    local current
    current=$(readlink "$dst")
    [[ "$current" == "$src" ]] && return 0
    if [[ "$DRY_RUN" == true ]]; then dry "relink $rel (currently -> $current)"; return 0; fi
    rm "$dst" || return 1
  elif [[ -e "$dst" ]]; then
    # Promoting a path from copy to symlink on a machine that already has the
    # copy. Two ways to establish that replacing it loses nothing you authored.
    #
    # Byte equality is the obvious one, and the fast path. But it is too strict
    # on its own: a copy left by an older run is expected to be STALE, and byte
    # equality refuses exactly the paths most in need of promotion. ~/.claude/
    # agents had three drifted files and was missing planner.md entirely.
    #
    # So fall back to provenance. If every file under the path is one homebase
    # has tracked at some point, the copy is homebase's own stale output and
    # only staleness is lost. A single file homebase never tracked means
    # something else owns the directory, and then we refuse exactly as before.
    if same_content "$src" "$dst"; then
      if [[ "$DRY_RUN" == true ]]; then dry "migrate $rel from copy to symlink"; return 0; fi
      rm -rf "$dst" || return 1
    elif path_is_ours "$dst" "$rel"; then
      if [[ "$DRY_RUN" == true ]]; then dry "migrate $rel from STALE copy to symlink"; return 0; fi
      rm -rf "$dst" || return 1
      warn "$rel was a stale copy; replaced with a symlink into the repo"
    else
      warn "$rel is a real file or directory at $dst holding files homebase never tracked"
      warn "  refusing to replace it. Diff it, then move or delete it and re run setup.sh"
      return 1
    fi
  else
    if [[ "$DRY_RUN" == true ]]; then dry "link $rel"; return 0; fi
  fi

  mkdir -p "$(dirname "$dst")" || return 1
  ln -s "$src" "$dst" || return 1
  info "linked $rel"
}

deploy_copy() {
  local src="$1" dst="$2" rel="$3"

  # `-f` follows symlinks, so a path moving from link mode to copy mode would
  # find the old symlink, compare the source against itself through it, match,
  # and return early leaving the link in place. The manifest would then hold a
  # link entry where this run recorded a copy entry, and the prune loop would
  # delete the path outright. Treat a symlink as "not a copy" so it is replaced,
  # and unlink before writing, since cp writes THROUGH a symlink into the repo.
  if [[ -f "$dst" && ! -L "$dst" ]] && cmp -s "$src" "$dst"; then return 0; fi
  if [[ "$DRY_RUN" == true ]]; then dry "copy $rel"; return 0; fi

  mkdir -p "$(dirname "$dst")" || return 1
  rm -f "$dst" || return 1
  cp "$src" "$dst" || return 1
  info "copied $rel"
}

# Merge the repo's top level keys into the destination, leaving keys the repo
# does not declare untouched. Exit 3 means the destination already matches.
deploy_merge() {
  local src="$1" dst="$2" rel="$3"
  local rc=0

  DRY_RUN="$DRY_RUN" python3 - "$src" "$dst" <<'PY' || rc=$?
import json, os, re, sys

src, dst = sys.argv[1], sys.argv[2]
dry = os.environ.get("DRY_RUN") == "true"
home = os.environ["HOME"]

# Only a $HOME that starts a path, so $HOMEBREW_PREFIX and friends survive
# intact. Bare $HOME at the end of a string still counts; $HOMEish does not.
HOME_TOKEN = re.compile(r"\$HOME(?![0-9A-Za-z_])")

def expand(value):
    """Substitute $HOME the way install_launchagents substitutes {{HOME}}.

    The repo may not hard-code a username (see Path Conventions in CLAUDE.md),
    so a path inside a tracked settings file is written as the literal string
    "$HOME/...". The owning app writes it back expanded. Without this the two
    sides can never agree: every run writes the literal, the app re-expands it,
    and the next run sees a difference again, so the merge never converges and
    a second run is never a no-op. Expanding at deploy time makes the comparison
    apples to apples while keeping the repo portable.
    """
    if isinstance(value, str):
        return HOME_TOKEN.sub(home.replace("\\", "\\\\"), value)
    if isinstance(value, dict):
        return {k: expand(v) for k, v in value.items()}
    if isinstance(value, list):
        return [expand(v) for v in value]
    return value

with open(src) as f:
    repo = expand(json.load(f))

current = {}
if os.path.exists(dst):
    with open(dst) as f:
        text = f.read().strip()
    if text:
        try:
            current = json.loads(text)
        except json.JSONDecodeError as exc:
            sys.stderr.write(f"destination is not valid JSON ({exc}); refusing to merge\n")
            sys.exit(2)

# Repo keys win; everything else the app wrote for itself survives.
merged = dict(current)
merged.update(repo)
if merged == current:
    sys.exit(3)

if dry:
    added = sorted(k for k in repo if k not in current)
    changed = sorted(k for k in repo if k in current and current[k] != repo[k])
    kept = sorted(k for k in current if k not in repo)
    sys.stderr.write(f"add={added} update={changed} untouched={kept}\n")
    sys.exit(4)

os.makedirs(os.path.dirname(dst), exist_ok=True)
with open(dst, "w") as f:
    json.dump(merged, f, indent=2)
    f.write("\n")
PY

  case "$rc" in
    0) info "merged $rel" ;;
    3) return 0 ;;
    4) dry "merge $rel" ;;
    *) error "failed to merge $rel into $dst"; return 1 ;;
  esac
}

# Remove what a previous run deployed and this one does not, plus the one time
# legacy list. Both go through path_is_ours; anything that fails it is left
# alone with a warning rather than removed.
prune_path() {
  local dst="$1" repo_rel="$2" why="$3"

  if [[ -L "$dst" ]]; then
    local target
    target=$(readlink "$dst")
    if [[ "$target" != "$DIR"/* ]]; then
      warn "$dst is a symlink to $target, outside homebase; leaving it alone"
      return 0
    fi
  elif ! path_is_ours "$dst" "$repo_rel"; then
    warn "$dst holds files homebase has never tracked; leaving it alone"
    warn "  remove it by hand if you are sure"
    return 0
  fi

  if [[ "$DRY_RUN" == true ]]; then dry "REMOVE $dst ($why)"; return 0; fi
  rm -rf "$dst" || return 1
  info "removed $dst ($why)"
}

reconcile_home() {
  header "Home"

  # Never point $HOME at a worktree. Symlinks would resolve into a checkout that
  # disappears the moment the branch is merged and the worktree removed, leaving
  # a dangling ~/.zshrc and no working shell. Deploy from the primary checkout.
  local git_dir
  git_dir=$(git -C "$DIR" rev-parse --git-dir 2>/dev/null || true)
  if [[ "$git_dir" == *"/worktrees/"* ]]; then
    if [[ "$DRY_RUN" == true ]]; then
      warn "Running from a git worktree. A real run would refuse; showing the plan anyway."
      warn "  Symlink sources below point at the worktree, not the primary checkout."
    else
      error "Refusing to reconcile \$HOME from a git worktree ($DIR)"
      error "  Symlinks would break when the worktree is removed. Run from the primary checkout."
      return 1
    fi
  fi

  local failed=0
  local -a current=()
  local first_run=false
  [[ -f "$MANIFEST" ]] || first_run=true

  for entry in "${DEPLOY_TABLE[@]}"; do
    local mode="${entry%%|*}"
    local rest="${entry#*|}"
    local rel="${rest%%|*}"
    local dst
    if [[ "$rest" == *"|"* ]]; then
      dst="${rest#*|}"
    else
      dst="$HOME/$rel"
    fi
    local src="$DIR/$rel"

    if [[ ! -e "$src" ]]; then
      warn "$rel is in the deploy table but missing from the repo, skipping"
      failed=1
      continue
    fi

    case "$mode" in
      link)  deploy_link  "$src" "$dst" "$rel" || failed=1 ;;
      copy)  deploy_copy  "$src" "$dst" "$rel" || failed=1 ;;
      merge) deploy_merge "$src" "$dst" "$rel" || failed=1 ;;
      *)     error "unknown deploy mode '$mode' for $rel"; failed=1; continue ;;
    esac
    current+=("$mode	$rel	$dst")
  done

  # Prune anything the last run deployed that this one does not.
  if [[ "$first_run" == true ]]; then
    info "No previous deployment record; seeding one. Nothing pruned from it this run."
  else
    local mode rel dst
    while IFS=$'\t' read -r mode rel dst; do
      [[ -n "$dst" ]] || continue
      printf '%s\n' "${current[@]}" | grep -qxF "$mode	$rel	$dst" && continue
      [[ -e "$dst" || -L "$dst" ]] || continue
      if [[ "$mode" == "merge" ]]; then
        warn "$dst is no longer managed; leaving it in place since the app owns the file"
        continue
      fi
      prune_path "$dst" "$rel" "no longer deployed" || failed=1
    done < "$MANIFEST"
  fi

  prune_legacy || failed=1

  # Record what this run deployed, so the next one can diff against it.
  if [[ "$DRY_RUN" != true ]]; then
    mkdir -p "$(dirname "$MANIFEST")" || return 1
    printf '%s\n' "${current[@]}" > "$MANIFEST" || return 1
  fi

  [[ $failed -eq 0 ]] || return 1
  SUMMARY+=("Home reconciled (${#current[@]} paths)")
}

prune_legacy() {
  local failed=0
  local rel dst
  for rel in "${LEGACY_PATHS[@]}"; do
    dst="$HOME/$rel"
    [[ -e "$dst" || -L "$dst" ]] || continue

    # An empty directory carries no data and no provenance to check.
    if [[ -d "$dst" && ! -L "$dst" && -z "$(ls -A "$dst")" ]]; then
      if [[ "$DRY_RUN" == true ]]; then dry "REMOVE $dst (empty, left by an older run)"; continue; fi
      rmdir "$dst" && info "removed $dst (empty)"
      continue
    fi

    prune_path "$dst" "$rel" "rsynced by an older setup.sh, no longer deployed" || failed=1
  done
  return $failed
}

install_launchagents() {
  header "Launch agents"

  # Plists in launchagents/ are templates: {{HOME}} is substituted with the
  # current user's $HOME at install time. The rendered plist lives at
  # $HOME/Library/LaunchAgents/ as a real file (not a symlink) so launchd
  # sees absolute, user specific paths. Re running setup.sh re renders and
  # re bootstraps.
  local src_dir="$DIR/launchagents"
  local dst_dir="$HOME/Library/LaunchAgents"
  local domain
  domain="gui/$(id -u)"

  if [[ ! -d "$src_dir" ]]; then
    info "No launchagents/ directory in repo, skipping"
    return 0
  fi

  mkdir -p "$dst_dir"

  local count=0
  local failed=0
  for src in "$src_dir"/*.plist; do
    [[ -f "$src" ]] || continue
    local base
    base=$(basename "$src")
    local label="${base%.plist}"
    local dst="$dst_dir/$base"

    # Render the template with $HOME substituted. sed uses | delimiter to
    # avoid escaping / in the path.
    local rendered
    rendered=$(sed "s|{{HOME}}|$HOME|g" "$src")

    # Track whether the installed plist actually changed. Avoids tearing down
    # and re bootstrapping an unchanged agent on every setup.sh run, which
    # would kill an in flight job if one were running.
    local changed=1
    if [[ -f "$dst" ]] && [[ ! -L "$dst" ]] && [[ "$(cat "$dst")" == "$rendered" ]]; then
      info "$label plist already rendered"
      changed=0
    elif [[ -L "$dst" ]]; then
      warn "Removing stale symlink at $dst"
      rm "$dst"
      printf '%s\n' "$rendered" > "$dst"
      info "Rendered $dst"
    else
      printf '%s\n' "$rendered" > "$dst"
      info "Rendered $dst"
    fi

    # Reload only when the plist changed or the agent is not currently loaded.
    local loaded=0
    launchctl print "$domain/$label" &>/dev/null && loaded=1

    if [[ $changed -eq 1 ]] || [[ $loaded -eq 0 ]]; then
      [[ $loaded -eq 1 ]] && launchctl bootout "$domain/$label" &>/dev/null || true
      if launchctl bootstrap "$domain" "$dst"; then
        info "Launch agent $label active"
        count=$((count + 1))
      else
        error "Failed to bootstrap $label"
        failed=1
      fi
    else
      info "Launch agent $label already loaded"
    fi
  done

  if [[ $failed -ne 0 ]]; then
    return 1
  fi
  if [[ $count -gt 0 ]]; then
    SUMMARY+=("$count launch agent(s) installed")
  fi
}

install_ide_extensions() {
  header "IDE extensions"

  local extensions_file="$DIR/ide/extensions.txt"
  [[ -f "$extensions_file" ]] || return 0

  # Antigravity is the only IDE. VS Code and Cursor were dropped 2026-08-11;
  # their casks came out of the Brewfile and the applications were uninstalled
  # by hand. The antigravity-ide cask puts the CLI on PATH under two names, and
  # they are the same binary, so take the first that resolves rather than
  # looping over both and installing everything twice.
  local cli=""
  local candidate
  for candidate in antigravity-ide agy-ide; do
    if command -v "$candidate" &>/dev/null; then
      cli="$candidate"
      break
    fi
  done

  if [[ -z "$cli" ]]; then
    warn "Antigravity CLI not on PATH, skipping extensions"
    warn "  the antigravity-ide cask installs it; a hand-installed app does not"
    return 0
  fi

  local installed
  installed=$("$cli" --list-extensions 2>/dev/null | tr '[:upper:]' '[:lower:]')

  declare -A installed_set=()
  while IFS= read -r ext; do
    [[ -n "$ext" ]] && installed_set["$ext"]=1
  done <<< "$installed"

  local missing=()
  local total=0
  while IFS= read -r ext || [[ -n "$ext" ]]; do
    [[ -z "$ext" ]] && continue
    ((total++))
    local lower="${ext,,}"
    if [[ "$FORCE" == true ]] || [[ -z "${installed_set[$lower]+x}" ]]; then
      missing+=("$ext")
    fi
  done < "$extensions_file"
  unset installed_set

  # Anything installed that the curated list does not name. Reported rather than
  # removed: an extension you added deliberately should get added to the list,
  # and one you no longer want should be dropped from the editor.
  local extra=()
  while IFS= read -r ext; do
    [[ -n "$ext" ]] || continue
    # -F matters: extension IDs contain dots, and without it "ms-python.python"
    # is a regex whose dot matches any character.
    grep -qixF "$ext" "$extensions_file" || extra+=("$ext")
  done <<< "$installed"
  if [[ ${#extra[@]} -gt 0 ]]; then
    warn "installed but not in ide/extensions.txt: ${extra[*]}"
  fi

  if [[ ${#missing[@]} -eq 0 ]]; then
    info "all $total extensions installed"
    return 0
  fi

  local installed_count=0
  for ext in "${missing[@]}"; do
    local output
    if output=$("$cli" --install-extension "$ext" --force 2>&1); then
      ((installed_count++))
    else
      # Surface why. A silent "failed to install" gives you nothing to act on,
      # and the usual causes (extension delisted, not available for this editor,
      # network) are all distinguishable from the CLI's own output.
      warn "failed to install $ext: ${output//$'\n'/ }"
    fi
  done
  info "$installed_count/${#missing[@]} extensions installed"
  SUMMARY+=("$installed_count/${#missing[@]} IDE extensions installed")
}

install_claude_plugins() {
  header "Claude Code plugins"

  local sources_file="$HOME/.claude/plugins/marketplace-sources.txt"
  local settings_file="$HOME/.claude/settings.json"

  if ! command -v claude &>/dev/null; then
    warn "Claude Code not found, skipping plugins"
    return 0
  fi
  if [[ ! -f "$settings_file" ]]; then
    warn "Missing $settings_file, skipping plugins"
    return 0
  fi
  if [[ ! -f "$sources_file" ]]; then
    warn "Missing $sources_file, skipping plugins"
    return 0
  fi

  [[ -f "$HOME/.claude/plugins/known_marketplaces.json" ]] || echo '{}' > "$HOME/.claude/plugins/known_marketplaces.json"

  while IFS= read -r source || [[ -n "$source" ]]; do
    [[ -z "$source" ]] && continue
    claude plugin marketplace add "$source"
  done < "$sources_file"

  # Register local-skills marketplace from homebase
  local local_skills_dir="$HOME/.claude/local-skills"
  if [[ -d "$local_skills_dir/.claude-plugin" ]]; then
    info "Registering local-skills marketplace..."
    claude plugin marketplace add "$local_skills_dir"
  fi

  # Refresh marketplace metadata from sources so plugin version bumps become
  # visible to the update step below. `marketplace add` short-circuits when a
  # marketplace is already on disk and does not refresh, so without this a
  # bumped version would never be seen. Git sources do a network fetch here.
  info "Refreshing marketplaces..."
  claude plugin marketplace update >/dev/null 2>&1 || warn "Marketplace refresh hit an error"

  # Extract installed plugin names from formatted `claude plugin list` output.
  # Lines look like: "  ❯ feature-dev@claude-code-plugins"
  local installed_plugins
  local plugin_output
  if ! plugin_output=$(claude plugin list 2>&1); then
    warn "Failed to list Claude plugins: $plugin_output"
    return 1
  fi
  installed_plugins=$(echo "$plugin_output" | grep '❯' | sed 's/.*❯ //' | xargs || true)

  declare -A installed_set=()
  for p in $installed_plugins; do
    installed_set["$p"]=1
  done

  local plugins
  plugins=$(python3 -c "
import json, sys
with open('$settings_file') as f:
    d = json.load(f)
for k, v in d.get('enabledPlugins', {}).items():
    if v:
        print(k)
" 2>/dev/null || true)

  while IFS= read -r plugin; do
    [[ -z "$plugin" ]] && continue

    if [[ -n "${installed_set[$plugin]+x}" ]] && [[ "$FORCE" != true ]]; then
      # Already installed: proactively update so version bumps actually deploy.
      # setup.sh used to short-circuit here, so a bumped plugin never upgraded
      # until a manual `claude plugin update`. update is a near no-op when the
      # plugin is already current. Changes apply on the next claude launch.
      local update_output
      if update_output=$(claude plugin update "$plugin" 2>&1); then
        if echo "$update_output" | grep -q "updated from"; then
          info "Updated: $plugin"
        else
          info "Already current: $plugin"
        fi
      else
        warn "Failed to update $plugin: $update_output"
      fi
    else
      info "Installing: $plugin"
      claude plugin install "$plugin" || warn "Failed to install $plugin"
    fi
  done <<< "$plugins"

  unset installed_set

  SUMMARY+=("Claude plugins configured")
}

install_mcp_servers() {
  header "Claude Code MCP servers"

  if ! command -v claude &>/dev/null; then
    warn "Claude Code not found, skipping MCP servers"
    return 0
  fi

  # Desired MCP servers at user scope (persist across project entries).
  # Format depends on transport:
  #   stdio: name|stdio|command_and_args
  #   http:  name|http|url|optional_header  (single header, eg. "Authorization: Bearer $TOKEN")
  # First time auth on a new machine: each MCP may require its own credentials
  # (e.g., pinole needs PINOLE_API_TOKEN exported in the shell before this script
  # runs so the Bearer header registers populated). Subsequent runs are idempotent.
  # Strava is connected via the native claude.ai Strava connector (account level,
  # managed in claude.ai Settings > Connectors), so it needs no entry here. The
  # old self hosted servers (community `strava` and the gated `strava-mcp`) were
  # retired 2026-06-14 when the native connector became available.
  # ynab is no longer here. It moved to the `ynab` CLI on 2026-08-13 (see
  # install_bun_globals). The MCP server ran under Deno, which neither the
  # Brewfile nor mise installs, so a fresh machine would have failed at launch;
  # the CLI runs on bun, which the Brewfile already carries.

  # pinole left user scope on 2026-08-27. It is project scoped now, in
  # ~/Eudaimonia/.mcp.json, with a headersHelper that reads the bearer token from
  # the Keychain at connect time, so code repo sessions never load it and the
  # token no longer sits in plaintext in ~/.claude.json. The PINOLE_API_TOKEN
  # self heal below stays for any future http entry that needs it.
  # Self-heal: when the env var is empty (headless runs do not source ~/.zshrc),
  # fall back to the token stashed in the macOS Keychain so a fresh machine can
  # re-register pinole without a manual export. The empty-token guard below still
  # protects us if neither source has it.
  if [[ -z "${PINOLE_API_TOKEN:-}" ]] && command -v security &>/dev/null; then
    PINOLE_API_TOKEN="$(security find-generic-password -s pinole-mcp-token -w)" || PINOLE_API_TOKEN=""
  fi

  # playwright left on 2026-09-16: agent-browser attached to the everyday Brave
  # on port 9222 is the one browser tool now, so a registration left from an
  # earlier run is removed here rather than silently kept.
  local retired=(playwright)
  for name in "${retired[@]}"; do
    if claude mcp get "$name" &>/dev/null; then
      if claude mcp remove "$name" --scope user &>/dev/null; then
        SUMMARY+=("MCP server removed: $name")
      else
        warn "Failed to remove retired MCP server: $name"
      fi
    fi
  done

  # Empty for now. The guarded expansion keeps bash 3.2 under `set -u` from
  # failing on an empty array.
  local desired=()

  for entry in ${desired[@]+"${desired[@]}"}; do
    local name="${entry%%|*}"
    local rest="${entry#*|}"
    local transport="${rest%%|*}"
    local target_and_extra="${rest#*|}"

    # Skip any http entry whose bearer header resolved to nothing. Registering
    # with an empty token bakes a broken entry that the `Already registered`
    # short circuit below would silently preserve on every future run, so the
    # server stays broken and setup.sh reports success. This used to test the
    # literal name `pinole`, which meant a second token bearing entry would have
    # walked straight into the same trap unnoticed.
    if [[ "$transport" == "http" ]]; then
      local hdr="${target_and_extra#*|}"
      # An unset token expands to nothing and leaves the header ending in
      # "Bearer " with the trailing space still attached, so trim before testing.
      hdr="${hdr%"${hdr##*[![:space:]]}"}"
      if [[ "$hdr" == *"Bearer" ]]; then
        warn "Skipping $name: its bearer token is empty"
        continue
      fi
    fi

    if claude mcp get "$name" &>/dev/null; then
      info "Already registered: $name"
      continue
    fi

    info "Registering MCP server: $name"
    local add_status=1
    if [[ "$transport" == "http" ]]; then
      local url="${target_and_extra%%|*}"
      local header=""
      if [[ "$target_and_extra" == *"|"* ]]; then
        header="${target_and_extra#*|}"
      fi

      # `--header` is a varargs flag in claude mcp add; positionals must precede
      # it or they get consumed as additional header values.
      if [[ -n "$header" ]]; then
        claude mcp add "$name" "$url" --scope user --transport http --header "$header"
        add_status=$?
      else
        claude mcp add "$name" "$url" --scope user --transport http
        add_status=$?
      fi
    else
      # shellcheck disable=SC2086
      claude mcp add --scope user --transport "$transport" "$name" -- $target_and_extra
      add_status=$?
    fi

    if [[ $add_status -eq 0 ]]; then
      SUMMARY+=("MCP server registered: $name")
    else
      warn "Failed to register MCP server: $name"
    fi
  done
}

configure_repo() {
  header "Repo config"

  # sdlc:review and sdlc:iterate read the optional PR bot trigger from
  # `git config sdlc.review-command`. The plugin default is "/gemini review"
  # but this repo uses CodeRabbit, so pin it locally. This is the public repo
  # fallback only; the review gate itself is the CodeRabbit CLI run on the
  # branch, which needs no config (2026-08-29).
  local desired_command="@coderabbitai review"
  local current
  current="$(git -C "$DIR" config --get sdlc.review-command 2>/dev/null || true)"
  if [[ "$current" == "$desired_command" ]]; then
    info "sdlc.review-command already set to '$desired_command'"
  else
    git -C "$DIR" config sdlc.review-command "$desired_command" || return 1
    info "sdlc.review-command set to '$desired_command'"
    SUMMARY+=("git config: sdlc.review-command set")
  fi
}

setup_auth() {
  header "Authentication"

  if [[ "$INTERACTIVE" != true ]]; then
    info "Non-interactive session, skipping auth (run setup.sh in a terminal to authenticate)"
    return 0
  fi

  # GitHub CLI
  if command -v gh &>/dev/null; then
    if gh auth status &>/dev/null && [[ "$FORCE" != true ]]; then
      info "GitHub CLI already authenticated"
    else
      read -rp "  ${BOLD}Authenticate GitHub CLI? [y/N]${NC} " choice
      if [[ "$choice" =~ ^[Yy]$ ]]; then
        gh auth login || return 1
        SUMMARY+=("GitHub CLI authenticated")
      fi
    fi
  fi

  # SSH key (never regenerate, even with --force)
  if [[ -f "$HOME/.ssh/id_ed25519" ]]; then
    info "SSH key exists"
  else
    read -rp "  ${BOLD}Generate ed25519 SSH key? [y/N]${NC} " choice
    if [[ "$choice" =~ ^[Yy]$ ]]; then
      read -rp "  ${BOLD}Email for SSH key:${NC} " email
      if [[ -n "$email" ]]; then
        ssh-keygen -t ed25519 -C "$email"
        warn "Add your public key to GitHub: https://github.com/settings/keys"
        cat "$HOME/.ssh/id_ed25519.pub"
        SUMMARY+=("SSH key generated")
      fi
    fi
  fi

  # Google Cloud
  if command -v gcloud &>/dev/null; then
    local gcloud_project
    gcloud_project="$(gcloud config get-value project 2>/dev/null || true)"
    if [[ -n "$gcloud_project" ]] && [[ "$gcloud_project" != "(unset)" ]] && [[ "$FORCE" != true ]]; then
      info "Google Cloud already configured"
    else
      read -rp "  ${BOLD}Initialize Google Cloud (gcloud init)? [y/N]${NC} " choice
      if [[ "$choice" =~ ^[Yy]$ ]]; then
        gcloud init || return 1
        SUMMARY+=("Google Cloud initialized")
      fi
    fi
  fi

  # Google Workspace CLI (multi-profile)
  if command -v gws &>/dev/null; then
    # Migrate legacy single-profile layout. Detect whether the legacy config
    # has an authenticated account; any detected account maps to "personal"
    # (the zero profile retired with the Zero W2, 2026-06-29; the home profile
    # was renamed to personal 2026-08-14).
    local migrated_profile=""
    if [[ -d "$HOME/.config/gws" ]]; then
      local legacy_user=""
      legacy_user=$(GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$HOME/.config/gws" gws auth status \
        | jq -r '.user // empty' \
        || true)

      local legacy_profile=""
      case "${legacy_user,,}" in
        "") legacy_profile="" ;;
        *) legacy_profile=personal ;;
      esac

      if [[ -z "$legacy_profile" ]]; then
        warn "Could not detect account in ~/.config/gws (no auth state to inspect)."
        warn "Rename it manually before re-running setup:"
        warn "  mv ~/.config/gws ~/.config/gws-personal"
      else
        local migration_target="$HOME/.config/gws-$legacy_profile"
        if [[ -e "$migration_target" ]]; then
          warn "Both ~/.config/gws (account: $legacy_user) and $migration_target exist. Inspect and remove the stale one manually."
        else
          info "Migrating ~/.config/gws -> $migration_target (detected account: $legacy_user)"
          mv "$HOME/.config/gws" "$migration_target" || return 1
          SUMMARY+=("gws: migrated legacy config to $legacy_profile profile ($legacy_user)")
          migrated_profile="$legacy_profile"
        fi
      fi
    fi

    # Rename the home profile dir to personal (2026-08-14). Done before the
    # pointer is read so a machine that has not run setup since the rename
    # heals itself rather than resolving to a dir that no longer exists.
    if [[ -d "$HOME/.config/gws-home" ]]; then
      if [[ -e "$HOME/.config/gws-personal" ]]; then
        warn "Both ~/.config/gws-home and ~/.config/gws-personal exist. Inspect and remove the stale one manually."
      else
        info "Renaming ~/.config/gws-home -> ~/.config/gws-personal"
        mv "$HOME/.config/gws-home" "$HOME/.config/gws-personal" || return 1
        SUMMARY+=("gws: renamed home profile to personal")
      fi
    fi

    # Seed the active-profile pointer. Prefer the just-migrated profile;
    # otherwise default to personal (add profiles back to the loop below if
    # multi-account returns).
    [[ -f "$HOME/.config/gws-current" ]] || printf '%s\n' "${migrated_profile:-personal}" > "$HOME/.config/gws-current"

    # Migrate a retired pointer forward. zero retired with the Zero W2 and its
    # dirs are deleted; home was renamed to personal. Either left in place
    # would break resolution.
    if [[ -r "$HOME/.config/gws-current" ]]; then
      local current_pointer
      current_pointer="$(tr -d '[:space:]' < "$HOME/.config/gws-current")"
      if [[ "$current_pointer" == "zero" || "$current_pointer" == "home" ]]; then
        info "Rewriting retired '$current_pointer' profile pointer to personal in ~/.config/gws-current"
        printf '%s\n' "personal" > "$HOME/.config/gws-current"
      fi
    fi

    # Each profile's OAuth client is fetched from its own identity's vault
    # (bin/lib/vault.sh); the personal client moved out of the business project
    # in the 2026-08-14 split. GWS_BOOTSTRAP_PROJECT still forces one project
    # for every profile, which is what a recovery run wants.
    local gws_bootstrap_project gws_profile gws_dir
    for gws_profile in personal atelic tpf; do
      gws_bootstrap_project="${GWS_BOOTSTRAP_PROJECT:-$(vault_project_for_profile "$gws_profile")}"
      gws_dir="$HOME/.config/gws-$gws_profile"
      if [[ -f "$gws_dir/client_secret.json" ]] && [[ -f "$gws_dir/credentials.enc" ]] && [[ "$FORCE" != true ]]; then
        info "gws $gws_profile profile already configured ($gws_dir)"
        continue
      fi
      read -rp "  ${BOLD}Authenticate gws $gws_profile profile? [y/N]${NC} " choice
      [[ "$choice" =~ ^[Yy]$ ]] || continue
      mkdir -p "$gws_dir"
      if [[ ! -f "$gws_dir/client_secret.json" ]]; then
        # Try to fetch from GCP Secret Manager first.
        if command -v gcloud &>/dev/null; then
          info "Fetching $gws_profile client_secret from Secret Manager (project: $gws_bootstrap_project)"
          if gcloud secrets versions access latest \
              --secret="gws-oauth-client-$gws_profile" \
              --project="$gws_bootstrap_project" \
              > "$gws_dir/client_secret.json" 2>/dev/null; then
            chmod 600 "$gws_dir/client_secret.json"
            info "Fetched $gws_profile client_secret from Secret Manager"
          else
            rm -f "$gws_dir/client_secret.json"
            warn "Could not fetch from Secret Manager (auth, network, or missing secret)"
          fi
        fi
        if [[ ! -f "$gws_dir/client_secret.json" ]]; then
          warn "Missing $gws_dir/client_secret.json"
          warn "Options:"
          warn "  1. Authenticate gcloud against the GWS bootstrap project and rerun setup:"
          warn "       gcloud auth login && gcloud config set project $gws_bootstrap_project"
          warn "  2. Copy the OAuth client JSON manually to $gws_dir/client_secret.json"
          warn "Press Enter once one of the above is done."
          read -r
          if [[ ! -f "$gws_dir/client_secret.json" ]]; then
            error "Still missing $gws_dir/client_secret.json -- skipping $gws_profile"
            continue
          fi
        fi
      fi
      if GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$gws_dir" gws auth login; then
        SUMMARY+=("gws: $gws_profile profile authenticated")
      else
        error "gws auth login failed for $gws_profile"
      fi
    done
  fi

  # YNAB personal access token. The canonical copy lives in the BitWarden "YNAB"
  # entry (PAT field); the login Keychain is the operational store (service
  # ynab-token, per the vault naming convention). It seeded the retired MCP
  # server launcher; it now backs `ynab auth login -t` for the CLI (see
  # install_bun_globals). -s read keeps the pasted token off the terminal.
  if security find-generic-password -a "$USER" -s ynab-token -w &>/dev/null && [[ "$FORCE" != true ]]; then
    info "YNAB token already in Keychain"
  else
    read -rsp "  ${BOLD}Paste YNAB personal access token (from BitWarden, blank to skip):${NC} " ynab_pat
    echo
    if [[ -n "$ynab_pat" ]]; then
      if security add-generic-password -U -a "$USER" -s ynab-token -w "$ynab_pat"; then
        SUMMARY+=("YNAB token stored in Keychain")
      else
        warn "Failed to store YNAB token in Keychain"
      fi
      unset ynab_pat
    fi
  fi

  # Seeding the Keychain is not enough on its own. The CLI keeps its own
  # credential under a separate Keychain service (`ynab-cli`) written by
  # `ynab auth login`, and never reads `ynab-token`. Without this step a fresh
  # machine finishes setup reporting success and leaves the CLI unauthenticated,
  # which is the same failure the Deno dependency produced before it: setup is
  # green, the tool is dead. Idempotent, since re-running login just replaces
  # the stored credential.
  if command -v ynab &>/dev/null; then
    local ynab_tok
    ynab_tok="$(security find-generic-password -a "$USER" -s ynab-token -w 2>/dev/null || true)"
    if [[ -z "$ynab_tok" ]]; then
      warn "No ynab-token in Keychain; skipping ynab CLI login"
    elif ynab auth status &>/dev/null && [[ "$FORCE" != true ]]; then
      info "ynab CLI already authenticated"
    elif ynab auth login -t "$ynab_tok" &>/dev/null; then
      SUMMARY+=("ynab CLI authenticated")
    else
      warn "ynab auth login failed"
    fi
    unset ynab_tok
  fi
}

print_summary() {
  header "Setup complete"

  if [[ ${#FAILURES[@]} -gt 0 ]]; then
    for phase in "${FAILURES[@]}"; do
      error "Phase failed: $phase"
    done
    echo ""
  fi

  if [[ ${#SUMMARY[@]} -eq 0 ]]; then
    info "Everything was already up to date"
  else
    for item in "${SUMMARY[@]}"; do
      info "$item"
    done
  fi

  if [[ ${#FAILURES[@]} -gt 0 ]]; then
    warn "Some phases failed. Re-run setup.sh to retry, or fix manually."
  fi

  warn "You may need to restart your shell for all changes to take effect"
  echo ""

  [[ ${#FAILURES[@]} -eq 0 ]]
}

###############################################################################
# Main
###############################################################################

# Only dispatch when executed. Sourcing the script defines the phases without
# running them, which is how bin/lint/reconcile-test exercises reconcile_home
# against a scratch $HOME.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if [[ "$DRY_RUN" == true ]]; then
    # A dry run is about $HOME: show every create, replace and delete the
    # reconciler would make, and do nothing else. The install phases are skipped
    # outright rather than simulated, because brew, npm and mise have no dry
    # run worth trusting and "touch nothing" has to mean it.
    warn "Dry run: installing nothing. Home changes only."
    run_phase reconcile_home
  else
    run_phase setup_prerequisites
    run_phase install_brew_packages
    # Order matters from here. The reconciler deploys mise/config.toml, which
    # setup_runtimes reads; setup_runtimes puts node on PATH, which npm globals
    # need; and the reconciler deploys the .claude tree that install_claude_
    # plugins and install_mcp_servers read out of $HOME.
    run_phase reconcile_home
    run_phase setup_runtimes
    run_phase install_npm_globals
    run_phase update_claude_code
    run_phase install_bun_globals
    run_phase setup_agent_browser
    run_phase install_launchagents
    run_phase install_brave_launcher
    run_phase install_ide_extensions
    run_phase install_claude_plugins
    run_phase install_mcp_servers
    run_phase configure_repo
    run_phase setup_auth
  fi
  print_summary
fi
