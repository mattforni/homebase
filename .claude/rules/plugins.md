---
paths:
  - "plugins/**"
  - ".claude-plugin/**"
  - ".claude/local-skills/**"
---

# Plugin Versioning

Loaded when anything under a plugin directory or a marketplace file is read. `CLAUDE.md` carries the three line version of this rule; this is the full one.

## Plugin Versioning

**Every change to anything inside `plugins/<plugin>/...` requires a version bump in two places before the change merges.** Skill prose, scripts, configs, hooks, command definitions, the plugin.json itself, anything inside a plugin directory. Without a version bump, the marketplace cannot tell "you have the old skill" from "you have the new skill," and updates silently fail to propagate.

Bump both, and keep them in sync:

- `plugins/<plugin>/plugin.json`: `version` field
- `.claude-plugin/marketplace.json`: `version` field for the matching plugin entry (must equal the plugin.json value)

Use semver:

- **Patch** (`2.2.1` to `2.2.2`): behavioral tweaks, bug fixes, prose updates, hardening, rule additions inside a skill body.
- **Minor** (`2.2.1` to `2.3.0`): new skill, new command, new hook, new public surface area.
- **Major** (`2.2.1` to `3.0.0`): breaking change to a skill's contract, argument shape, or removed surface.

**A removal that does not change the invocation contract is a minor.** The three buckets above define minor purely as additions, which leaves no home for taking an internal path out of a skill while `plugin:skill` still resolves and still accepts the same arguments. Patch understates it and major overstates it. Removing the MCP fallback from `sdlc:groom-issues` on 2026-08-12 is the worked example: the skill did the same job with the same arguments and only stopped reaching for a second tool internally. "Removed surface" in the major rule means removed *invocation* surface, the sense the rename example uses.

**Renaming a skill is always a major bump.** A rename removes the old invocation surface (`assist:oldname` stops resolving), so it is a breaking change by definition regardless of how much the body changed. Renaming also has a blast radius beyond the version fields: the skill directory, its `name:` frontmatter, the `skills` array entry in `marketplace.json`, and every cross-reference in other skills or docs (`grep` for the old `assist:<name>`) must all move together in the same change.

**Bump against origin/main, never against the local checkout.** A stale checkout carries an old version, and a bump computed from it silently regresses the marketplace: users on the newer version see nothing to update, and skill changes stop propagating with no error anywhere. (Observed 2026-08-04: a commit from a stale checkout took assist from 8.0.11 back to 8.0.7; the regression rode main until the next merge restored the lineage.) Before choosing the next version, fetch and read the current one from origin/main (`git show origin/main:<path to plugin.json>`), and treat any version that moves backward in a diff as a review red flag.

Top-level repo files (`CLAUDE.md`, `README.md`, `.gitconfig`, `.aliases`, etc.) do **not** trigger a plugin version bump because they live outside any plugin directory.

## Testing a Plugin Edit Before the Bump

`claude --plugin-dir <folder>` (2.1.265 and later) loads every subfolder of that folder that carries a manifest as its own plugin for that session, and picks up a subfolder added or removed mid session without a restart. Point it at `plugins/` to load sdlc and linear-lifecycle from the checkout, or at `.claude/local-skills/plugins/` for assist; the two are separate folders, so a session that needs both passes the flag twice. The installed marketplace copy stays untouched, so this is the way to try a skill change live before the version bump publishes it.
