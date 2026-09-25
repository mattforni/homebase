# Codify Context Learned Rules

Corrections and calibration for how `assist:codify-context` should reason about where knowledge belongs and how it gets presented. Overrides SKILL.md. Read on every invocation.

- **Tool and CLI operational reference goes in the tool's own doc (placed per the placement rule), not GC, not a project CLAUDE.md.** The pull is to drop a tool gotcha into GC's section on that tool because that is where the related behavioral line lives. Resist: the trigger is nameable (the tool is in use), so the rule fails admission to GC and GC keeps at most its pointer. Codified 2026-05-21 after the gws attachment truncation gotcha almost landed in GC; restated on the trigger test 2026-09-03.

- **GC has one source of truth, homebase `.claude/CLAUDE.md`.** `~/.claude/CLAUDE.md` is a symlink to it, so an edit through either path hits the same file and the same homebase git history. The profile directories that once also linked to it retired 2026-08-12 (ATE-463).

- **Present deltas in the stream, as the final text of the turn.** Text preceding a tool call can render as a collapsed "Thought for Xs" marker in some views, and the AskUserQuestion dialog truncates content. Print the file by file deltas as the turn's last message, then let the user approve in plain chat. Never ask for approval in a message whose draft content lives only in mid turn text. Codified 2026-07-20 after three consecutive invisible draft rounds.
