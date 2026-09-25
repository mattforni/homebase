# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Homebase is where every dotfile, shell config, Claude Code skill, agent, hook, and piece of workstation tooling lives, so the whole setup can be iterated on in one place and shared across machines. It is public, where Eudaimonia (the personal library) is private. This file deploys to `~/CLAUDE.md`, so it loads into every session under the home directory, Eudy included: it holds only the rules every session needs. Depth that matters only when a particular file is being edited lives in `.claude/rules/<topic>.md` with `paths:` frontmatter, which Claude Code loads the moment it reads a matching file and never otherwise. The fuller framing is in [README.md](README.md).

| Rule file | Loads when you touch | Holds |
|---|---|---|
| `.claude/rules/setup.md` | `setup.sh`, `bin/lib/deploy-table.sh` | phase conventions, the deploy modes and reconciler, the MCP entry traps, the consumer sweep |
| `.claude/rules/plugins.md` | `plugins/**`, `.claude-plugin/**`, `.claude/local-skills/**` | plugin versioning in full |
| `.claude/rules/bin.md` | `bin/**`, `.githooks/**`, `.github/workflows/**` | script namespaces, shims, `bin/lib/` sourcing rules, the lint gates |
| `.claude/rules/shell.md` | `.zshrc`, `.aliases`, `.functions`, `.gitconfig` | the shell inventory and why there is no bash config |
| `.claude/rules/ide.md` | `ide/**` | Antigravity settings and the extension availability trap |

## Plugin Versioning

Every change inside `plugins/<plugin>/...` or `.claude/local-skills/plugins/<plugin>/...` bumps the version in that plugin's `plugin.json` and in the matching `marketplace.json` entry (the two must be equal) before it merges; without the bump the marketplace cannot tell old from new and updates silently stop propagating. Semver: patch for prose, fixes, and rules inside a skill body; minor for a new skill, command, or hook, and for a removal that keeps the invocation contract; major for a breaking contract change or a rename, which also moves the directory, the `name:` frontmatter, the marketplace `skills` entry, and every cross reference. Read the current version from `origin/main` (`git show origin/main:<path>/plugin.json`), never from the local checkout, and treat a version that moves backward in a diff as a review red flag. Files outside plugin directories never trigger a bump. Full rule: `.claude/rules/plugins.md`.

## Installation and Deployment

`./setup.sh` reconciles `$HOME` against the deploy table in `bin/lib/deploy-table.sh` (creating what is missing, fixing what is wrong, removing what homebase used to deploy and no longer does), then installs brew packages, mise runtimes, npm globals, IDE extensions, and Claude plugins, and runs authentication setup. `./setup.sh --dry-run` shows every change, removals included, without installing anything. It refuses to run from a git worktree, since the symlinks would resolve into a checkout that disappears on merge.

Most tracked files are symlinked into `$HOME`, so an edit in the repo is already live. Run `./setup.sh` only when the deploy table itself changed or to pick up brew, node, and plugin updates. There is no step for copying changes back out of `$HOME`. Never link a directory that receives foreign writes, which is why `~/.claude` is listed child by child. Depth: `.claude/rules/setup.md`.

## Configuration Files

`.zshrc` is the only shell rc and sources `.aliases` and `.functions`; there is deliberately no bash configuration. `.gitconfig`, `.vimrc`, `.screenrc`, `mise/config.toml`, `ide/settings.json` (Antigravity), and the `.claude` tree are the rest. `git cob <number>` checks out a branch by its position in `git branch` output. Depth: `.claude/rules/shell.md` and `.claude/rules/ide.md`.

### Account Profiles (gws, hs)

Two CLIs switch identity per directory subtree via a `.account` marker file (one line holding the profile name): `gws` for Google Workspace and `hs` for HubSpot, each through a PATH shim in `bin/` that re resolves the marker on every call. Profiles: `personal` (`mattforni@gmail.com`, the ambient default), `tpf` (`matt@theproductforge.com`, marker at the TPF Vocation subtree), and `atelic` (`matt@atelic.me`, in flight). The shim is the authoritative layer because agent shells, launchd, cron, and `sh -c` never run the shell startup resolvers; Claude Code replays a startup snapshot that drops top level calls, so an agent shell silently inherits the launching terminal's profile while a `.account` marker sits one directory away. The full account of the layers, the stamp comparison trap, and the 2026-08-17 wrong mailbox incident live in `~/Eudaimonia/Admin/Tools/gws.md`.

| Command | Effect |
|---------|--------|
| `gws-use` | List profiles; show current |
| `gws-use <profile>` | Set ambient profile (persists across shells; also unpins) |
| `gws-pin` | Lock to current profile in this shell |
| `gws-unpin` | Resume chpwd hook |
| `gws-whoami` | Re-resolve from `$PWD`, then show profile, config dir, and `gws auth status` |
| `GWS_FORCE_PROFILE=personal gws ...` | One shot override. Unambiguous; prefer this everywhere |
| `GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.config/gws-personal gws ...` | Legacy one shot override. Silently ignored when it names the profile you are already on |
| `hs ... --account=hs-pat-atelic` | One shot override for HubSpot; an explicit flag always wins |

HubSpot maps profiles to accounts through an explicit table in `bin/hs` (the accounts are named for the businesses, the profiles for the identity); an unmapped profile falls through to the CLI default with a warning rather than guessing a portal, because writing to the wrong CRM is the expensive failure. Retired profile names (`zero`, `home`) normalize forward to `personal` in `bin/lib/account-profile.sh`. OAuth client files sync across machines through GCP Secret Manager as `gws-oauth-client-<profile>`, routed to each identity's vault by `bin/lib/vault.sh`; `setup.sh` fetches one automatically when a profile dir lacks it, and encrypted tokens stay per machine by design. Vault conventions: `~/Eudaimonia/Admin/Tools/secret-manager.md`.

Claude Code has no profiles and one config dir (the `~/bin/claude` wrapper retired 2026-08-12, ATE-463, because every profile authenticated to the same account and connectors bind to the account, not a directory). Per directory tooling goes in a `.mcp.json` at the subtree root, per repo behavior in that repo's `.claude/settings.json`, per directory CLI identity through `.account` plus a shim.

## Project Structure

```text
.
├── .zshrc, .aliases, .functions   # The shell (zsh only)
├── .gitconfig, .vimrc, .screenrc  # Editors and git
├── ide/             # Antigravity settings and curated extension list
├── mise/            # Runtime version pins (node, ruby)
├── brew/            # Brewfile
├── .claude/         # The user level Claude Code tree, deployed child by child
│   └── rules/       #   Path scoped depth for this repo (see the table above)
├── bin/             # Scripts: flat files are shims, directories are namespaces
│   ├── lib/         #   Shared, sourced rather than duplicated (deploy table, vault routing)
│   └── lint/        #   shell, reconciler, and context size checks, run by CI and pre-commit
├── plugins/         # The skillset marketplace plugins (sdlc, linear-lifecycle)
├── coderabbit/      # The two CodeRabbit house standards
├── launchd/         # Login agents: Brave holding the CDP port (see its README)
├── .githooks/       # Tracked git hooks; activate with core.hooksPath
└── setup.sh         # Installation and reconciliation
```

## Path Conventions

Never hard code a username in tracked config or documentation. Homebase deploys to several machines, and `/Users/forni/...` breaks on every one that does not match. Use `$HOME` in shell scripts and JSON, `~` in markdown and aliases. If a tool reads a value literally and does not expand either, surface that as a `setup.sh` templating gap rather than working around it with a username.

## Code Review

**`coderabbit review --base origin/main --committed --agent` on the branch is the gate, here and everywhere else** (adopted 2026-08-29). It runs locally in a couple of minutes, needs no trigger comment, has no PR queue, and returns real findings. Run it before a merge and read what it says; `~/Eudaimonia/Admin/Tools/coderabbit.md` carries the mechanics, the JSONL shape, the rate limits, and why the CLI needs a cwd wrapper.

Homebase is **public**, so it is one of the repos where the PR bot also works: the free Open Source plan gives CodeRabbit full inline review on pull requests here, unlike the private repos where it can only summarize. That makes the bot a genuine second look on this repo and it stays enabled, but it is the fallback, not the thing to wait on. It posts within seconds of a PR opening, does not re review on a bare push (trigger with `@coderabbitai review`), and leaves a stale "Changes requested" status until it does; dismiss that through the API once every comment is addressed. Gemini Code Assist reviewed here until 2026-07-17, when Google sunset the consumer app.

The two house standards (chill for client sites, assertive for own code) live in [coderabbit/](coderabbit/README.md); this repo's root `.coderabbit.yaml` is the assertive canonical. Triage guidance lives in GC's Code Review section.

## Landing Changes: Decide by the Heuristic

Pick the path from the change; do not ask (Forni delegated this 2026-08-24, having noticed he was not reading the question). **Direct to main** when all three hold: under roughly 20 lines changed, prose only, and touching nothing executable and no plugin version. A `.gitignore` change also lands direct, whatever its size (Forni, 2026-09-25). **A pull request** otherwise, and always for anything that runs: `setup.sh`, `bin/`, `plugins/`, `.claude/settings.json`, the shell rc files, and any new skill. The heuristic was derived from 117 commits over six weeks and reproduces Forni's observed choices.

**Fetch `origin/main` and compare against it immediately before landing, never against the base the branch was cut from.** Concurrent sessions land here often, and a plugin version bump makes staleness silently destructive: two branches that both bump to the same version merge clean and publish the second change under a version already released, where no installed copy will ever see it. Cut follow up branches fresh from `origin/main` immediately before the bump commit.

**A direct merge is linted only after the fact, so check `main` afterward.** The lint workflow runs on pushes to `main` but nothing gates a direct push, so a failing commit lands anyway and `main` goes red until someone looks. After any direct merge, run the relevant check locally (`npx markdownlint-cli2 "*.md"` for prose) or confirm the push's own Actions run went green. When a PR reports a failure in a file it did not touch, suspect inherited breakage before debugging your own diff.

## Linting

Three gates, each running the same script locally and in CI: markdown (`npx markdownlint-cli2`, globs kept in sync between `.markdownlint-cli2.jsonc` and the workflow), shell (`bin/lint/shell`: shellcheck plus `bash -n` plus `zsh -n`, gated at warning severity), and the reconciler test (`bin/lint/reconcile-test`). A fourth, `bin/lint/context-size`, is the ratchet on the two always loaded files this repo owns (`CLAUDE.md` and `.claude/CLAUDE.md`): each has a byte cap set at its last reduction, the check fails when either grows past it, and lowering a cap is how a reduction locks in. The tracked `.githooks/pre-commit` runs the first two on staged files plus the ratchet when either file is staged; activate it once per clone with `git config core.hooksPath .githooks`. Depth and gotchas: `.claude/rules/bin.md`.
