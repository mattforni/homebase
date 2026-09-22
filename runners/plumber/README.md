# The Pipeline Runner

Pulls the portal, both mailboxes, the One Pager and the candidate sites, runs the `plumber` agent headlessly over what was pulled, so the week's roster is built and drafted before the Tuesday desk block opens, and mails a report as `YYYY-Www Pipeline` with the roster attached. Fired by hand; `bin/runner/run-local plumber` is the way to iterate on it and, until it is promoted, the way to run it.

**The runner fetches; the model reads** (ATE-551, 2026-09-15, the recruiter's shape from ATE-543). Until then the agent did every read itself, one `hs` or `gws` command per model turn, walked sites in a browser, and a pass cost 7.54 USD on Opus; the fetching was most of the bill. Now the entrypoint pulls before `claude -p` starts:

- **The repos.** Eudaimonia and, inside it, the Atelic repo: the checkouts on this machine (mounted read only into the container by `mounts`), or in production two shallow clones over read only deploy keys. The method, the three rules, the Voice samples, last week's roster, this week's skeleton with its Placed Ahead entries, and the `Leads/` audits are all read from there.
- **The portal.** `lib/hubspot.mjs sweep`, the same client and joins the retro's `week` command uses (the file moved into `runners/lib/` for exactly this). Every funnel company with its GROW fields, every contact carrying a Lead Status, every logged email of the last 120 days with its opens, every open task, and the meetings and notes of the last sixty days with their bodies, Granola links included. The day counts, the touches run, the opens read asymmetrically, and the section each name lands in are computed in code and written to `portal.md` as tables, with every name's logged sends and replies in `portal-detail.md` (read per name, never whole) and `portal.json` beside it. The sweep also writes `sites.txt` and `mail-terms.txt`, the lists the next two pulls read.
- **The mailboxes.** `lib/gmail.mjs`, both mailboxes through the Gmail API with the two vaulted `authorized_user` JSONs, searched for every funnel domain and address over sixty days, with the bodies of incoming mail from the last three weeks. Each mailbox runs a control query first, so an empty result from a broken read fails the run rather than reading as a quiet week.
- **The One Pager,** as text from the Drive export endpoint, the Atelic identity first and the personal one as the fallback. Not fatal when it fails; the failure is named in `pulls.md` and under the report's unverified list.
- **The sites.** For every name in bumps due, visits due, replies owed and tasks due, and the top eight first touch candidates, one capped file per domain: what the head of the home page code says (title, description, canonical, structured data types, the tells and third party hosts in the code, read out by `lib/text.mjs head`), `robots.txt`, then the home page and up to four internal pages as text with links kept. The raw home page HTML stays beside it for a claim that needs the code. One file per site because the first two runs spent most of their turns opening small files one at a time. A fetch is not a walk, and the prompt says so: nothing a page shows or fails to show becomes a finding on its own.

Then a write probe (`runner_probe_write`, a one line Haiku call with the same agent and allowlist, about a cent) proves the agent can write into the work directory, because the first two runs in the image drafted a whole week and then could not write it: the agent's definition listed no Write tool, and a path scoped Write rule is denied by `claude -p` in every form tried (relative, absolute, `//` prefixed, `*` and `**`), so the rule is the bare `Write`, safe in a container whose checkouts are read only mounts. Then one headless call runs the agent with the pulled files named in `prompt.md`. It sorts the week into its fixed order, drafts every reply, bump and first touch, grades the cold drafts, and writes the roster as a complete file to `out/YYYY-Www-roster.md`, the skeleton's Placed Ahead section carried over at the foot. It returns one JSON summary (`prompt.md` carries the shape) and the node renderer in [../email/](../email/) renders it (`render.jq` is the fallback): the shared design, a title card with the headline and the three targets, the weekly scoreboard as the roster carries it with the checklist of names under it, the queue counts and the hottest reader, the flags from the portal diff, and the could not verify and deliberately not in the block lists under a fold. One footer line carries the run's duration, cost, turns and models.

**The roster rides as the attachment, and Forni places it.** The runner writes nothing into either checkout. After a run the file is copied into the repo and committed by hand:

```bash
cp runners/plumber/out/2026-W38-roster.md ~/Eudaimonia/Craft/Vocation/Atelic/Pipeline/
```

**What stays out, for now.** The browser walk. The method already says machine verified is not verified and that the Google captures for a bump come from Forni's own browser, so the runner drafts each bump and first touch from the pulled evidence and marks on the roster line which claims still need a capture; the Tuesday block finishes it. Putting Chromium in the image is a follow up once this version has run a few weeks. The HubSpot writes (auditing a prospect, parking a name) stay interactive too; those are things Forni asks for by name.

Prep only. The agent never emails anyone, never moves a Lead Status, never posts to a client surface, and here it has no `hs`, no `gws`, no browser and no git at all. Every send waits for Forni's explicit yes inside the Tuesday block, one at a time, through `/atelic:handle-outreach`.

It reports to `matt@atelic.me`, not the personal Gmail account, because this is Atelic work. Locally that comes from `~/.config/headless-report/recipient-plumber`.

## Running It

```bash
bin/runner/run-local plumber --week 2026-W38 --no-open   # in the image: pulls, one model call, renders to out/, sends nothing
bin/runner/run-local plumber --reuse                      # skips the pulls, one model call over the files already in out/
bin/runner/render-local plumber                           # re-render out/plumber.json, no network, no model
bin/runner/run-local plumber --send                       # the real thing, from this machine
```

A local run builds the image and runs it with Docker Desktop, and mounts this machine's `~/Eudaimonia` read only at the container's `/home/runner/Eudaimonia` (`mounts`), so the agent's `~/Eudaimonia/...` paths resolve there, the Atelic repo is found nested inside it, and no deploy key is needed on this machine. The work directory is `runners/plumber/out/`, which is also the agent's scratch directory: `portal.md`, `portal-detail.md` and `portal.json` the sweep, `mailbox.md` and `mailbox.json` the mailboxes, `one-pager.md`, `pulls/sites/<domain>.md` the site text, `pulls.md` what was pulled and what failed, `plumber.json` the summary, `email.html` the render, and `YYYY-Www-roster.md` the attachment.

**Credentials before promotion.** `fetch-env` reads a deployed job's secret mapping, and there is no job yet, so `runners/plumber/.env.local` is written by hand for now: `HUBSPOT_SERVICE_KEY` from the Keychain (`hubspot-service-key-atelic`), and `GWS_OAUTH_TOKEN_ATELIC_JSON` and `GWS_OAUTH_TOKEN_PERSONAL_JSON` from `gws auth export --unmasked` under each profile. Mode 600, gitignored, never printed.

## What It Reads

The agent definition is `.claude/agents/plumber.md`, copied into the image by the staged build context (`agents`), and it names its own sources of truth: the method, the voice, the ICP statement in the One Pager, HubSpot, and the board. This runner adds only `prompt.md`: the week, the checkouts, the pulled files and which steps they already cover, the scratch directory, the roster's destination, and the JSON shape the renderer reads. The method itself lives in the agent. The model and effort are the agent's own (`model: opus`, `effort: medium`) unless `RUNNER_MODEL` names another, which is how the side by side is run (`RUNNER_MODEL=sonnet bin/runner/run-local plumber --reuse`).

## Promoting It

Not yet promoted. What it takes, all with precedent in `runners/` now: a Cloud Run Job `plumber` in the `atelic` project under its own service account, seven vault secrets injected (`claude-code-oauth`, `resend-api-key`, `hubspot-service-key-atelic`, `gws-oauth-token-atelic` and `github-deploy-key-atelic` in `atelic-keys`; `gws-oauth-token-personal` and `github-deploy-key-eudy` in `forni-keys`), `REPORT_RECIPIENT` set to the Atelic mailbox, and `bin/runner/fire plumber` by hand each Monday. The two new secrets are the atelic profile's `gws auth export --unmasked` and a read only deploy key registered on `mattforni/atelic`. No Cloud Scheduler entry until the cost is measured; a timer spends a pass whether or not the week needs one, which is why the last version was unscheduled (2026-08-31). The runtime one pager for the pattern is Eudy's `Admin/Tools/cloud-run.md`.

## Failure

The report is mailed on failure as well as success, as the shared failure page: the reason on top and the last lines of the log beneath it, permission denials included. A run that cannot deliver its report exits non zero so the log carries it. A failed run keeps its `out/result.json`, so `render-local` and a read of the log are how a failure gets looked at without paying for the agent again; a pull that failed fails before the model is called, so it costs nothing.
