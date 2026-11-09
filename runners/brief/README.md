# The Brief Runner

A Cloud Run Job (`brief`, project `atelic`, region `us-central1`) fired weekly by Cloud Scheduler. It pulls the closing ISO week from Strava, Gmail, and HubSpot and the week ahead from both inboxes, all three calendars, both YNAB budgets, the active Linear cycle, and Todoist; has headless Claude Code grade the retrospective and make the first pass of the Monday planning session as one JSON object; applies the rows it can when writes are on; renders it all into the branded email through the node renderer in [../email/](../email/); and sends it through Resend as `YYYY-Www Brief`, named for the week it plans, with the plan attached. Tracked as ATE-471 (the retrospective), ATE-674 (the planning pass) and ATE-675 (the brief made brief again, 2026-11-09); renamed from `retro` on 2026-10-19, when the planning pass joined the retrospective in the same mail.

The mail is two halves. Last Week is summaries: the movement scoreboard with takeout on it, the month so far against the pace with the delta in the table and the inflows under it, the tasks completed, then the sessions as a striped data table. This Week is What I Did (a ledger of the calls made, one count per source, with the big money rows, the tasks created, the work to place and the new rules those calls propose), What I Need From You (the decision rows alone, grouped by source and numbered within the group so a reply can say "Money 2"), and This Run. No headline, no read that restates the numbers under it, no date range, and no Atelic outreach: the Pipeline mail and HubSpot carry that.

The runtime one pager (why Cloud Run over Routines and launchd, the service account and its secrets, the traps) lives in Eudy at `Admin/Tools/cloud-run.md`. The planning session that reads the mail is the assist plugin's `plan-week` skill.

## What It Writes, and When

The runner fetches, the model reads and bands, and code applies. The posture is trust but verify (Forni, 2026-11-09): the model makes the call on every row it can make a plain read of, the runner or the Monday session applies it, and the mail counts it so a wrong call is one correction on Monday. Every row carries a band and a default: **high** when an exact codified rule names the payee or the sender and states the disposition, with the rule cited; **medium** when the read is plain but no exact rule covers it (a pizza place to Dining Out, a missing label, a plain task slotted); **decision** only when the action is irreversible (a delete, a trash, an unsubscribe), outbound (a reply), changes the shape of his day (two commitments on one hour, a block he placed by hand), or has no plain read (a bare bank descriptor, a transfer that needs a memo, an always confirm payee). High and medium rows are applied when `BRIEF_WRITE=1` in `job.json` and the run is not a dry run, on the two paths the runner has: a YNAB transaction approved at its category, and a Gmail message labeled and, when the rule says so, archived. The calendar, work and task rows have no apply path yet and are made in the Monday sitting from the attached plan. The scripts resolve every category and label name to an id through their own pulls and drop a row whose name does not resolve, so a misspelling is a line in the mail and never a guess in the books. Decision rows are the only rows that wait for Forni.

Writes turned on 2026-11-09 for both bands, after three weeks propose only. The one write the flag does not gate is the rotated Strava refresh token, written back to the vault as the retro always did. The job's environment follows `job.json` through `bin/runner/apply-job brief --apply`.

## Iterate Locally First

The loops and the promote step are in [../README.md](../README.md); the short version is `bin/runner/render-local brief` while changing how the email looks, `bin/runner/run-local brief --reuse` while changing what it says, and a merge to main once it is right, which builds the image and points the job at it on its own ([../README.md](../README.md#a-merge-to-main-is-the-promote)). `bin/runner/promote brief` is the same script, kept for a promote by hand.

```bash
bin/runner/fetch-env brief                 # once per machine
bin/runner/run-local brief --week 2026-W42 # renders to out/, sends nothing
PLANNING_PULLS=1 bin/runner/run-local brief --reuse   # retro files reused, planning pulls fresh
bin/runner/render-local brief              # instant re-render after a renderer edit
bin/runner/apply-job brief                 # how the live job differs from job.json; --apply to fix it
bin/runner/fire brief                      # run production now
```

`--reuse` reuses every pull on disk. `PLANNING_PULLS=1` beside it reuses the retro files (the ones that rotate a token and walk HubSpot) and pulls the planning half fresh, which is the loop for the pull scripts. The YNAB and Todoist tokens come from this machine's Keychain when `.env.local` lacks them (`runner_local_credentials` in `bin/runner/lib.sh`).

| File | Role |
|---|---|
| `Dockerfile` | `node:24-slim` plus curl, jq, tzdata, and a pinned Claude Code; runs as the non root `runner` user |
| `entrypoint.sh` | The pulls, the model call, the apply step, the merge, on the shared scaffold in `runners/lib/runner.sh` |
| `prompt.md` | The brief: the retro grading, the planning rules to read, the bands and what makes a row a decision, the new rules to propose, the JSON shape; `{{WEEK}}`, `{{NEXT_WEEK}}`, `{{MONDAY}}`, `{{SUNDAY}}`, `{{NEXT_MONDAY}}`, `{{NEXT_SUNDAY}}`, `{{TODAY}}`, `{{WORK}}`, `{{EUDY}}`, `{{HOMEBASE}}`, `{{ATELIC}}` are filled at run time |
| `ynab.mjs` | `pull` (accounts, categories, payees, the queue, three months of rows per budget), `week` (the typical against the pace, with the first of the month charges counted whole and the rest prorated, the delta, the inflows, outliers and trips, into `spend.json`), `apply` (approve the banded rows at their category) |
| `inbox.mjs` | `pull` (every inbox message in both mailboxes with its labels and a link, plus each label list), `apply` (label, mark read, archive) |
| `calendar.mjs` | `pull` the week ahead on the three calendars, normalized to Denver, with the lint (overlaps, missing flanks, unlabeled) in `calendar-lint.json` |
| `linear.mjs` | `pull` the active ATE cycle with the fields What Counts as Triaged grades |
| `todoist.mjs` | `pull` the Schedule filter, the landing Monday, and the tasks completed in the closed week |
| `job.json` | The Cloud Run job and the Cloud Scheduler entry, which `bin/runner/apply-job brief` makes the cloud match; the one file that says when it fires and whether writes are on |
| `mounts` | The Atelic checkout on this machine, mounted read only into a local container run in place of the deploy key clone |
| `tst/` | The spend split, the calendar lint and the shaping of each pull, on invented rows; `node --test runners/brief/tst/*.test.mjs`, run by the lint workflow |
| `plugins/atelic/scripts/lib/hubspot.mjs`, in the Atelic repo | The Atelic pull (its `week` command), run from an Atelic checkout: the one at `$ATELIC`, or a shallow clone over `ATELIC_DEPLOY_KEY`. The one copy of the funnel rules (ATE-656) |

## What the Model Reads

The rules are never copied into the image. A run clones Eudaimonia (the block doc, `schedule.md`, the Linear and calendar tool docs), homebase (the assist plugin's learned rules, payee map, email rules, label map, and the planning skill's learned rules; public, so no key) and the Atelic repo (`Tools/ynab.md`, `Tools/Google/gmail-labels.md`, the funnel rules), and the prompt names each file by path. A rule changed in any of the three is live on the next run and promotes nothing here.

## Pulls That Fail

The retro half's pulls stay fatal: a brief without its retrospective is not a brief. Each planning pull is bounded by `timeout`, never fatal, and recorded in `pulls.json`: a tracker that is down costs its section, which opens with "Not read this run" and the reason, and the footer lists it. A pull that fails removes any partial file so the model never reads half a pull.

The page lands at `out/email.html`, the draft at `out/brief.json`, and the YNAB plan at `out/plan.json`, which rides as the attachment.
