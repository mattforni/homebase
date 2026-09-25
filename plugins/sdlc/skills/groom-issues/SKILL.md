---
name: groom-issues
description: Groom a Linear team's queue. Two modes, cycle grooming (when the team runs Linear cycles, trim the active cycle to a realistic slate) and backlog grooming (when the team has a backlog without active cycles, triage by priority, staleness, and intent). Use whenever the user mentions Linear grooming, triaging issues, pruning a backlog, sprint grooming, "the cycle is overstuffed", "let's clean up the queue", "groom the backlog", or wants to make decisions across many issues at once. All Linear access goes through the `linear` CLI.
allowed-tools:
  - Bash(linear *)
  - Bash(git *)
  - AskUserQuestion
  - Read
  - Grep
---

# Groom Issues

Keep a Linear team's queue honest. Two modes; same workflow shape: scope, partition, present, apply.

Adapted from `zero:linear-groom` (cycle mode) with backlog mode added for teams that do not run cycles.

## When to Use

Trigger on:

- The cycle is "overstuffed", "bloated", "needs trimming", or scope drifted from plan
- The backlog has accumulated and needs triage ("groom the backlog", "prune the queue")
- "Sprint grooming" (Linear calls them cycles, same concept)
- Mid cycle review when remaining days do not match remaining work
- Quarterly or stand still backlog cleanup
- The user says "groom Linear", "triage the queue", "clean up Linear"

Do NOT use for:

- Single ticket CRUD (create, comment, status update). Use `linear-lifecycle:linear-lifecycle`.
- Cross team structural work (initiatives, projects spanning quarters). Use a roadmap doc.

## Modes

The skill auto detects mode from the team's state. The user may force a mode by saying "groom the backlog" (forces backlog mode) or "groom the cycle" (forces cycle mode).

### Cycle Mode

The team has an active cycle with issues in it. Goal: trim/keep/move/reprioritize to a realistic slate for the remaining days. Mostly lifted from `zero:linear-groom`.

### Backlog Mode

No active cycle, just a backlog (potentially with hundreds of issues). Goal: triage by priority, staleness, label, and user intent. The skill clusters issues by label or theme and walks them with the user.

**This mode is a draft.** The first real backlog groom (Atelic team, 2026-05) will surface concrete heuristics that turn into hard rules. After that run, this section gets calibrated and the loose edges become learned rules.

## Prerequisites

- **Linear access.** The `linear` CLI, and only the CLI (`linear --version` ≥ 2.0.0, `linear issue mine` succeeds). The Linear MCP connector was retired 2026-08-12; there is no MCP fallback. If the CLI is missing or not authenticated for the target workspace, stop and say so rather than reaching for another path. Install with `brew install schpet/tap/linear`, authenticate with `linear auth login`, and see `~/Eudaimonia/Admin/Tools/linear.md` for workspace slugs and gotchas.
- **Team key.** The user names the team. The skill resolves to the Linear team ID. If unclear, ask.
- **Optional roadmap or vision doc.** Pointer to a markdown file describing strategic focus. The skill reads it for guidance and falls back to user judgment when absent.

## Source of Truth

Hierarchy. Fall through if the prior is absent:

1. **Active cycle plan** in a roadmap doc (cycle mode only).
2. **Project descriptions** in Linear (pillar matching, see conventions.md).
3. **Issue priority + staleness + label** (heuristic baseline, primary signal in backlog mode).
4. **User judgment** via AskUserQuestion. The gray zone is where this skill earns its keep.

## Core Loop

### Cycle Mode

1. **Scope** the active and next cycle. Capture cycle number, date range, business days remaining, and issue count (open / done / total).
2. **Sync** roadmap terminology to Linear's taxonomy (Initiative → Project → Issue + Cycle) before partitioning. If the doc collapses layers, fix the doc first as a one shot commit, then proceed.
3. **Read** the cycle plan from the roadmap doc (if present) and project descriptions for pillars.
4. **List** open issues in the active cycle.
5. **Partition** into Keep / Move / Backlog / Reprioritize / Cancel buckets per [conventions.md](reference/conventions.md).
6. **Present** the diff as a table grouped by action. Auto process only the Keep bucket.
7. **Resolve ambiguity** in a Phase 2 pass, grouped by category. Use AskUserQuestion per ticket in the gray zone.
8. **Apply** via the CLI after approval.
9. **Audit** every kept ticket for project + label attribution.

### Backlog Mode

Calibrated against the Atelic 2026-05-10 run (118 backlog items, solo, no roadmap doc).

1. **Scope** the backlog. Total count, distribution by status, priority, label, last-updated date. Use the CLI `linear issue query --state backlog --json --limit 250` piped to a file; on large teams the output may exceed inline token limits.
2. **Identify the team's deferral label** (e.g., `👋 Later`). Detection heuristic: a single non-priority label appearing on 30 percent or more of older Backlog items. This label is sacred; items carrying it are working as designed. See [conventions.md](reference/conventions.md).
3. **Surface stale sweep candidates** that do NOT carry the deferral label, have no priority, and have not been updated in 9+ months. These are the truly orphaned items.
4. **Cluster the rest by topic** (Pantry, Meal Planning, Recipes, Strava, Auth, etc.) using title-keyword grep. Topic clustering surfaces real signal in solo backlogs where labels are mostly the deferral label.
5. **Ask the meta-question first.** Before walking each cluster, ask: what is the policy on the deferral label? "Universal walk-past" is the most common answer and shrinks the decision space dramatically (Atelic: 118 items down to 46).
6. **Verify shipped work against the actual code** for any cluster of implementation tickets that look stale (e.g., the feature is described as working in CLAUDE.md but tickets remain Backlog). Decide: mark Done, or demote to Low for follow-up.
7. **Cluster batch decisions** via AskUserQuestion (up to four batched questions per round). Each option includes a label and one-sentence rationale. Common cluster outcomes: keep parked, demote to Low, cancel cluster, pull subset into next cycle.
8. **Walk the gray zone individually** with per-ticket AskUserQuestion. Reserve batch tables for structurally uniform clusters; the gray zone is where the skill earns its keep.
9. **Apply via CLI.** Hard deletes: `linear issue delete <ID> --confirm`. Loop singles, never `--bulk`.
10. **Verify** the new priority distribution via `linear issue query --state backlog | jq '.nodes | group_by(.priorityLabel)'`. The High items should now read as actual shipping work.

The Done archive is a separate pass. Linear's archive is UI-only as of CLI v2.0.0; multi-select Status=Done in the UI and bulk archive.

## Hard Rules

- **Scheduling rules are not defined here.** `~/Eudaimonia/Admin/Tools/linear.md` (Scheduling) is the canonical source for cycles, due dates, and what counts as triaged. Read it rather than trusting a copy, and do not restate its rules in this skill.
- **Untriaged is always a Decision, never a silent Keep.** An issue counts as triaged only when it carries every field named in `~/Eudaimonia/Admin/Tools/linear.md` (Scheduling, What Counts as Triaged). Read the definition there rather than from memory; missing any one field makes an issue untriaged no matter what its state says. A due date falling outside its issue's cycle is drift to flag.
- **The cycle equals the week (cycle mode).** An active cycle should contain exactly the work intended for that week. Anything unfittable or unowned goes to Backlog so the board stays readable. Two drifts break this quietly; see learned-rules.md.
- **Non destructive by default.** Prefer move, reprioritize, or backlog over cancel/delete. Never silently destroy.
- **Diff before apply.** Always present the proposed slate as a table and wait for explicit approval. Auto apply is reserved for the Keep bucket (which by definition changes nothing).
- **Preserve history.** Touch only `cycle`, `priority`, `state`, `project`, `parent`, `labels`, `estimate`. Never set a due date. Do not edit descriptions, titles, comments, or assignees unless explicitly asked.
- **One team at a time.** Default scope is whatever the user names. Do not silently widen.
- **Capacity check (cycle mode).** Keep bucket must fit `business_days × active_owners × multiplier` (start at 0.9, calibrate). If over, push back before approving.
- **Walk the gray zone individually.** Per ticket AskUserQuestion with three to four labeled options. Reserve batch tables for the auto keep cluster and structurally uniform clusters.
- **Explain every move.** Each proposed change gets a one line rationale. "Move, owner on vacation" beats "Move".

## Quick Reference

### Linear CLI

| Operation | Command |
|---|---|
| List cycles for team | `linear cycle list --team $LINEAR_TEAM` |
| View cycle details | `linear cycle view <cycleRef>` |
| List open in active cycle | `linear issue query --team $LINEAR_TEAM --cycle active --state unstarted --state started --json` |
| List backlog | `linear issue query --team $LINEAR_TEAM --state backlog --json --limit 250` |
| Move issue to cycle N | `linear issue update <ID> --cycle <N>` |
| Return to backlog | `linear issue update <ID> --state Backlog` (auto clears cycle) |
| Reprioritize | `linear issue update <ID> --priority <1-4>` |
| Cancel | `linear issue update <ID> --state Canceled` |
| Hard delete | `linear issue delete <ID> --confirm` |
| View a single issue | `linear issue view <ID>` |

Priority integers: 1 = Urgent, 2 = High, 3 = Normal, 4 = Low.

**State and cycle interaction.** Setting `--state Backlog` clears the ticket's `cycleId` automatically. Setting `--state Canceled` keeps the `cycleId` but flips `statusType` to canceled, dropping the ticket from active views.

**Bulk delete gotcha.** `linear issue delete --bulk <ids> --confirm` still prompts interactively in CLI v2.0.0. Loop single deletes. Bulk also pulls in child issues automatically.

## Conventions

See [reference/conventions.md](reference/conventions.md) for classification heuristics, capacity math, and priority normalization. Backlog mode rules calibrated against the Atelic 2026-05-10 run.

## Walkthroughs

See [reference/examples.md](reference/examples.md) for step-by-step flows: backlog walkthrough (the most common case for solo/small-team projects without active cycles), and the three cycle-mode walkthroughs (mid-cycle, end-of-cycle, start-of-cycle).

## Learned Rules

Real grooming runs surface gotchas, calibration numbers, and edge cases the generic rules miss. Those land in [learned-rules.md](learned-rules.md). Read that file before each groom; a learned rule overrides the generic guidance when they conflict.
