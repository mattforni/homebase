# Learned Rules

Corrections and calibration for how groom-context should reason. Seeded from the GROW-316 session (2026-06-09), the real incident that motivated this skill. These are worked examples of "encoded but not applied," the exact failure the skill hunts for.

## Seed Cases (GROW-316, 2026-06-09)

- **Review before merge was encoded in GC but not enforced, so it was dropped.** GC's Code Review section already said bots re-review on every push and to triage each round, yet PRs were merged on green CI alone without waiting for the bot review. A process gate living in always-loaded prose is weak. **How to apply:** when you find a load-bearing process gate stated only in prose, the fix is to surface it at the point of use (the repo Workflow) and migrate enforcement into the flow skill that runs it (here, `sdlc:land`), not to restate it louder. This is the Step 6 enforcement check earning its keep.

- **"Use Monitor, not a foreground wait" was encoded in GC but ignored twice.** GC explicitly says use the Monitor tool for CI checks and deploy polling, never a foreground `gh run watch`. It was still violated. **How to apply:** an always-loaded rule that gets violated repeatedly is a salience or enforcement failure, not a wording problem. Flag such rules as candidates for enforcement (a hook or a flow-skill step) rather than leaving them as prose.

- **Gemini re-review needs an explicit `/gemini review` comment on later pushes.** It only auto-reviews when a PR opens, not on subsequent pushes. This was genuinely missing, now encoded in `public-web/CLAUDE.md`. **How to apply:** distinguish the two failure modes when you audit. Some forgotten basics are encoded-but-unenforced (migrate enforcement); some are genuinely absent (codify them, then place at the right altitude).

## Ground Truth Is Anthropic's Published Guidance (2026-07-04)

- **Audit against Anthropic's released best practices, not only the self authored spec.** Forni called out that the inaugural framework was entirely self referential and asked for the audit to be grounded in Anthropic's published guidance instead ("There are far more knowledgeable people informing those best practices"). Anchors as of 2026-09-03: CLAUDE.md holds facts every session needs, procedures go to skills, path bound depth to `paths:` scoped rules, anything that must happen every time to a hook; two contradicting rules let Claude pick one arbitrarily, so the periodic review is for removing outdated or conflicting instructions; the 200 line target is a target with no published measurement behind it, and only `MEMORY.md` (200 lines or 25 KB) has an enforced cutoff. **How to apply:** on each groom, re verify the current guidance (the docs moved to code.claude.com in 2026), and when the local spec and Anthropic's guidance conflict, surface the conflict to Forni rather than silently preferring either. Rebuilt 2026-09-03 (ATE-472): the placement test moved from a kind test to the trigger and admission tests in `~/.claude/rules/context-placement.md`, and contradiction outranks length in the audit order.
- **The memory ban is reversed.** The "codify, don't memorize" policy was removed from GC on 2026-07-04. The auto-memory store is a legitimate layer; groom it like any other (stale entries out, duplicates collapsed toward the human-authored rule), and migrate a live memory into a repo file only when it must survive a machine swap. Tool gotchas always must, since Forni works across machines, so they move to the tool's doc (2026-09-25).

## Operating Bias

- **The fix is usually placement or enforcement, not a new line.** When an incident reveals a forgotten basic, resist adding another prose rule. Ask first whether the rule already exists somewhere, and whether the real gap is altitude (wrong layer), salience (buried in a too-large file), or enforcement (no flow-skill step or hook makes it stick).

## Calibration (from the 2026-06-09 inaugural run)

- **Ignore worktree subtrees when mapping.** `.worktrees/` and `.claude/worktrees/` hold ephemeral checkout copies of CLAUDE.md files (on the first run, 67 of 85 zero CLAUDE.md files were worktree copies). They are not part of the architecture and regenerate on their own. Exclude them from the surface so the map reflects canonical files only.
- **Records are not rules.** Personal historical records (a completed home-purchase timeline, a finished trip) that only load in their own directory are not a salience problem and not "stale guidance." Do not cull them by default; they are history, not a misleading rule. Cull stale *guidance*, archive or leave stale *records*.
- **A doc can defensibly repeat a rule across separately-cloned repos.** "Never hard-code a username" living in both the Eudy-root and homebase-root CLAUDE.md is not duplication to collapse, because homebase clones standalone on machines without Eudy. Confirm a file's deployment context before treating repetition as dedup.

*(Populated further as Forni corrects groom-context's judgment over time. Calibrate how aggressive culling should be from his vetoes.)*
