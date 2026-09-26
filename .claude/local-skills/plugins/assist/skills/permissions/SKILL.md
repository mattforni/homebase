---
name: permissions
description: Hoist project-level permissions into user-level settings, collapsing similar entries into wildcards. Use this skill whenever the user says "hoist permissions", asks to clean up their project permissions, wants to promote permissions to user level, or mentions that they're tired of re-approving the same tools across projects. Also trigger when the user says "move permissions up" or asks for help organizing `.claude/settings.local.json`.
allowed-tools:
  - Read
  - Edit
---

# Permissions Assist

Intelligently move permissions from project-level `.claude/settings.local.json` to user-level `~/.claude/settings.json`. Not every permission belongs at user level, and similar permissions should be collapsed into wildcards.

## Steps

1. Read `.claude/settings.local.json` from current working directory
2. Read `~/.claude/settings.json` (user-level settings)
3. Extract `permissions.allow` arrays from both files
4. Analyze each project-level permission using the rules below
5. Build the final merged list (collapsing, deduplicating, upgrading as appropriate)
6. Sort the merged array alphabetically
7. Update `~/.claude/settings.json` with the merged permissions
8. Update `.claude/settings.local.json` to set `permissions.allow` to an empty array (preserve other settings like `enabledMcpjsonServers`)
9. Report a summary organized into sections: hoisted, collapsed, skipped (already covered), and kept at project level

## Collapsing Rules

Before hoisting, collapse similar permissions into wildcards:

**Bash commands for the same CLI tool**: Multiple permissions for the same tool (e.g., `gws --version`, `gws auth:*`, `command -v gws`) should collapse to `Bash(gws:*)`. The `command -v <tool>` pattern is a version/existence check and belongs with that tool's wildcard.

**MCP tools for the same service**: Multiple `mcp__claude_ai_<Service>__<action>` permissions should collapse to `mcp__claude_ai_<Service>__*`. For example, `mcp__claude_ai_Gmail__gmail_get_profile` and `mcp__claude_ai_Gmail__gmail_search_messages` become `mcp__claude_ai_Gmail__*`.

**Always prefer the more permissive form**: When a narrower permission and a broader wildcard overlap, keep only the wildcard. This applies in both directions: if `Bash(gws --version)` already exists at user level and `Bash(gws:*)` is being hoisted, replace the narrow one with the wildcard. If the wildcard already exists at user level and a narrow permission is being hoisted, skip the narrow one. The goal is one entry per tool at the broadest level seen.

## What to Hoist (general purpose)

These are safe to promote to user level because they are useful across projects:

- **Common CLI tools**: Standard unix commands, package managers, language runtimes, dev tools. If it is a general purpose command line tool, hoist it.
- **MCP service wildcards**: After collapsing individual MCP actions into service-level wildcards, hoist them. Services like Gmail, Calendar, Slack, Linear, and Todoist are used across projects.
- **WebFetch domains**: General purpose sites (docs sites, major platforms like medium.com, drive.google.com, npm registries). Hoist these.
- **WebSearch**: Always general purpose. Hoist.
- **Skills**: Skill permissions are user-level by nature. Hoist.

## What to Keep at Project Level

These should NOT be hoisted because they are project-specific:

- **Project-specific scripts**: Commands like `bash setup.sh`, `bash deploy.sh`, `bash install.sh`, or any command referencing a repo-specific file path. These only make sense in the context of one project.
- **Project-specific environment setup**: Commands like `RAILS_ENV=test bundle exec rails db:migrate:status` that reference a specific project's toolchain in a specific way.

When uncertain whether a permission is general or project-specific, default to hoisting. The user approved it once, which signals it is a tool they use. Better to have it available everywhere than to be asked again in a different project.

## Important

- Do NOT delete permissions from user-level settings, only add to them (except when replacing a narrow permission with its broader wildcard)
- Preserve all other settings in both files (only modify `permissions.allow`)
- If project has no permissions to hoist, report that and exit
- Sort is case-sensitive alphabetical
- When collapsing, remove the narrower permissions from the final list if a wildcard covers them
- Apply collapsing to both newly hoisted AND existing user-level permissions (clean up the user-level list too)

## Learned Rules

See [learned-rules.md](learned-rules.md).
