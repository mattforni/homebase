---
name: codify-context
description: Codify knowledge from the current session into the right layer of the context architecture (GC, a repo CLAUDE.md, a path scoped rule, a skill's learned rules, a hook, a tool doc, or auto memory), routing by trigger and admitting to always loaded files only through the placement tests. Use this skill whenever the user says "codify" followed by a topic, wants to capture something they just figured out, asks to document a pattern or convention, or says something like "we should write this down" or "future me needs to know this." Also trigger when the user discovers a gotcha, foot gun, or non obvious behavior worth preserving. Named after the "plan, delegate, assess, codify" Level 4 compounding loop. This is the write in counterpart to `assist:groom-context`, which audits and prunes the same context architecture.
argument-hint: "<topic> [in <directory>]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - AskUserQuestion
---

# Codify Assist

Write one durable thing from the current session into the one place that owns it. A good codification often removes or moves a line rather than adding one; the architecture gets sharper, not longer.

## Placement Policy

The routing table and the three admission tests live in `~/.claude/rules/context-placement.md` (source: homebase `.claude/user-rules/`). It loads on its own whenever a context file is open; read it explicitly at the start of this skill anyway, because routing has to happen before any destination file is opened. GC's Context Architecture section is the one line pointer to it. The division of authorship is GC's Persistence section: human authored rules in repo files, Claude discovered learnings in auto memory.

## Before Every Invocation

1. Read this skill's local [learned-rules.md](learned-rules.md) for prior corrections about how Forni wants codification to run.
2. Read the plugin wide [learned-rules.md](../../learned-rules.md) for cross skill corrections.
3. Read `~/.claude/rules/context-placement.md`.
4. Identify the **topic** from the user's input or the current conversation.

## Workflow

### Step 1: Gather

Review the conversation for the durable thing. Name, in one line each: the rule, the incident that produced it (dated), and the correct approach. If the conversation does not carry enough, ask the user to fill the gap, one question at a time.

### Step 2: Search Before Writing

Grep every destination in Step 3 that could already hold the topic: the always loaded files (GC, `~/CLAUDE.md`, the repo's root CLAUDE.md), the output style, any path scoped rule or nested CLAUDE.md that covers the files involved, the hooks in `settings.json`, the relevant tool doc under `~/Eudaimonia/Admin/Tools/`, the relevant skill's `learned-rules.md`, and the auto memory index. Three outcomes:

- **Already stated.** Say where, and stop, unless the incident shows the existing line was dropped; then the fix is placement or enforcement (scope it, move it to the point of use, propose a hook), never a restatement.
- **Stated in conflict.** Two lines that cannot both be satisfied are the finding. Resolving the contradiction is the codification; adding a third statement is forbidden.
- **Absent.** Route it in Step 3.

### Step 3: Route

Apply the placement rule: name the trigger, read the destination off the routing table, and, only when the destination is an always loaded file, run the three admission tests and name the line the new one outranks. State the destination and the reason in one sentence before drafting. Destinations:

- **GC** (`~/.claude/CLAUDE.md`, homebase `.claude/CLAUDE.md`): how I work, everywhere, with no trigger. Lands as a homebase change and counts against the byte ratchet.
- **The output style** (homebase `.claude/output-styles/forni.md`): how responses to Forni read. GC keeps only what subagents, which never see the style, must also obey.
- **A repo's root CLAUDE.md**: that repo's facts every session there needs.
- **A nested directory**: the project directory pattern below.
- **A path scoped rule** (`.claude/rules/<topic>.md` with `paths:` frontmatter, project or user level): depth that matters only when a particular file is being edited.
- **A skill's `learned-rules.md`**: a correction to how a skill decides. Never learned rule content inside SKILL.md; every skill carries the separate file, and SKILL.md's own `## Learned Rules` section holds only the pointer to it.
- **A hook**: anything that must happen every time or must never happen. Propose the hook; writing `settings.json` is `update-config` work and needs its own yes.
- **A tool doc** (the tool's own doc, wherever the placement rule's table puts it: Eudy `Admin/Tools/` or the owning repo's `Tools/`): a tool's mechanics, gotchas, costs, and the reason we picked it, in the one pager shape of `Admin/Tools/CLAUDE.md`.
- **Auto memory**: a Claude discovered learning that need not survive a machine swap. Usually already saved by the time Forni says codify; check before duplicating.
- **Nowhere**: anything derivable from the code, git history, or the tool's own help.

### Step 4: Draft and Present

Draft the delta only, never the full file, and print it as the final text of the turn so it renders (see learned rules). Rule first, incident after, dated. For an always loaded destination, the delta includes the line being displaced or the reason nothing is.

**The project directory pattern** (a nested directory in Eudy or a repo): the directory's `README.md` holds the full account for humans, the what and the why with examples; the directory's `CLAUDE.md` holds the conventions for Claude in under 20 lines and points to the README; the root CLAUDE.md gets a one line pointer only when the directory is not already in its map, since a nested CLAUDE.md loads on its own the moment a file in that directory is read. Never duplicate across the three; each layer points to the next.

### Step 5: Write

After approval, write the destination from the session worktree, never a primary checkout. When the destination is a homebase file, land by the homebase heuristic (prose under 20 lines merges direct to main; anything executable or any plugin file goes by PR with the version bump). When it is an Eudy file, commit from the session worktree.

### Step 6: Confirm

Paths written, and anything removed or moved in the process. Keep it to a few lines.

## What Makes Good Codification

- **One place.** Pointer at the top layer, depth one hop down, never a third copy.
- **Skimmable.** A CLAUDE.md that takes more than 20 lines to state its conventions is too long; move the why to the README or a rule.
- **Examples beat abstractions.** Right way and wrong way side by side when the topic allows.
- **Dated.** The incident carries its date so a future reader can judge freshness, and the rule reads correctly with the incident deleted.
- **One emphasis per file at most.** Emphasize many lines and none stands out.

## Learned Rules

See [learned-rules.md](learned-rules.md).
