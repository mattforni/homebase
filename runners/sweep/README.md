# The Sweep Runner

Runs the `recruiter` agent headlessly, so the week's job board sweep is done before the Tuesday 07:00 work search block opens, and mails the board as `YYYY-Www Sweep`. Meant for a Cloud Run Job firing Monday 18:00 Denver; until it is promoted, `bin/runner/run-local sweep` by hand is production.

**What the email is.** Forni's design ("W38 Sweep Email", Claude Design, 2026-09-11): cream ground, the atelic masthead, a title card with a two line headline, a lede, and three counts (shortlisted, fractional, verified and killed); one card per shortlisted role with the fit in orange, the title, comp and arrangement on one line, why it cleared, what the company does folded under a disclosure, and the posting link; the fractional lane in the same shape with the rate where the fit sits, the a16z prospects line, and the claim tradeoff once; then "If you want to dig in", where the considered and rejected list, the source notes, and the ledger rows fold away. One footer line carries the run's duration, cost, turns and models. The agent returns the board as JSON (`prompt.md` carries the shape) and `render.jq` renders it, the retro's pattern; the Tuesday block picks from the shortlist, hands the picks to `assist:draft-applications`, and appends the ledger rows to `Craft/Vocation/FY27-sweep-ledger.md`. The disclosures fold in Apple Mail and open flat in Gmail, which is the designed fallback.

**The recruiter stays on Sonnet, and the cost lever is structural.** The first board (Sonnet, 2026-09-11) cost 6.64 USD list equivalent on the subscription token, 296 turns, 37 minutes. A same week side by side on Haiku cost 0.88 USD in 60 turns and eight minutes, and was cheaper because it skipped the verification step the method exists for: no employer side posting read, comp "TBD", the board named where the link should be, one shortlisted role (Geli) that Sonnet had rejected as stale and onsite, four open fractional roles missed because no detail page was fetched, five ledger rows against twenty. A board that hands the Tuesday block a role that does not exist costs more than it saves. The way to spend less is to fetch less with the model: pull the Getro query set and the ATS APIs with curl in the entrypoint and hand the model finished listings, the retro's shape. That is its own piece of work.

**Read only, by construction.** The agent gets Read, Grep, Glob, WebFetch, WebSearch, curl, and a scratch directory; no write reaches the Eudaimonia checkout, which is why the ledger rows travel inside the email rather than being appended by a machine. It reports to the personal mailbox, since the work search is personal work.

## Running It

```bash
bin/runner/run-local sweep --week 2026-W38 --no-open   # in the image, renders to out/, sends nothing
bin/runner/run-local sweep --reuse                      # re-render the saved run, no network, no model
bin/runner/run-local sweep --send                       # the real thing, from this machine
```

A local run builds the image and runs it with Docker Desktop, and mounts this machine's `~/Eudaimonia` read only at the container's `/home/runner/Eudaimonia` (`mounts`), so the agent's `~/Eudaimonia/...` paths resolve there and no deploy key is needed on this machine. The work directory is `runners/sweep/out/`, which is also the agent's scratch directory.

## What It Reads

The agent definition is `.claude/agents/recruiter.md`, copied into the image by the staged build context (`agents`), and it names its own sources of truth: the plan, the profile, the rubric, the work search log, and the sweep ledger. This runner adds only `prompt.md`: the week, the checkout, the scratch directory, and the JSON shape `render.jq` reads, which replaces the markdown report the agent writes by hand; the method itself lives in the agent. The model and effort are the agent's own (`model: sonnet`, `effort: medium`), so the sweep that runs here is the sweep that runs by hand.

## Promoting It

Not yet promoted. Promoting takes: a Cloud Run Job `sweep` in the `atelic` project under its own service account with three vault secrets injected (`atelic-keys/claude-code-oauth`, `atelic-keys/resend-api-key`, `forni-keys/github-deploy-key-eudy`), `REPORT_RECIPIENT` set to the personal mailbox, and a Cloud Scheduler entry at `0 18 * * 1` Denver. `bin/runner/promote sweep` then builds and points the job at the image. The runtime one pager for the pattern is Eudy's `Admin/Tools/cloud-run.md`.

## Failure

The report is mailed on failure as well as success, with the reason on top and the last lines of the agent's output beneath it. A run that cannot deliver its report exits non zero so the log carries it. `SKIP_PULLS=1` (`--reuse`) replays the saved run in `out/result.json` with its saved exit status, which is how a failure gets looked at without paying for the agent again.
