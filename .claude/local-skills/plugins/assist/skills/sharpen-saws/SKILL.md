---
name: sharpen-saws
description: Run the weekly sharpen audit that moves collaboration one small step toward Levels 7 and 8 of the agentic engineering hierarchy. Verify each unattended routine fired and was consumed, close or ticket every deferral, take one cut from the always loaded context, groom one flag, and append a one screen log entry to LEVELS.md. Use this skill whenever the user says "sharpen", "sharpen saws", asks to "sharpen our process", or explicitly starts a sharpen session. Paired with the weekly Sharpen Saws block on Wednesdays. The sharpener agent carries this method for background dispatch.
---

# Sharpen Assist

Move our collaboration one rung at a time toward Level 7 (background agents) and Level 8 (autonomous agent teams) as framed in [Bassi Eledath's 8 Levels of Agentic Engineering](https://www.bassimeledath.com/blog/levels-of-agentic-engineering). Each session is a weekly audit of the background work already running and the context that runs it. Small, logged, compounding.

The `sharpener` agent (`~/.claude/agents/sharpener.md`) runs Ground and Audit in the background and returns the routine table and the closure list; the main session hosts Close, Cut, and Groom in dialogue with Forni, and performs every write. Run the method inline only when the sharpener is unavailable or Forni wants to drive together.

## Before Every Invocation

1. Read [learned-rules.md](../../learned-rules.md) for any prior corrections about how Forni wants sharpen to run.
2. Read [LEVELS.md](../../../../../../Eudaimonia/LEVELS.md) (absolute path: `~/Eudaimonia/LEVELS.md`) to anchor on the current state table, the Background paragraph, and the last log entry.
3. Check this skill's directory for a local `learned-rules.md` and read it if present.
4. Dispatch the sharpener from the primary checkout; cut the session's worktree branch `YYYY-MM-DD-sharpen-saws` (one per repo touched) only after it returns, at the top of Close.

## Principles

- **Audit first, build never.** The session verifies, closes, cuts, and grooms. A build that the audit surfaces gets a Linear ticket and the cycle owns it; sharpen reads the ticket's state next week.
- **Tickets are read, not remembered.** A row with a ticket is a pointer; its state comes from `linear issue view` at Ground. Only rows with no ticket and no owner live in the Background paragraph, and none survives two entries without becoming a ticket or a retirement.
- **The measure is hand steps.** For each unattended routine, the number that matters is how many hand steps remain between its fire and the block that consumes it. Held hours never moved in five entries; hand steps do.
- **Every session cuts and grooms.** One bounded reduction of the always loaded context and one grooming flag, every week, anchor or not.
- **Evidence over theory.** Executions, scheduler entries, and mail are the sources; the board's own memory is not.
- **The board is on demand.** Scouts and a ranked board run only when the audit finds nothing to close or Forni sets a focus.

## The Method

Six phases. The sharpener owns Ground and Audit and drafts the Log; the main session hosts Close, Cut, and Groom with Forni, and performs every write, including Log and Codify.

### Phase 1: Ground

Anchor on LEVELS.md: the current state table, the Background paragraph, the last log entry's deferrals. Read the plugin and skill learned rules. For every ticketed pointer in the Background paragraph and the last entry, read its state and latest comment (`env -u LINEAR_API_KEY linear --workspace atelic issue view <key>`). Pull git on Eudy and homebase since the last log entry's date, the newest auto memory entries, and the always on load (`wc -lc` on GC, `~/CLAUDE.md`, `~/Eudaimonia/CLAUDE.md`, and the Eudaimonia `MEMORY.md`), set against the last entry's Load line. Honor a focus if the session was given one.

### Phase 2: Audit

One row per unattended routine (today: retro, recruiter, plumber; the roster lives in homebase `runners/`). Sources: `gcloud run jobs executions list --job <name> --project atelic --region us-central1`, `gcloud scheduler jobs list --project atelic --location us-central1`, the failed execution's log tail, and the runner mail in the consuming mailbox. Three columns:

- **Fired on schedule** (Y/N): the scheduler's last attempt matched an execution that started on time.
- **Consumed without a rerun** (Y/N): the block that reads the mail ran on the scheduled fire, with no hand rerun between.
- **Hand steps left**: the count between the fire and the block, and what they are.

A failed fire is a row, not an alarm: note whether the failure page mailed and whether the fix landed, and read the cost footer.

### Phase 3: Close

The main session, with Forni. Walk every deferral from the last entry and every Background row, one at a time, to one of three ends: **closed** (done, with the pointer), **ticketed** (a Linear ticket in the next cycle, no due date, one cognitive load label), or **retired** (with the reason). A ticketed row leaves the paragraph and becomes a pointer the next Ground reads. Cut the worktrees here, before the first write.

### Phase 4: Cut

One bounded reduction of the always loaded context, every session. A section that only matters when a particular file is being edited moves into a path scoped rule (`.claude/rules/<topic>.md` with `paths:` frontmatter), a narrative moves into its tool doc under `~/Eudaimonia/Admin/Tools/`, or a derivable inventory is deleted. Measure before and after; when the file is one homebase owns, lower its cap in `bin/lint/context-size`. The 200 line anchor decides whether a larger rule or tool doc move is due; it never excuses the cut. One cut, never a restructure; a restructure is `assist:groom-context`.

### Phase 5: Groom

The weekly slice of `assist:groom-context`, never a second procedure. Run `/skill-doctor` (headless: `claude -p "/skill-doctor"`) and read `/cost` for the cache hit rate; take one grooming flag from the last entry through groom-context's checklist (a contradiction, a cull, a dedup, a relocation), and carry the rest. Turning a skill off waits for Forni's yes.

### Phase 6: Log

Resume the sharpener with the outcomes; it drafts the entry and returns it. The main session reviews and appends it to `~/Eudaimonia/LEVELS.md` under `## Log`, one screen:

```markdown
### YYYY-MM-DD: [one line title]

**Routines:** retro Y/Y/0 · recruiter Y/N/1 · plumber N/N/2 (fired on schedule / consumed without a rerun / hand steps), with one clause per row that changed
**Closed:** [each deferral with its end: closed, ticketed KEY, or retired with the reason]
**Cut:** [file, before and after bytes, cap]
**Groomed:** [the flag taken and the flags carried; skill doctor and cache findings in one line]
**Built:** [at most ten lines, each with a ticket or PR pointer; the build story lives there]
**Background:** [unticketed rows only, each with its first date; none survives two entries]
**Load:** [GC, ~/CLAUDE.md, Eudy CLAUDE.md, MEMORY.md as lines and KB]
**Next:** [one line]
```

If the session altered the Current State table (a dimension's level or evidence genuinely changed), update it in the same commit. Be honest: a single session rarely moves a level.

### Board, On Demand

When the audit finds nothing to close, or Forni sets a focus, the sharpener dispatches its two scouts (socrates on the method and the framing, claude-code-guide on unused harness capabilities) and returns a ranked board of three to five rows: the move, the level it pushes, the smallest rep, the evidence pointer, session or plan sized. The main session surfaces the top one or two in Forni's voice and asks one question. A picked row that is bigger than the session gets a ticket, and the entry's Built line points at it.

### Codify

If the session surfaced a rule, preference, or insight worth preserving: a cross skill correction goes to `~/.claude/local-skills/plugins/assist/learned-rules.md`, a sharpen specific rule to this skill's `learned-rules.md`, a broader Eudaimonia convention through `assist:codify-context`.

## Output Shape

A sharpen session produces the routine table, the closure list, one cut with before and after numbers, one groomed flag, a one screen log entry in LEVELS.md, and any learned rules. If it starts to feel like an essay, it is too long.

## Anti-patterns

- **Do not** build inside the session. Ticket it.
- **Do not** carry a row on a counter. Ticket it or retire it.
- **Do not** narrate the ticket cycle's builds in the log. Point at them.
- **Do not** restate the full LEVELS.md table in the session output.
- **Do not** skip the log entry. The compounding value is in the running record.
- **Do not** sharpen and also do unrelated work in the same turn. Sharpen is its own session.

## Learned Rules

See [learned-rules.md](learned-rules.md).
