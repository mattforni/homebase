---
name: sharpen-saws
description: Run the weekly sharpen session. Answer five questions about the AI setup (new tooling to adopt, context growth, corrections to recodify, repetition to automate, whether last week's fix held), pick one action, take one cut and one grooming flag, and append a one screen entry to LEVELS.md. Use when Forni says "sharpen" or "sharpen saws", or starts a sharpen session. The sharpener agent carries the audit for background dispatch.
---

# Sharpen Assist

Make the AI setup more effective, one action a week. The session asks how Forni's development cycles, skills, agents, routines, and context could work better and better use the tooling that exists, measured against [Bassi Eledath's 8 Levels of Agentic Engineering](https://www.bassimeledath.com/blog/levels-of-agentic-engineering) as a map, never as a destination. Small, logged, compounding.

The `sharpener` agent (`~/.claude/agents/sharpener.md`) runs Ground and Audit in the background and returns one page: the five answers and a ranked pick list. The main session hosts Pick, Cut, Groom, and Act in dialogue with Forni, and performs every write. Run the method inline only when the sharpener is unavailable or Forni wants to drive together.

## Before Every Invocation

1. Read [learned-rules.md](../../learned-rules.md) for any prior corrections about how Forni wants sharpen to run.
2. Read [LEVELS.md](../../../../../../Eudaimonia/LEVELS.md) (absolute path: `~/Eudaimonia/LEVELS.md`) to anchor on the current state table and the last log entry.
3. Check this skill's directory for a local `learned-rules.md` and read it if present.
4. Dispatch the sharpener from the primary checkout; cut the session's worktree branch `YYYY-MM-DD-sharpen-saws` (one per repo touched) only after it returns, at Pick, once Forni names the action and before the first write.

## The Five Questions

Every audit answers these, in this order. The answers are the session's whole input.

1. **Tooling.** Has anything shipped since the last entry (a Claude Code release, an official skill or plugin, a harness capability, a CLI) that already covers something the setup does by hand or home spun? Search before build.
2. **Context.** Is the always loaded context growing? The four files against the last Load line, and the skill doctor's per skill token counts.
3. **Cleanup.** What corrections did Forni make since the last entry, and how do they get recodified? Every correction is classed by what it indicts (handoff, harness, wrapper, browser, routine, other) and by whether a rule already states it. The fix for a class goes to the strongest seat that holds it: a hook, then a flow step, then the output style, then a rule. A memory promoted to a rule is struck once the rule lands.
4. **Repetition.** What did Forni or the session do by hand more than twice since the last entry that should become a skill, an agent, or a routine? Routines already built get one line here: any failure page mailed since the last entry, and whether the fix landed.
5. **Held.** Did the last entry's codification hold? Read whether its correction class recurred, by the same evidence the Cleanup question uses.

## Principles

- **One action per session.** The audit answers all five questions; the session acts on one. Spreading the hour across four small moves lands none.
- **Evidence over theory.** Corrections come from memory files newer than the last entry, the learned rules diff, and Forni's quotes in commit messages. Repetition comes from git and the session record. Tooling comes from the release notes and the docs, read fresh.
- **Audit first, build on the pick only.** A build the audit surfaces that is bigger than the session gets a Linear ticket and the cycle owns it; sharpen reads the ticket's state next week.
- **Tickets are read, not remembered.** A ticketed item is a pointer; its state comes from `linear issue view` at Ground. Nothing is carried on a counter.
- **Every session cuts and grooms.** One bounded reduction of the always loaded context and one grooming flag, every week, whatever the pick.

## The Method

Seven phases. The sharpener owns Ground and Audit and drafts the Log; the main session hosts Pick, Cut, Groom, and Act with Forni, and performs every write, including Log and Codify.

### Phase 1: Ground

Anchor on LEVELS.md: the current state table and the last log entry, especially its Picked and Next lines. Read the plugin and skill learned rules. For every ticketed pointer in the last entry, read its state and latest comment (`env -u LINEAR_API_KEY linear --workspace atelic issue view <key>`). Pull git on Eudy and homebase since the last entry's date, every auto memory file newer than that date, the learned rules diff across the assist and sdlc plugins, and the always on load (`wc -lc` on GC, `~/CLAUDE.md`, `~/Eudaimonia/CLAUDE.md`, and the Eudaimonia `MEMORY.md`) against the last entry's Load line. Honor a focus if the session was given one.

### Phase 2: Audit

Answer the five questions, one short section each, each ending in a recommended action. The Tooling question dispatches **claude-code-guide** every session, briefed with the current setup and asked for at most five capabilities not in use, ranked by friction removed, with the smallest rep for each. **socrates** is dispatched only when a correction class recurred after codification or Forni set a focus. Close with a pick list of at most three actions, ranked by evidence strength and then by smallest rep, each marked session sized or ticket sized.

### Phase 3: Pick

The main session gives Forni the five answers in the overview format the learned rules set (a table, a short paragraph on the top finding, and up to three picks in his voice), then asks one question: which action this session? The overview is the last text of its turn, and the question comes after he has read it. Any unticketed item in the last entry's Next line is closed, ticketed, or retired here, never carried. Cut the worktrees here, before the first write.

### Phase 4: Cut

One bounded reduction of the always loaded context, every session. A section that only matters when a particular file is being edited moves into a path scoped rule (`.claude/rules/<topic>.md` with `paths:` frontmatter), a narrative moves into its tool doc under `~/Eudaimonia/Admin/Tools/`, or a derivable inventory is deleted. Measure before and after; when the file is one homebase owns, lower its cap in `bin/lint/context-size`. One cut, never a restructure; a restructure is `assist:groom-context`.

### Phase 5: Groom

The weekly slice of `assist:groom-context`, never a second procedure. Run `/skill-doctor` (headless: `claude -p "/skill-doctor"`), then take one grooming flag from the last entry through groom-context's checklist (a contradiction, a cull, a dedup, a relocation), and carry the rest. Turning a skill off waits for Forni's yes.

### Phase 6: Act

The pick. Session sized, it lands in the session through the normal landing path for its repo; ticket sized, it becomes a Linear ticket in the next cycle with one cognitive load label and no due date, and the entry's Picked line points at it. A structural move (a new or reshaped agent, skill, hook, or workflow) gets a product level plan walked with Forni before any file is written.

### Phase 7: Log

Resume the sharpener with the outcomes; it drafts the entry and returns it. The main session reviews and appends it to `~/Eudaimonia/LEVELS.md` under `## Log`, one screen:

```markdown
### YYYY-MM-DD: [one line title]

**Tooling:** [what shipped and whether it was adopted, ticketed, or declined]
**Context:** [the cut: file, before and after bytes, cap]
**Cleanup:** [corrections since the last entry by class; what was codified, to which seat; what was struck]
**Repetition:** [the hand work found and where it went; routine failure pages, if any]
**Held:** [the last entry's codification, held or recurred, with the pointer]
**Picked:** [the one action, with its PR or ticket]
**Groomed:** [the flag taken and the flags carried; skill doctor in one line]
**Load:** [GC, ~/CLAUDE.md, Eudy CLAUDE.md, MEMORY.md as lines and KB]
**Next:** [one line; any item closed, ticketed, or retired at Pick is named here with its ticket or reason]
```

If the session altered the Current State table (a dimension's level or evidence genuinely changed), update it in the same commit. Be honest: a single session rarely moves a level.

### Codify

If the session surfaced a rule, preference, or insight worth preserving: a cross skill correction goes to `~/.claude/local-skills/plugins/assist/learned-rules.md`, a sharpen specific rule to this skill's `learned-rules.md`, a broader Eudaimonia convention through `assist:codify-context`.

## Output Shape

A sharpen session produces five short answers, one pick, one cut with before and after numbers, one groomed flag, a one screen log entry in LEVELS.md, and any learned rules. If it starts to feel like an essay, it is too long.

## Anti-patterns

- **Do not** make the audit about any one layer. The session that only verifies routines, or only trims context, has lost the plot.
- **Do not** build inside the session beyond the pick. Ticket it.
- **Do not** answer the Cleanup question with more prose. A correction that recurs moves up a seat.
- **Do not** restate the full LEVELS.md table in the session output.
- **Do not** skip the log entry. The compounding value is in the running record.
- **Do not** sharpen and also do unrelated work in the same turn. Sharpen is its own session.

## Learned Rules

See [learned-rules.md](learned-rules.md).
