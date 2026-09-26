---
name: triage-inbox
description: Triage the Gmail inbox to a settled state. Classify every email, draft a reply for anything needing a response, and turn action-without-response into a Todoist follow-up, then review and execute one email at a time. Handles unsubscribes, recurring-sender filters, and per-sender side actions inline as they come up. Use whenever the user mentions email triage, inbox cleanup, processing the inbox, clearing email, or getting to inbox zero.
argument-hint: ""
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - AskUserQuestion
  - WebFetch
---

# Triage Inbox

Get the Gmail inbox to a settled state. Every email gets exactly one decision, then leaves the inbox. Anything that needs a response gets a drafted reply; anything that needs action but no response becomes a Todoist follow-up; everything else is filed or deleted. The inbox is never a to-do list.

The work runs in two passes. **First a silent prep pass**: scan and classify every email, and prepare its artifact (a draft reply, a follow-up task, or a filing decision). **Then a review pass**: walk the prepared queue one at a time for approval, and execute each decision on the user's call. Prep is batched; every mutating action (send, label, star, archive, create task) is the user's, one email at a time. This one-at-a-time discipline is load-bearing (see the governing rule in learned-rules.md); never present a consolidated bulk plan or batch-approve.

## The Verb Model

Assign each email one verb. This is the entire decision tree.

| Verb | When | Action |
|------|------|--------|
| **Delete** | Noise, no future value | Unsubscribe (if a marketing list) then trash; a bare promo defaults to trash, not archive |
| **Archive** | No action, may want later | Label to the most specific sublabel, archive, no star |
| **Do** | A reply that truly takes under 2 minutes | Draft the reply for approval, send on approval, then label + archive |
| **Wait** | Ball is in someone else's court | Green star, keep in inbox to track |
| **Defer** | Action on us, more than 2 minutes | Create a Todoist follow-up, yellow star (red if overdue), then keep or archive |

Most inbox mail is Delete or Archive; lean toward getting things out. Stars encode who has the ball (green = them, yellow/red = us) per the governing star rule.

## Setup

**Name the mailbox before the first call.** Forni has two: personal
(`mattforni@gmail.com`, gws profile `personal`) and Atelic (`matt@atelic.me`,
gws profile `atelic`). A triage run covers both unless he scopes it to one, and
each is a separate working batch with its own labels, its own star state, and
its own task destination (Todoist for personal, Linear for Atelic). Every `gws`
call below must carry an explicit `GWS_FORCE_PROFILE=<profile>` prefix; without
one, gws resolves the profile from the working directory and will silently read
whichever mailbox that happens to point at. An inbox that comes back empty, or
that returns identical threads for both profiles, is that bug rather than a
clean inbox. Prefer dispatching the `clerk` agent, which does both mailboxes;
the steps below are the manual fallback.

1. Read this skill's local [learned-rules.md](learned-rules.md), then the plugin-wide [learned-rules.md](../../learned-rules.md) and [email-rules.md](../../reference/email-rules.md) (corrections override everything below), then [triage-rules.md](../../reference/triage-rules.md) and [label-map.md](../../reference/label-map.md) for classification and routing.
2. Resolve label name to ID mapping (needed for every modify call):

   ```bash
   GWS_FORCE_PROFILE=<profile> gws gmail users labels list --params '{"userId":"me"}' --format json 2>&1 | grep -v "^Using"
   ```

3. Pull the authoritative inbox:

   ```bash
   GWS_FORCE_PROFILE=<profile> gws gmail users messages list --params '{"userId":"me","q":"in:inbox","maxResults":50}' --format json 2>&1 | grep -v "^Using"
   ```

   Snapshot this set as the working batch. Triage that batch; mail that arrives mid-session (including the one-time-code and verification mail your own portal activity generates while you work) is a separate next batch, not chased now.

## Phase 1: Scan and Classify (silent prep)

For each message, fetch headers and classify. **Scan, do not deep-read.** Read the full body only when a verb depends on it (family mail, an ambiguous request, anything you intend to reply to).

```bash
# Headers for classification
gws gmail users messages get --params '{"userId":"me","id":"<ID>","format":"metadata","metadataHeaders":["From","Subject","Date","List-Unsubscribe"]}' --format json 2>&1 | grep -v "^Using"
# Full body when a verb depends on it. Do NOT use `gws gmail +read` (it returns only the subject).
# The `snippet` field is the fastest gist; for full text decode the base64 text/plain part.
# For HTML-only mail, strip <style>/<script> before stripping tags, or just read the snippet.
gws gmail users messages get --params '{"userId":"me","id":"<ID>","format":"full"}' --format json 2>&1 | grep -v "^Using"
```

Cross-reference each sender/subject against triage-rules.md and email-rules.md, assign a verb, and prepare the artifact:

- **Needs a quick response** → compose the reply now so it is ready for the review pass. Check the clock (`date`) before any time-of-day greeting. Draft, never auto-send, when the recipient is a person. Family replies get no sign-off.
- **Needs a substantive or high-stakes response** (BD, negotiation, pricing, anything sensitive) → do not dash off an inline draft. Park it (yellow star, right label, keep in inbox) and hand to a focused drafting pass after triage. The Do verb is for quick replies only.
- **Needs action, no response** → read the body for any deadline, then prepare a Todoist follow-up (see Follow-ups below).
- **Reference or noise** → note the target label and disposition. Unsubscribe is orthogonal to disposition and is only sent when the user wants off that list (or a sender rule requires it), never as a default for wanted senders: a pure marketing promo is unsubscribe + trash; a list the user wants off but wants this message kept is unsubscribe + label + archive; a wanted sender is just label + archive (no unsubscribe); a receipt (even one titled "Thank you!") is label to Purchases + archive.
- **Waiting on someone** → note a green star, keep in inbox.
- **Already triaged** (has user labels/stars from a prior pass, still in inbox) → set aside; do not re-process. But another message **in this same snapshot** may resolve a prior item (an appointment completed, a reply received, a filing confirmed); surface those during review and close them (clear the star, archive). A genuinely new post-snapshot arrival is not a closure trigger; it stays in the next batch. Recap the rest at the end.

As they surface, also note two inline side actions to raise during review: a sender appearing 3+ times that is worth a **filter**, and any sender with a **Calendar** side action in email-rules.md. If there is something to update, do it during review; if not, skip it.

Do not act or present a bulk plan in this phase. Prep only.

## Phase 2: Review One at a Time

**Family first**, then everything else. Present each email individually via AskUserQuestion showing: sender, subject, a one-line "what it is," the proposed verb, and the prepared artifact (the draft reply text, the follow-up task, or the label + disposition). The user approves, modifies, or skips. Execute on their call, then move to the next.

- **When in doubt, ask.** If classification is ambiguous or an email could take multiple labels, ask rather than guess. Route to the most specific sublabel; an email can take more than one (an Anthropic receipt is Purchases + Development).
- **Sending replies**: only send to a person after explicit approval. Direct send is fine for automations, lists, and unsubscribe addresses. Never reference people or sources the user does not know.
- **Scheduling**: if an email proposes a date/time, check the calendar; if it works, offer to accept and send an invite; if not, propose an alternative (prefer Fridays for in-person). Default to sharing the Reclaim link rather than proposing slots.
- **Corrections**: when the user overrides a classification, append the rule to [email-rules.md](../../reference/email-rules.md) (routing) or the plugin-wide [learned-rules.md](../../learned-rules.md) (behavior) under the right section with enough context to reuse.

Execute label/star/archive changes with `modify` (pass the full star set in `removeLabelIds` when archiving, per the governing star rule):

```bash
# Archiving strips the full star set (STARRED plus the colored-star system labels), per the governing star rule.
gws gmail users messages modify --params '{"userId":"me","id":"<ID>"}' --json '{"addLabelIds":["<LABEL_ID>"],"removeLabelIds":["INBOX","UNREAD","STARRED","YELLOW_STAR","GREEN_STAR","RED_STAR"]}' 2>&1 | grep -v "^Using"
```

`modify` and `batchModify` return an empty body, so a `grep`/parse pipeline exits non-zero even on success. Do not read that as failure; confirm with a follow-up `messages get` (`format=minimal`).

### Replies

Draft and send threaded replies with the `+reply` helper (it sets In-Reply-To / References / threadId and quotes the original). Never hand-roll base64 RFC2822.

```bash
gws gmail +reply --message-id <ID> --draft --body "<text>"   # save a draft for review (default for a person)
gws gmail +reply --message-id <ID> --body "<text>"           # send (only after explicit approval for a person)
```

### Follow-ups (Todoist)

For every Defer email, create a task (conventions in `~/Eudaimonia/Admin/Tools/todoist.md`): short Title Case title with an emoji prefix and the Gmail link, details in a comment, due the **next Sunday** as a bare date (date-only, never timed), omit `projectId` to land in the inbox. Do the actual work in the review pass on approval, not during prep. **Exception**: an item already past its deadline goes on a task due **today**, not the next Sunday, and takes a red star.

### Unsubscribe

For a Delete-by-unsubscribe: read the `List-Unsubscribe` header (already fetched in Phase 1). If it has a `mailto:`, send to that address **using the exact `?subject=` value encoded in the mailto** (Klaviyo and other one-click lists reject a generic "Unsubscribe" subject; URL-decode it first). If only a URL, hand it to the user to visit; if neither, say so. Then apply the disposition (trash for a bare promo, or label + archive for a wanted sender).

```bash
# Extract the mailto address and its encoded subject from List-Unsubscribe; URL-decode the subject; then:
gws gmail +send --to "<unsubscribe-address>" --subject "<decoded-encoded-subject>" --body "Unsubscribe" 2>&1 | grep -v "^Using"
```

### Filters

For a recurring sender worth a filter, propose it during review; on approval, create it and record it under `## Created Filters` in email-rules.md to prevent duplicates. Default action: label, mark read, skip inbox.

```bash
gws gmail users settings filters create --params '{"userId":"me"}' --json '{"criteria":{"from":"<sender>"},"action":{"addLabelIds":["<LABEL_ID>"],"removeLabelIds":["INBOX"]}}' 2>&1 | grep -v "^Using"
```

### Side actions

Some senders route content elsewhere (patterns in email-rules.md). Complete a side action before archiving its email.

**Keeper documents** (policies, legal docs, statements worth retaining) get filed to Google Drive, not just labeled. The doc is often a portal/download link in the body, not an attachment, so follow the link (confirm it resolves to the file, e.g. `application/pdf`). Find the matching project folder, read its existing filenames to learn the naming schema (e.g. `YYYY-MM-DD - NN - Description`), then upload with that schema, verify, and archive the email:

```bash
gws drive files list --params '{"q":"'\''<FOLDER_ID>'\'' in parents and trashed=false","fields":"files(name)","orderBy":"name"}' --format json 2>&1 | grep -v "^Using"  # learn the schema
gws drive +upload "<local-file>" --parent "<FOLDER_ID>" --name "<YYYY-MM-DD - NN - Description.ext>" 2>&1 | grep -v "^Using"
```

## Phase 3: Wrap

1. **Red-star digest**: list every email still carrying a red star (sender, subject, age, what it needs). This is the "respond to these" list.
2. **Recap**: counts by verb (deleted, archived, replied, deferred to Todoist, waiting), plus filters created, side actions done, and any already-triaged mail left in place.
3. **Learned rules**: confirm any corrections captured this session landed in email-rules.md (routing) or learned-rules.md (behavior).

## gws Notes

All Gmail work goes through the `gws` CLI via Bash. Every call prints `Using keyring backend: keyring` to stderr, so pipe through `2>&1 | grep -v "^Using"` before any JSON parse. Use `gws gmail users messages list` (not `+triage`) for the canonical inbox set.

## Learned Rules

See [learned-rules.md](learned-rules.md).
