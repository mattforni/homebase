---
name: browser-fleet
description: Parallelize real browser work across 2 to 5 agents, each driving its own isolated agent-browser session. Use when the same browser task repeats across many targets, like submitting contact forms across a prospect list, sweeping lodging sites for a trip, or scraping JS rendered pages. Triggers on "browser fleet", "parallel browsers", "fan out the browser", "submit these forms in parallel", or /browser-fleet. Not for single site sessions (plain agent-browser) or authenticated flows in Forni's own Brave (one agent-browser session attached with --cdp 9222).
---

# Browser Fleet

Fan browser work out across parallel subagents, each with its own isolated `agent-browser` session. Adopted from Greg's multi agent Chrome pattern 2026-07-23, collapsed onto our stack: `agent-browser --session <name>` gives per agent isolation natively (own cookies, tabs, refs), the Agent tool gives parallelism and result collection, so Greg's Chrome on ports scaffolding, per agent MCP configs, and chat.md coordination all disappear.

## Tool Choice

- **agent-browser** (this skill) for everything unauthenticated or freshly authenticated: forms, scraping, sweeps, verification. Lightest context per action.
- **One session attached to Forni's Brave** (`agent-browser --session <name> --cdp 9222`) when the task needs his logins, Bitwarden, or a real browser past a bot check (banking, YNAB, Google, logged in web apps). That browser is shared with him, so it is never fanned out; the Playwright MCP that used to do this was retired 2026-09-16.

## Execution

1. **Build the target list.** Each work item is one URL plus the actions to take there (form fields, data to extract). Chunk targets across 2 to 5 agents; don't over provision (10 forms wants 3 agents, not 5).
2. **Spawn agents in parallel** (single message, multiple Agent calls, or a Workflow pipeline for larger lists). Each agent's prompt includes:
   - Its session name: every command runs as `agent-browser --session fleet-<n> <command>`. Sessions are fully isolated from each other and from the default session.
   - The recipe: run `agent-browser skills get core` first; use `snapshot -i` refs and re-snapshot after every page change (refs go stale); `--session` on every single call; resolve the binary once with `command -v agent-browser` before any loop and use that absolute path inside loop bodies (the sandbox strips PATH there), so the recipe works wherever agent-browser is installed.
   - Its target chunk with exact per target instructions and what to return (structured results, not transcripts).
   - Cleanup: `agent-browser --session fleet-<n> close` when its chunk is done.
3. **Collect and report.** Agents return per target outcomes (submitted, blocked, captcha, data). Summarize wins, failures, and anything needing the user (captchas and logins bail, never guess credentials).

## Guardrails

- **State changing submissions stay gated.** Any submission that creates records or sends messages on someone else's system is an outward action: show the user the payloads and the target list, and get an affirmative yes before the fleet fires. Without that approval the fleet stays read only. Same rule as email sends.
- Cap at 5 concurrent sessions; each is a real headless browser.
- A hung session gets closed and retried individually (`agent-browser --session fleet-<n> close`). Escalate to `pkill -f agent-browser` only when the daemon itself is unresponsive, knowing it resets every session, not just the fleet.

## Proven Use Cases

- Outreach contact forms across a prospect list (the July digital play sends).
- Lodging availability sweeps across booking sites for `assist:plan-trip`.
- Parallel JS rendered scraping where `read` alone isn't enough.
