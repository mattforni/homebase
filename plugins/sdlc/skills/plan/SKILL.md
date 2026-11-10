---
name: plan
description: Refine requirements on a Linear ticket through Socratic dialogue. Acts as a product sparring partner that pushes back, surfaces hidden assumptions, and stays anchored on the user's pain before any implementation. Use this when the user wants to think through a problem, clarify requirements, or evaluate options before starting design work.
argument-hint: <issue-id>
allowed-tools:
  - Bash(linear *)
  - Bash(*get-linear-issue-id.sh*)
  - Read
  - Grep
  - Glob
  - AskUserQuestion
  - Skill
---

# Plan

Refining requirements for $ARGUMENTS through Socratic dialogue.

In all bash steps below, substitute placeholder names (like ISSUE_ID) with the actual values you stored earlier.

## Workflow

1. **Fetch issue details** from Linear
2. **Understand current state** of the ticket
3. **Engage in Socratic dialogue** to surface requirements and evaluate options
4. **Iteratively update the ticket** as clarity emerges
5. **Confirm readiness** for the design phase

## Step 1: Fetch Issue Details

Extract the Linear issue ID from the argument:

```bash
../../scripts/get-linear-issue-id.sh "$ARGUMENTS"
```

Store the output as ISSUE_ID. Fetch the full issue:

```bash
linear issue view ISSUE_ID
```

If the fetch fails, inform the user that the plan skill requires a valid Linear issue ID and stop.

## Step 2: Understand Current State

Display the issue title and description to the user. Note which sections of the plan template are already present and which are missing. A ticket written in the older shape (Overview, Requirements, Options, Recommendation, Open Questions, Notes) is not missing everything: map Overview to User Story, Requirements to Acceptance Criteria, Options, Recommendation, and Open Questions into Context, and Notes into Out of Scope, and never drop old content when rewriting the body.

Treat pre-baked Scope sections, vendor choices, or sibling-ticket references as **potentially disposable.** They may be load-bearing, or they may be agent-scaffolded ideas that have not yet earned their place. Plan as if you were building the ticket from scratch. Ask: "would I have arrived at this if I were planning from scratch?" If no, surface it for re-examination. Tickets can be cancelled outright. Planning is a real decision point, not an annotation pass.

**Plan template sections.** A ticket body has four sections, in this order, the same shape in any tracker (Forni's canonical statement is `~/Eudaimonia/Admin/Concepts/tickets.md`):

- **User Story:** one sentence naming who needs it, what they want, and why ("As a developer on X, I want ..., so that ..."). Infrastructure work still has a user: the developer or product owner who needs the confidence it buys.
- **Context:** the evidence behind the story, linking issues, PRs, and incidents instead of retelling them, and who reviews and why. While planning is open, Context also holds the **Options** (name, one sentence, trade offs for each viable approach), the **Recommendation**, and the **Open Questions** as checkboxes. Once a choice is made, the options collapse to the decision and its reasoning.
- **Acceptance Criteria:** a checkbox list, each item something a reviewer can verify, including the explicit failure conditions (what counts as not done even when the build works).
- **Out of Scope:** what the ticket deliberately leaves alone, so anything that does not land is named. Real threads that surfaced during planning but belong elsewhere go here too, one sentence each with a pointer to where they belong.

## Step 3: Socratic Dialogue

Begin asking questions to fill in the gaps. Your role is to be a curious, probing thought partner.

**Guiding principles:**

- **Ask one question at a time.** Give the user space to think.
- **Lead with the moment of friction.** The first question should anchor on the user's pain in a specific moment (standing at the stove, walking in from the store, opening the app at the airport), not on "what does the ticket say" or "what tech should we use." If you reach for a "how" question, redirect to a "why."
- **Be a sparring partner, not just a question-asker.** When multiple approaches exist, name them, weigh trade-offs, and state your recommendation: "My push: X because Y." Invite disagreement. Neutral enumeration forces the user to do all the thinking.
- **Distinguish infrastructure from magic.** Early in dialogue, ask whether the ticket is a feature the user reaches for, or data infrastructure for a feature they reach for. Infra tickets get their acceptance criteria from the downstream consumer, not from the apparent user touchpoint. Naming this changes the entire shape of the plan.
- **Challenge assumptions directly.** "What happens if we don't do this?", "What is the user choosing not to do instead?", and "Does this ticket survive scrutiny, or should it be cancelled?" are all valid questions.
- **Surface edge cases.** "What about when X?" helps catch gaps early.
- **Define failure explicitly.** Before Acceptance Criteria close, capture the conditions that mean "not done" even if the build technically works: the swallowed error, the missed edge case, the over engineered abstraction the goal never asked for. Agents silently cut corners exactly where failure is undefined; the explicit failure conditions in Acceptance Criteria are what prevent it. (Adopted from Greg's Prompt Contracts pattern, 2026-07-23.)
- **Read codebase files when needed** to ground the conversation in reality. Use Read, Grep, and Glob to explore relevant code.
- **Stay above the implementation line.** Vision vs OCR, sync vs async, vendor choices: these are implementation details. They have no meaning until the product picture (user pain, moment of friction, acceptance criteria) is clear. If you find yourself listing technical options before acceptance criteria are settled, you have drifted.

**When to move on from a section:**

- User Story: move on when you can name the user, the want, and the why in one sentence
- Context evidence: move on when the linked issues, PRs, or incidents are named and the reviewer and why are stated
- Acceptance Criteria: move on when the user agrees the list is complete and testable, and the explicit failure conditions are written down
- Context options and recommendation: only after the acceptance criteria are settled; move on when trade offs are clear, the user has a preference, and the reasoning is captured (omit both when only one approach is viable)
- Context open questions: move on when each is answered or explicitly deferred to design
- Out of Scope: move on when everything deliberately left alone is named, or when nothing was excluded and no side threads surfaced (write "Nothing excluded.")

## Step 4: Update the Ticket

As each section crystallizes through dialogue, update the Linear ticket body to reflect the current state. Build the description incrementally using the plan template structure.

```bash
linear issue update ISSUE_ID -d "UPDATED_DESCRIPTION"
```

Do not wait until the end to update. Update after each meaningful exchange so the ticket stays current. The user should be able to read the ticket at any point and see an accurate picture of where planning stands.

## Step 5: Confirm Readiness and Hand off to Design

When all sections are filled in and open questions are resolved (or explicitly deferred), summarize the final state of the ticket to the user.

Use AskUserQuestion to confirm:

- **Ready for design** — Planning is in good shape. Move into design now.
- **Keep refining** — There are still gaps to address. Stay in dialogue.

**On "Ready for design":** Acknowledge in one sentence that planning is complete, then **immediately invoke the `sdlc:design` skill** via the Skill tool with `ISSUE_ID` as the argument. Do not narrate "Next step: /sdlc:design" and stop — the user has already authorized the transition by selecting "Ready for design," and asking them to type the next command is redundant friction.

**On "Keep refining":** Return to Step 3 and continue the dialogue.
