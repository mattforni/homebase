---
paths:
  - "setup.sh"
  - "bin/lib/deploy-table.sh"
---

# setup.sh and the Deploy Table

Loaded when `setup.sh` or the deploy table is read. The rules every session needs are the one liners in `CLAUDE.md`; this file is the depth behind them.

## Installation

Run `./setup.sh` to install homebase to the home directory. The script will:

- Reconcile `$HOME` against the deploy table, creating what is missing, fixing what is wrong, and removing what homebase used to deploy and no longer does. Repo tooling is never deployed. See [How Homebase Reaches `$HOME`](#how-homebase-reaches-home)
- Install brew packages, runtimes via mise, npm globals, IDE extensions, and Claude plugins
- Set up authentication (GitHub CLI, SSH, Google Cloud, gws)

Run `./setup.sh --dry-run` first to see every change it would make to `$HOME`,
removals included, without installing anything.

## setup.sh Phase Conventions

`setup.sh` is split into phases like `setup_prerequisites`, `install_brew_packages`, `reconcile_home`, and `setup_auth`. The `setup_auth` phase short circuits early when `INTERACTIVE != true`, because OAuth flows and `read -rp` prompts require a TTY.

**Phase order is load bearing in three places.** `reconcile_home` deploys
`mise/config.toml`, which `setup_runtimes` reads. `setup_runtimes` puts node on
`PATH`, which `install_npm_globals` needs. And `reconcile_home` deploys the
`.claude` tree that `install_claude_plugins` and `install_mcp_servers` read back
out of `$HOME`.

**Bootstrap operations must NOT live inside `setup_auth`.** File moves, directory creation, marker file seeding, and other no-TTY-required scaffolding belong in their own phases that run regardless of interactivity. If they sit inside `setup_auth`, a non-interactive run (Claude Code background session, headless launchd, CI) will silently skip them along with the auth prompts.

**Pattern to follow when adding new tooling to setup.sh:**

- Split the work into a bootstrap step (file ops, idempotent, runs always) and an auth step (interactive prompts, runs only when `INTERACTIVE == true`).
- The bootstrap step goes in its own phase function (e.g., `bootstrap_claude_profiles`) or inside an existing non-auth phase.
- The auth step goes inside `setup_auth`, gated by the existing `INTERACTIVE` check.

**Why it matters:** Codified 2026-05-19. The Claude Code profile-dir bootstrap initially shipped inside `setup_auth`, which meant a non-interactive `./setup.sh` invocation (the way it runs from inside a Claude Code background session) skipped the entire block, and the profile dirs never got created until `bin/claude-profiles-init.sh` was invoked by hand. That bootstrap retired with the profile split on 2026-08-12, but the rule it produced is general and still binding: split file operations out of `setup_auth` so a headless run does not skip them.

**A phase must prove the tool works in that same run, not that the install command exited zero.** A green `setup.sh` that leaves a tool dead is worse than a failing one, because nothing signals until the tool is next reached for, usually on the fresh machine where it matters most. The YNAB migration produced three of these in a single day (2026-08-13), each one green: the MCP server needed Deno, which neither the Brewfile nor mise installs; `setup_auth` seeded a Keychain token the CLI never reads, because the CLI keeps its own credential under a different service; and `install_bun_globals` put `~/.bun/bin` on the next shell's PATH but not on setup's own, so the very next phase's `command -v` found nothing. When adding tooling, end the phase with a check that exercises the thing (`auth status`, a trivial read, `command -v` after the PATH is set), and warn loudly when it fails.

### Adding HTTP MCP Entries to `install_mcp_servers`

The desired array supports both stdio and http transports. For http entries that carry an `Authorization: Bearer ${SOME_TOKEN:-}` header, two non-obvious traps apply. Both are documented in `~/Eudaimonia/Admin/Tools/claude-code.md`:

- `claude mcp add --header` is variadic, so positionals must precede the flag or the CLI eats them as additional headers.
- Registering with an empty token bakes a broken auth header that the `Already registered` short circuit silently preserves on later runs. Guard with a `[[ -z "${SOME_TOKEN:-}" ]]` skip before the loop body, matching the atelic guard.

### Removing an Integration Is Not Done Until Its Consumers Are Swept

**Deleting an MCP server, a connector, or a plugin is half the change. The other half is grepping for everything that named it, and the grep covers every removed thing, not the one currently in mind.** A skill that declares a tool which no longer exists does not fail loudly; it silently loses a capability, or its `allowed-tools` block quietly stops matching anything.

Before landing a removal, grep the live surface (`.claude/agents`, `.claude/skills`, `.claude/local-skills`, `plugins/`) for the server name in every form it appears: the qualified tool (`mcp__claude_ai_Todoist__add-tasks`), the wildcard (`mcp__claude_ai_Todoist__*`), and any prose naming it. Read the whole result; a truncated `head` is how a partial sweep looks complete.

Codified 2026-08-13. Retiring six connectors in one session swept Linear's consumers thoroughly and left everything else: Todoist survived in five skills plus the `planner` agent, which is the entire Sunday planning set, and Notion and Google Calendar survived in five more. The break surfaced only when `assist:wrap` ran its own Todoist step and nothing happened. Two of them were found on a second pass, after a truncated grep had already been read as clean.

### How Homebase Reaches `$HOME`

`bin/lib/deploy-table.sh` is the single source of truth. `setup.sh` reconciles
`$HOME` against it: it creates what is missing, fixes what is wrong, and removes
what homebase used to deploy and no longer does.

Three deploy modes, chosen per path:

- **link** — symlink into the repo, so a `git pull` is live with no deploy step. Only for paths nothing but a human or git ever writes. **A tool that saves by writing a temp file and renaming over the target replaces the symlink with a regular file**; Claude Code ([#40857](https://github.com/anthropics/claude-code/issues/40857), closed as not planned), VS Code and macOS `sed -i` all do this, with no error. Never link a directory that receives foreign writes, which is why `~/.claude` is listed child by child.
- **copy** — a tracked file living inside a directory that receives foreign writes. Files only.
- **merge** — JSON merge by top-level key. Keys the repo declares are replaced whole; keys it does not are left alone, so Claude Code's `theme` and `effortLevel` and Antigravity's UI toggles survive every run. Because a declared key is replaced whole, dropping an entry from inside one (a permission out of `permissions.allow`) does reach `$HOME`. **Deleting an entire top-level key from the repo does not remove it downstream**: once undeclared it is indistinguishable from a key the app owns, so delete those by hand.

One link deliberately renames its destination: `.claude/user-rules` deploys to `~/.claude/rules`, the user level rules directory Claude Code reads in every project. It cannot share a source with `.claude/rules`, because that directory is this repo's project scoped rules and its globs (`bin/**`, `setup.sh`) are relative to homebase; linked into `~/.claude/rules` they would fire in every repo on the machine. Path scoped user rules (`paths:` frontmatter) load only when a matching file is read, so the directory costs nothing at launch. Added 2026-09-03 for the context placement rule (ATE-472).

Removal is what the record at `~/.local/state/homebase/manifest` exists for.
Without it the script cannot tell a path it placed from one it never touched,
which is why the old rsync could only ever add. **Nothing is removed unless
provenance checks out**: every file under the path must be one homebase has
tracked at some point in git history. Staleness is expected and fine; a file
homebase never tracked means something else owns the directory, so it is left
alone with a warning. That guard matters because `setup_auth` writes SSH keys
and gws credentials into `$HOME` that cannot be regenerated without a terminal.

Inspect before committing to it:

```bash
./setup.sh --dry-run    # every create, replace and delete; installs nothing
```

`setup.sh` refuses to reconcile from a git worktree, since the symlinks would
resolve into a checkout that disappears when the branch merges.
