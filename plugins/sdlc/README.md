# SDLC Plugin

Software development lifecycle skills for planning, designing, implementing, reviewing, and completing work.

## Quick Start

```bash
claude plugin marketplace add mattforni/homebase
claude plugin install sdlc@skillset
```

## Skills

| Skill | Description |
|-------|-------------|
| `/sdlc:plan` | Refine requirements on a Linear ticket through Socratic dialogue |
| `/sdlc:design` | Start work on an issue with branch setup and implementation design |
| `/sdlc:review` | Create PR and request code review |
| `/sdlc:land` | Drive the back half autonomously: open PR, iterate with bot reviewer, merge, clean up |

## Workflow

```text
/sdlc:plan <issue-id> → /sdlc:design <issue-id> → [implement] → /sdlc:land
```

`sdlc:land` is the default next step after implementation. It wraps `sdlc:review` → `review/run` → poll → (address findings)* → merge → clean up and bails to the user on anything ambiguous (human review, hard CI failure, merge conflict, time budget exceeded). The review rules live in [reference/code-review.md](reference/code-review.md).

## Full Documentation

See [docs/plugins/sdlc.md](../../docs/plugins/sdlc.md) for detailed usage, configuration options, and skill documentation.
