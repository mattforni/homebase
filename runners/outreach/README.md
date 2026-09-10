# Outreach Runner

Run by hand, before the Tuesday desk block. Runs the `outreacher` agent headlessly so the week's outreach roster is rebuilt and drafted, then mails a status report as `YYYY-Www Outreach`.

**Not scheduled, on purpose.** It was on a Monday 06:00 LaunchAgent for exactly
one morning. A full pass is about eighteen minutes and **$7.50**, and a weekly
timer spends that whether or not the week needs it, so the trigger is a person
deciding the week needs a roster (2026-08-31).

It reports to `matt@atelic.me`, not the personal Gmail account, because this is
Atelic work. That comes from `~/.config/headless-report/recipient-outreach`.

**The roster itself lands as `Outreach/<ISO week>-roster.md` in the Atelic
repo**, one file per week, written once and never edited after. The agent
writes the file and stops; it does not stage or commit, and Forni commits it.
Until 2026-08-31 the roster was rewritten weekly into the description of a
standing Linear issue, which destroyed the previous week every Monday.

Prep only. The agent never emails anyone, never moves a Lead Status, and never posts to a client surface. Every send waits for Forni's explicit yes inside the Tuesday block, one at a time, through `/atelic:handle-outreach`.

## Running It

```bash
bin/runner/run-local outreach --reuse    # render the saved run again, no network
bin/runner/run-local outreach            # run the agent, render, send nothing
bin/runner/run-local outreach --send     # the real thing: run, render, and mail it
```

**`run-local` without `--send` is the safe default** and the one to reach for.
`bin/runner/run-scheduled outreach` also works and always sends, but it is the
unattended door: it logs to a file rather than the terminal, so a run started
by hand through it looks like nothing is happening.

`--week YYYY-Www` drafts another week. The work directory is `runners/outreach/out/`, which is also the agent's scratch directory. The agent may write exactly two places: that directory, and the requested week's `Outreach/<ISO week>-roster.md` in the Atelic repo. That second rule is pinned to the week being run, so a pass cannot touch a prior week's roster.

## Local Only, on Purpose

This runner has no Dockerfile, and `bin/runner/promote` will refuse it and say so. That is a position, not a gap. Two things keep it on this machine:

**It reads through the local CLIs.** HubSpot through `hs`, both mailboxes and the One Pager through `gws`, and it writes the roster into the Atelic checkout. Both CLIs are authenticated here, and `hs` and `gws` resolve which portal and which mailbox from the `.account` marker in the Atelic repo, which is why the entrypoint refuses to run from anywhere else. Reading the wrong CRM is the expensive failure, so that is a hard gate rather than a warning.

**Its customer path walk needs a real browser.** The method requires `agent-browser`, never `curl` alone, because a Cloudflare challenge, a per visit phone number, and a lazy loaded form all lie to a fetch. It keeps screenshots of anything it would cite.

Promoting it to Cloud Run would mean, roughly: a vaulted `authorized_user` JSON per Google identity so the mailbox reads go straight to the Gmail API the way the retro's already do, a HubSpot service key in the vault with the reads moved to its HTTP API, a deploy key for the Atelic repo alongside the retro's Eudy one, the `outreacher` agent definition copied into the image, and a browser in the image. The last one is the only piece with no precedent in `runners/`, and it is a real jump in image size and memory. The browser is used on the bumps due path rather than across the whole roster, so a split where the walk stays local is also on the table.

## What It Reads

The agent definition is `.claude/agents/outreacher.md`, and it names its own sources of truth: the Outreach method, the voice, the ICP statement in the One Pager, HubSpot, and the client board. This runner adds nothing to that and deliberately carries no prompt of its own; the prompt is one line naming the week and the scratch directory, and everything else lives in the agent.

## Failure

The report is mailed on failure as well as success, with the reason on top and the last lines of the agent's output beneath it. A run that cannot deliver its report exits non zero so the log carries it, since nobody is watching at 06:00.

`SKIP_PULLS=1` replays the saved run in `out/result.json` with its saved exit status, which is how a failure gets looked at without paying for the agent again.
