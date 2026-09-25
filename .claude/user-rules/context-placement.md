---
paths:
  - "**/CLAUDE.md"
  - "**/CLAUDE.local.md"
  - "**/.claude/rules/**/*.md"
  - "**/learned-rules.md"
  - "**/SKILL.md"
  - "**/Admin/Tools/*.md"
  - "**/.claude/projects/*/memory/*.md"
---

# Placing a Rule in the Context Architecture

Loaded whenever a context file is open. GC's Context Architecture section is the one line version; this file is the test it points to. Anthropic's guidance is the anchor (<https://code.claude.com/docs/en/memory>, <https://code.claude.com/docs/en/best-practices>, <https://code.claude.com/docs/en/features-overview>); the evidence behind the emphasis on conflict lives in `~/Eudaimonia/Admin/Tools/claude-code.md`.

## Route by Trigger

Name the event that makes the rule needed. Where that event is detectable, the rule lives there.

| The thing | Where it goes |
|---|---|
| A fact every session needs, with no nameable trigger | GC for how I work; a repo's root CLAUDE.md for that repo's facts |
| A rule that matters only when a particular file or path is touched | `.claude/rules/<topic>.md` with `paths:` frontmatter, project or user level |
| A procedure, checklist, or multi step workflow | a skill; corrections to it in that skill's `learned-rules.md` |
| Something that must happen every time, or must never happen | a hook; prose is a request, a hook is a guarantee |
| A tool's mechanics, gotchas, or the reason we picked it (never its pricing) | the tool's own doc: `~/Eudaimonia/Admin/Tools/<tool>.md` when the tool spans the life, the owning repo's `Tools/<tool>.md` when it exists only for that repo (Atelic's HubSpot and Google instruments; the test is Atelic `Tools/CLAUDE.md`) |
| A learning Claude discovered that need not survive a machine swap | auto memory |
| Anything derivable from the code, git history, or the tool's own help | nowhere; delete it |

## Admission to an Always Loaded File

GC, `~/CLAUDE.md`, a repo root CLAUDE.md, and any rule without `paths:` load every session. Three tests, in order, before a line enters one.

1. **Trigger Test.** If the event above is nameable, the rule fails admission here and routes by the table. Only rules with no trigger are ambient.
2. **Admission Test.** Name two of the last twenty sessions that would have gone wrong without it, and name the line it outranks. No victim named, no admission. The file is at budget; entry is zero sum.
3. **Killer Item override.** A rare rule earns a line regardless when its failure is irreversible, silent, and tempting (the worktree gate, outbound sends, deploys). Prefer a hook even then; the line in prose is the fallback, not the enforcement.

## What Actually Costs Adherence

Conflict, not count. Two rules that cannot both be satisfied let Claude pick either arbitrarily, and the measured per rule cost of one more compatible rule is near zero at this scale. Before adding a line, grep every always loaded file for the same topic; resolve the contradiction or the duplicate instead of adding a third statement. The 200 line figure is Anthropic's target with no published measurement behind it; the byte ratchet in homebase `bin/lint/context-size` is the local enforcement.

## Shape

- Pointer at the top layer, depth one hop down, never a third copy.
- In an always loaded file or memory, rule first, incident after, dated, so a future prune can judge whether it still earns its place. In a tool doc, a CLAUDE.md, or any other reference file, state the rule alone; the incident is not worth the words there.
- A rule that keeps getting dropped gets scoped or enforced, not restated louder.
- One emphasized line per file at most. Emphasize many and none stands out.
- Block level HTML comments are stripped before injection, so maintainer notes cost nothing.
- Nested CLAUDE.md files and path scoped rules drop out of context after a compaction until a matching file is read again; anything that must survive compaction belongs in a root CLAUDE.md, an unscoped rule, or auto memory.
