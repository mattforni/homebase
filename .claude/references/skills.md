# Skill and Agent Authoring Conventions

Guidance for authoring and maintaining Claude Code skills and agents. Load when working on a SKILL.md, a learned-rules.md, an agent definition, or when invoking /skill-creator.

Entries here follow the context library's three tiers of fidelity: a short TLDR, how we use it, and a link out to the authoritative web docs. We hold only our delta (conventions, gotchas, the date last checked); the web owns the full spec. **When authoring a new surface type (agent, hook, MCP config, output style), check the linked official docs before building from house patterns**, and recheck when behavior seems harness version dependent.

## Naming

Skill names lead with a verb. Add an object when it sharpens the meaning (`plan-week`, `triage-email`); a bare verb is fine when it already reads unambiguously (`reflect`, `sharpen`, `wrap`). New skills follow this. Rename an existing skill only when its name actively misleads, not for conformity's sake.

**Agent names are one word role nouns.** A skill names the work (verb noun: `audit-prospect`, `plan-week`); an agent names the worker (`auditor`, `lander`, `socrates`, `runner`, `migrator`). The split keeps the two surfaces distinguishable at a glance: what is being done versus who is doing it. When a skill and its background agent counterpart coexist (the lead plugin's `audit-prospect` skill and `auditor` agent), the agent stays a thin dispatch contract whose first action is reading the skill for method, never a parallel reimplementation. Applies to user roster agents in `~/.claude/agents/` and plugin agents in `plugins/<plugin>/agents/` alike. Settled 2026-07-25 while creating `lead:auditor`.

**Plugin skill frontmatter names are bare.** The loader namespaces every plugin skill as `<plugin>:<name>`, so the `name:` field in SKILL.md must be the bare skill name (`triage-inbox`, `land`), never the namespaced form. Writing `assist:triage-inbox` there double namespaces the invocation surface into `assist:assist:triage-inbox`. Caught 2026-07-24 across all 18 assist and 8 sdlc skills; linear-lifecycle, whose name was bare, was unaffected.

## SKILL.md vs learned-rules.md

The two files have distinct jobs. Keeping them clean takes discipline.

**SKILL.md** is the durable spec. It holds stable skill behavior, workflow decisions that have crystallized, and durable user preferences unlikely to change (food dislikes, formatting conventions, routing rules like which store carries what).

**learned-rules.md** stays lightweight. It holds personal context tied to the current life shape: calendar interpretation, job specific defaults, current commitments. When life changes, these rules need updating; SKILL.md should not.

**Rule of thumb:** If a rule would need a "last confirmed" date stamp to avoid going stale, it belongs in learned-rules.md. If it's just how the skill works, it belongs in SKILL.md.

Periodically audit learned-rules.md. Graduate rules that have stabilized to SKILL.md, and prune rules that no longer apply.

## When to use learned-rules.md

Every skill that makes decisions on behalf of the user should include a `learned-rules.md` file. When the user corrects a decision, append the correction. Read learned rules at the start of every invocation. This applies to all skills, whether created via /skill-creator or manually.

## Agent Authoring

**TLDR (official docs, checked 2026-07-25).** An agent definition is a markdown file whose frontmatter needs only `name` and `description`; the body becomes the agent's entire system prompt, and subagents inherit no conversation history from the parent. The `description` drives automatic delegation, so name the trigger scenarios, not just the role. Useful optional fields: `tools` (an allowlist; least privilege is the documented gold standard, e.g. `Read, Grep, Glob` for analysis), `model` (default `inherit`), `skills` (preloads full skill content at agent startup), `memory` (cross session learning), and `color`. Plugin agents live in `plugins/<plugin>/agents/*.md`, dispatch as `<plugin>:<name>`, and ignore `hooks`, `mcpServers`, and `permissionMode` frontmatter. Rechecked 2026-08-13: subagents can spawn their own subagents (default depth 3), resuming a subagent retains its full context, and AskUserQuestion is stripped from every subagent, so human decisions always round trip through the main session between dispatches.

**How we use it.**

- Agents are one word role nouns; skills are verb noun (see Naming above). The skill names the work, the agent names the worker.
- A paired agent (one that backgrounds an existing skill's method) preloads the skill via the `skills` field, keeps a fallback "read the SKILL.md" instruction, and defers to the skill on any disagreement. It is a dispatch contract, never a parallel reimplementation.
- Default to a read only contract: the agent returns evidence, scores, and rows; the main session owns writes to tracked files and external systems.
- The harness agent registry requires single line frontmatter values: a multi line wrapped `description` fails the YAML parse silently, and the agent simply never registers while every single line agent does. Diagnosed 2026-08-09 on clerk.md (fixed in PR #161).
- Body sections follow the roster order: an opening division of labor paragraph naming who proposes, who picks, and who writes ("You propose; Forni corrects; you execute the corrected board when resumed"), then Where Truth Lives (or Method Source), a procedure section named for the work (The Loop, The Contract, The Method), Learned Rules when the agent has earned any, Boundaries, and an Output spec with a line cap. Mapped 2026-08-13 across the seven roster agents while authoring sharpener.
- The Where Truth Lives template: "The method is canonical in the skill, not here," followed by the precedence list of what to read, closing with "Learned rules override generic guidance when they conflict."
- Human gates come in three shapes; pick one deliberately. Proposal board with resume to execute (clerk: propose, Forni corrects, the same agent executes the corrected board because it holds the IDs), gate and yes (claimer: stop at each named gate, act past it only when resumed with an explicit yes), and bail to main (lander: enumerate the conditions that end autonomy and return).
- A paired skill points back: its description ends with "The <agent> agent carries this method for background dispatch" (report-unemployment precedent). The skill never orchestrates the agent step by step; the agent runs the method and the main session hosts the human gates.
- Every delegation brief carries four parts, per Anthropic's multi agent guidance: objective, output format, tool guidance, and explicit boundaries. Vague briefs produce duplicated and misrouted work.
- Fan out is earned, not default: an agent dispatches its own scouts only for capability or fresh eyes it lacks (socrates for critique of a process its author cannot see freshly, claude-code-guide for harness knowledge), never to delegate reading that one context holds fine. Cap the count in Boundaries; multi agent burns roughly 15x the tokens of a single context.
- Model per agent is a failure asymmetry call, not a cost call; the heuristic lives in `~/Eudaimonia/Admin/Tools/claude-code.md` (Models).
- Worked examples: `plugins/lead/agents/auditor.md` in the atelic repo, paired with the `audit-prospect` skill; `.claude/agents/sharpener.md` here, paired with `assist:sharpen-saws`.

**Where search before build looks.** Before writing a skill, check the official Claude Code plugins, then the [Agent Skills Directory](https://skills.sh) for a community skill that already covers it. Added 2026-09-26 from the retired Notion AI Research page.

**Link out.** Subagents: <https://code.claude.com/docs/en/sub-agents.md> · Plugins (agent layout and namespacing): <https://code.claude.com/docs/en/plugins.md>
