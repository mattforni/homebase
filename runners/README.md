# Runners

Headless Claude routines that run on a schedule. One directory per runner, each holding everything that runner is: its pulls, its prompt, its renderer, and its container if it has one.

| Runner | Runs On | What It Does |
|---|---|---|
| [retro/](retro/README.md) | Cloud Run | Monday 05:00 Denver. Pulls the ISO week from Strava, Gmail, and HubSpot, has Claude write the retrospective, and emails it as `YYYY-Www Retro`. |
| [outreach/](outreach/README.md) | by hand | Runs the `outreacher` agent to rebuild the ATE-480 roster before the Tuesday desk block, and emails a report as `YYYY-Www Outreach`. Deliberately unscheduled: one pass is about $7.50, which is worth paying on purpose and not on a timer. |

The runtime one pager (why Cloud Run over Routines, the service accounts and their secrets, the schedules, the traps) lives in Eudy at `Admin/Tools/cloud-run.md`.

## Where a Runner Runs

A runner is defined once and can be executed three ways. Which one it is in is never something the runner itself learns: whoever invokes it puts the secrets in the environment first, and `runners/lib/runner.sh` is deliberately pure with respect to that environment. It reads variables and writes files, and it never touches the Keychain, `~/.config`, or gcloud.

| Mode | Command | Secrets from |
|---|---|---|
| By hand | `bin/runner/run-local <name>` | `.env.local` if fetched, then this machine's Keychain |
| On a schedule, locally | `bin/runner/run-scheduled <name>`, from a LaunchAgent | the same |
| Production | Cloud Run Job, fired by Cloud Scheduler | Secret Manager, injected by the job |

**No runner is on a LaunchAgent right now**, and `launchagents/` is empty. The
outreach runner was scheduled for one morning and unscheduled the same day
(2026-08-31): a pass costs about $7.50, which is a real number to spend every
Monday whether or not the week needs it. The middle row is kept because it is
where a runner goes when the schedule earns its cost, and because it is the
only thing a plist has to name. Adding one back is a plist and nothing else.

**Who a runner reports to is a property of the runner**, so it may name its own
recipient in `~/.config/headless-report/recipient-<name>`, falling back to the
shared `recipient`. The retro is personal work and the outreach roster is Atelic
work, and they go to different mailboxes. The addresses stay in `~/.config`
rather than the repo, because homebase is public.

**Local is not a lesser Cloud Run.** It is where every runner lives before it is promoted, and where some of them stay. A runner that drives the local CLIs (`hs`, `gws`, `linear`, each authenticated on this machine and each resolving its identity from an `.account` marker) or that needs a real browser cannot be containerised without work that has to be decided rather than assumed. Such a runner ships no Dockerfile, `bin/runner/promote` refuses it by name, and its README says what promoting it would take. `outreach/` is the current example.

The driver side, which does know it is on Forni's Mac, is `bin/runner/lib.sh`: the Keychain reads, the recipient file, and the PATH a local runner needs. That PATH is longer than it looks like it needs to be, and `runner_local_path` carries the reason.

## Iterate Locally, Then Promote

**Every change to a runner is developed and iterated on this machine first, and reaches production only once the local result is right.** Editing a routine by rebuilding an image, waiting on Cloud Build, firing the job, and reading the result out of a logging query is a four minute round trip for a one line change, and it puts every experiment into production and into an inbox. The local loops below are seconds, and nothing they do is visible to anyone.

Three loops, each answering a different question. Use the cheapest one that can answer yours.

| Loop | Command | Costs | Use it when |
|---|---|---|---|
| Render | `bin/runner/render-local <name>` | nothing, no network | changing how the email looks: `render.jq`, a table, the type, the palette |
| Draft | `bin/runner/run-local <name> --reuse` | one Claude call | changing what the email says: `prompt.md`, the JSON shape, the reads |
| Full | `bin/runner/run-local <name>` | every pull plus one Claude call | changing the pulls themselves, or a last check before promoting |

**A runner with a Dockerfile runs in its image here too.** `run-local` builds the runner's own Dockerfile with Docker Desktop and runs it with `out/` mounted as the work directory, so every loop above lands in the same place and the run is the container Cloud Run runs: the pinned Claude Code, a bare config, the model the entrypoint names. `--host` runs the entrypoint directly on this machine instead, which is the only path for a runner without a Dockerfile, and there `claude -p` is a different animal: it resolves the model, effort and settings from this machine's own Claude Code config. That was the whole of ATE-521. The same W36 draft cost $2.17 on the host (Opus at high effort, from `~/.claude/settings.json`) and $0.28 in Cloud Run (the current Sonnet, a bare config's default on this token), and the context load was not the difference: a one word call carries about 35K to 44K tokens of Claude Code's own system prompt in both places. So the retro entrypoint names its model, which makes both places agree by construction; each run keeps its full `claude -p` result in `out/claude-result.json`; and the cost line prints the per model token breakdown beside the total. `.dockerignore` and `.gcloudignore` keep `.env.local` and `out/` out of every build context, local or Cloud Build.

**The cheapest loop needs an `out/` to read, and a fresh clone has none.** Do not
reach for the Full loop to create one: it costs every pull and a model call, and
it rotates the real Strava token. Rebuild the draft from the last email the
runner actually sent instead, which costs nothing and changes nothing outside
this machine. Pull the message with `gws`, decode its HTML part, and write a
`retro.json` and a `week.env` back into `out/` by reading the rendered tables;
`prompt.md` is the schema and the renderer itself says how each field was used.
Then confirm the reconstruction before trusting it, by rendering it and diffing
against the decoded original. On 2026-08-31 that diff came back byte for byte
identical apart from a trailing newline, which is the standard to hold: a
fixture that reproduces a shipped email is real ground truth, and one that
merely looks plausible is invented data wearing a costume.

Then, and only then:

```bash
bin/runner/mail <name>             # read the draft in Gmail, where it lands
bin/runner/promote <name>          # Cloud Build builds it, the job points at it
bin/runner/fire <name>             # run production now and print its log
```

A browser preview is not the artifact. Gmail collapses styles, rewrites markup,
and renders on a phone, so `mail` is the last check before `promote`: it sends
the exact rendered bytes through the same Resend sender the job uses. Its key
comes from the Keychain through `bin/lib/email-report.sh`, never from the
vault, because the vault copy belongs to the container.

### The Commands

| Command | Role |
|---|---|
| `fetch-env <name>` | Writes `runners/<name>/.env.local` from the **deployed job's own** secret mapping, pulling each value from the vault. Run it once per machine, and again whenever a runner gains a secret. |
| `run-local <name>` | Runs the real `entrypoint.sh` against those real secrets, rendering the email into `out/` instead of sending. `--week` drafts another week, `--reuse` skips the pulls, `--send` actually delivers. A runner with no `.env.local` is fine and falls back to the Keychain. |
| `run-scheduled <name>` | The same execution path, sending for real and logging to `~/.claude/debug/runner-<name>.log`. This is what a LaunchAgent points at, and the only thing a plist needs to know is the runner's name. |
| `render-local <name>` | Pushes the saved `out/retro.json` back through `render.jq`. No network, no model. |
| `promote <name>` | Cloud Build builds the image, the job is pointed at it. Refuses a dirty tree without `--dirty`. |
| `fire <name>` | Executes the job now and prints its log. `--week` is applied, used, and cleared again. |
| `mail <name>` | Mails whatever is rendered in `out/` to the production recipient, so a draft can be read in Gmail rather than a browser. Preview only; production sending stays in the runner. |

`out/` and `.env.local` are gitignored. `.env.local` is mode 600 and holds live credentials in plaintext: never commit it, never print it into a transcript.

### Two Things Worth Knowing

**The secret mapping is never written down twice.** `fetch-env` reads it back out of the deployed job rather than keeping a copy in the repo, so a local run cannot quietly become an older version of production. The cost is that a brand new runner has to be created in Cloud Run before its local loop works.

**The container's jq is older than yours.** The image is `node:20-slim` on Debian bookworm, which ships jq 1.6; a Homebrew mac is on 1.8. A renderer that compiles locally can still fail in the cloud, and it fails at the very last step, after every pull and the whole Claude call have been paid for. The trap that caught us on 2026-08-29 was `label`, a jq keyword that 1.8 tolerates as a `$label` parameter name and 1.6 rejects outright. Prefer plain names, and treat a clean `render-local` as evidence about your jq rather than about the runner's.

Get the real answer before promoting, by rendering the same draft through the version the image actually ships:

```bash
curl -sSLo /tmp/jq16 https://github.com/jqlang/jq/releases/download/jq-1.6/jq-osx-amd64 && chmod +x /tmp/jq16
/tmp/jq16 -r --arg week 2026-W35 --arg monday 2026-08-24 --arg sunday 2026-08-30 \
    -f runners/retro/render.jq runners/retro/out/retro.json > /tmp/jq16.html
diff /tmp/jq16.html runners/retro/out/retro.html
```

Named for the retro because it was the only runner that renders from JSON (the sweep joined it 2026-09-11), and
the only one still on the old `retro.html` artifact name; a new renderer writes
`$WORK/email.html` and its draft alongside.

The two steps stay separate because a pipeline reports only its last command's status, which would hand a compile error back wearing diff's exit code. A non zero exit from the render is the failure the cloud would have hit; a non zero exit from the diff means both versions parsed but disagree on the bytes. Clean on both is the answer you want. The binary is x86 and runs under Rosetta on Apple silicon.

**A local run still rotates the real Strava token.** Strava invalidates a refresh token the moment it issues the next one, so a local run that pulls Strava has to write the new one back to the vault or the next cloud run cannot refresh at all. `entrypoint.sh` falls back to the operator's own gcloud credentials when there is no metadata server to ask. This is the one thing a local run changes in the outside world, and it is not optional.

## Adding a Runner

A runner directory needs `entrypoint.sh` (executable) and a `README.md`, plus a `Dockerfile` if it is meant for Cloud Run and `render.jq` if it renders its email from JSON.

Source `../lib/runner.sh` first and take the shared pieces from there rather than writing them again: `require`, `html_escape`, `send_email`, the GNU versus BSD date shims, and the three builders that assemble a status email (`build_summary_block`, `build_meta_block`, `build_report_html`). Look for it at both `$SELF_DIR/lib/runner.sh` and `$SELF_DIR/../lib/runner.sh`, since it sits beside the entrypoint inside an image and one level up in the repo.

The entrypoint should honor `DRY_RUN` (render, do not send) and `SKIP_PULLS` (reuse what is already in `$WORK`), since those two flags are the whole local loop, and it should write its rendered email to `$WORK/email.html`, which is what `run-local` opens and `mail` sends. It should find its siblings relative to the script rather than at an absolute container path, so it runs unchanged wherever it is.

**An image is built from a staged context, never from the directory itself.** A Docker context cannot reach above its root, and neither can the tarball Cloud Build uploads, so `bin/runner/lib.sh` assembles `runners/<name>/.build/` fresh for every build: the runner's files, `lib/runner.sh`, and `agents/<name>.md` for each agent named one per line in the runner's `agents` file, copied from `.claude/agents/`. The Dockerfile copies from those paths (`lib/runner.sh` to where the entrypoint looks first, an agent to `/home/runner/.claude/agents/`). Two more optional files: `mounts` lists host paths a local container run mounts, one `host:container[:ro]` per line with `$HOME` expanded, which is how a checkout stands in for a deploy key clone on this machine; and `.dockerignore` keeps `.env.local` and `out/` out of the context. `runners/sweep/` is the example that uses all of them.
