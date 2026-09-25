---
name: groom-context
description: Audit and redesign the context architecture (every CLAUDE.md, rules file, learned-rules.md, tool doc, and the auto memory index that loads into Claude Code sessions) so rules are stated once, never in contradiction, and enforced at the point of use rather than scattered, duplicated, or buried. Use this skill whenever Forni says "groom context", "groom-context", "we forgot a basic again", "the context is sprawling", "the rules keep getting lost", "clean up the context", or invokes "/assist:groom-context". Also invoked as a closing step by the monthly path of assist:reflect. This is the cleanup counterpart to assist:codify-context, which writes knowledge into the same architecture.
argument-hint: "[optional starting topic, e.g. 'code review' or 'a layer to start from']"
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - AskUserQuestion
  - Agent
---

# Groom Context

Keep the context architecture honest. The failure this skill exists to fix is **encoded but not applied**: a rule was written down somewhere, but it contradicted another rule, was duplicated, sat at the wrong altitude, or had no enforcement, so Claude dropped it anyway. The fix is not more documentation. It is **placement and enforcement over volume**, and the expensive defect to hunt is a contradiction, not a long file: two rules that cannot both be satisfied let Claude pick either one arbitrarily, while one more compatible line costs close to nothing at this scale.

## Before Every Invocation

1. Read this skill's [learned-rules.md](learned-rules.md) for accumulated corrections about how Forni wants grooming to run.
2. Read the plugin level [learned-rules.md](../../learned-rules.md) for cross skill corrections.
3. Read the placement rule at `~/.claude/rules/context-placement.md` (source: homebase `.claude/user-rules/`) and GC's **Context Architecture** section. Together they are the spec: which layer owns what, the routing table, and the admission tests. Audit everything against them, and if grooming changes the intended architecture, update the rule and the GC pointer as part of the pass.
4. Re verify Anthropic's current guidance (<https://code.claude.com/docs/en/memory> and <https://code.claude.com/docs/en/best-practices>), since the docs move. When the local spec and Anthropic's guidance disagree, surface the disagreement to Forni rather than silently preferring either.

## Principles

- **Conflict before length.** Resolve every contradiction first; trim for size last, and only to the ratchet.
- **Placement and enforcement beat volume.** A rule in the right place, enforced by the flow that needs it, beats three copies of it in always loaded prose.
- **Full pass every monthly run.** Audit the whole surface, not a slice; the Wednesday slice under The Weekly Slice below is the one exception. Culling shrinks the surface over time, so coverage gets cheaper, not more expensive.
- **Cull without sentiment.** Removing stale, derivable, and duplicated content is the point, not a side effect. When in doubt, propose the cull and let Forni veto.
- **Reorganize in layers.** Align the shape first (renames, creates, deletes, the authoritative homes), then move content into it.
- **Propose, then apply.** Present the full diff for approval before touching anything. Never silently edit context files.

## The Layers (The Grooming Surface)

- **GC** (`~/.claude/CLAUDE.md`, a symlink to homebase `.claude/CLAUDE.md`): how I work everywhere, plus pointers. Always loaded, byte capped by `bin/lint/context-size`.
- **`~/CLAUDE.md`** (homebase root, deployed): the rules every session under the home directory needs. Always loaded, byte capped.
- **The output style** (`.claude/output-styles/forni.md`): the response contract. Always loaded; subagents never see it, so anything they must also obey lives in GC.
- **Rules**: project scoped `.claude/rules/<topic>.md` in each repo, and user scoped `~/.claude/rules/`. A rule with `paths:` loads only when a matching file is read; a rule without `paths:` is always loaded and audited as such.
- **Eudaimonia CLAUDE.md chain**: root (always loaded when working in Eudy) and nested (`Craft/`, `Admin/`, pillar dirs), the nested ones loaded when files in that directory are read.
- **Repo CLAUDE.md chains**: per repo and nested, loaded when working in that repo.
- **Skill files**: `SKILL.md` and `learned-rules.md` per skill in the `assist` plugin (`.claude/local-skills/plugins/assist/skills/*`) and the `skillset` plugins (`sdlc`, `linear-lifecycle`). Loaded on invocation; the description alone sits in every session.
- **Hooks** (`~/.claude/hooks/`, wired in `.claude/settings.json`): the enforcement layer. Not prose, but every process gate in prose is measured against whether one of these could carry it instead.
- **Tool docs**: `~/Eudaimonia/Admin/Tools/<tool>.md`, plus a repo's own `Tools/` for a tool that exists only for that repo; reference loaded on relevance.
- **Auto memory**: every project's store under `~/.claude/projects/*/memory/`, each with its own `MEMORY.md` (first 200 lines or 25 KB load every session, the rest is silently dropped) plus topic files loaded on demand. A first class layer since 2026-07-04; groom it for staleness and for duplication against the repo file layers, but its existence is not a smell. Hold each index under 140 lines: move tool gotchas into the tool's doc, delete memories a repo file already states in full, then merge what is related (2026-09-25, ATE-576).

## Workflow

The audit produces proposed changes. It never edits silently.

### Step 1: Map (Fan Out)

Spawn parallel readers, roughly one per layer, using the Agent tool. Each reader returns the rules it found as a topic to location list plus any smells it noticed (a contradiction, a duplicate, a stale reference, a tool detail living outside its tool doc, a process gate with no enforcement, content derivable from the code). Aggregate into a single topic to location map so every place a rule is encoded is visible at once. Exclude worktree subtrees (see learned rules). If a starting topic was passed as an argument, lead with it, but still cover the whole surface. The `InstructionsLoaded` hook and `/context` show what actually loaded in a session when the map and the behavior disagree.

### Step 2: Reconcile Contradictions (The Highest Value Step)

For every topic that appears in more than one place, and for every pair of rules that a realistic session could not satisfy at once, name the collision, the situation that triggers it, and which rule Forni actually wants to win (dates and incidents decide). The fix is one authoritative statement and the deletion of the other, never a third line explaining how to reconcile them. Rank by how often the collision fires.

### Step 3: Cull

Propose removing what is not pulling its weight: rules naming files, flags, skills, or agents that no longer exist; one off notes that never recurred; guidance fully superseded by a hook or a flow skill step; anything derivable from the code, git history, or a tool's own help (`/doctor` proposes exactly these trims for a checked in CLAUDE.md and is a cheap first pass). Run `/skill-doctor` (headless: `claude -p "/skill-doctor" --output-format text`) for the skills: it lists every loaded skill with its context cost, seven day tokens, uses, and last use, so a skill that never fires, or one whose job an agent took over, is a cull candidate with numbers behind it. Read `/cost` for the prompt cache hit rate and the reason for the last miss; a cold cache on every turn is a context shape problem, not a size one. Verify a reference is dead before proposing its removal. Records are not rules (see learned rules).

### Step 4: Dedup

Find the same rule encoded in several places. Choose one authoritative home per the routing table, keep the canonical statement there, and replace the other copies with a one line cross reference at most. Pointer at the top layer, depth one hop down, never a third copy. Repetition across separately cloned repos can be deliberate; confirm the deployment context first.

### Step 5: Relocate by Trigger

Run each remaining rule through the placement rule. A rule with a nameable trigger moves to where the trigger is detectable: tool mechanics to the tool doc, path bound depth to a path scoped rule, a procedure to a skill, a skill correction to its learned rules, repo facts to that repo's CLAUDE.md. Only rules with no trigger stay in an always loaded file, and each one entering such a file passes the admission tests and names the line it displaces.

### Step 6: Enforcement Check

For each load bearing process gate, ask "what actually makes me follow this?" A prose line is a request. A step inside the relevant flow skill or a checklist item is stronger. A hook is the only guarantee. Recommend migrating enforcement to where the flow runs, and prefer a hook for anything irreversible, silent, and tempting. Example: review before merge is enforced inside `sdlc:land` and the lander, not by GC prose.

### Step 7: Size

Last, and only after the steps above. Measure the always loaded files (`wc -lc`) against the ratchet caps and Anthropic's 200 line target, and every project's `MEMORY.md` against the 140 line target. Recommend one bounded cut per file at most, and lower the cap in `bin/lint/context-size` when a homebase owned file shrinks so the reduction locks in. The 200 line figure is a target with no published measurement behind it; do not cut a compatible, load bearing line to reach it.

### Step 8: Present a Diff for Approval

Group the proposed changes by repo, since a pass spans Eudaimonia, homebase, and the gitignored nested repos, each landing by its own convention. Lead with the contradictions and enforcement migrations, then culls, dedups, and relocations, then size. Reorganize in layers (shape first, then content). Apply only after Forni signs off.

### Step 9: Commit

Land the changes per each repo's convention. The commit messages are the only record of the pass; there is no grooming log (cut 2026-07-04), so write messages that carry the intent.

## The Weekly Slice

The sharpen session's Groom phase (`assist:sharpen-saws`, Phase 5) runs one bounded slice of this checklist every Wednesday: skill doctor and the cache read, then one carried grooming flag taken through the step it belongs to (a contradiction, a cull, a dedup, a relocation). The full pass stays monthly through `assist:reflect`. Both read this file, so a step added here is picked up by both; there is no second grooming procedure. Adopted 2026-09-23.

## Output Shape

A compact report: the topic to location map (or the slice that had findings), then the proposal grouped as Contradictions / Cull / Dedup / Relocate / Enforce / Size, then the per repo change plan. Lead with the load bearing fixes, not the cosmetic ones.

## Anti Patterns

- **Do not** audit only a slice and call it done. Full pass, every monthly run; the weekly slice is the one exception, and it names the flag it took.
- **Do not** apply edits before presenting the diff.
- **Do not** trim for length while a contradiction stands.
- **Do not** add a new rule when the real fix is moving, merging, or enforcing an existing one. This skill removes and relocates more than it writes.
- **Do not** let this skill, or its own files, become the next source of sprawl. Keep it tight.

## Learned Rules

See [learned-rules.md](learned-rules.md).
