# Runners

Headless Claude routines that run on a schedule. One directory per runner, each holding everything that runner is: its pulls, its prompt, its renderer, and its container if it has one.

| Runner | Runs On | What It Does |
|---|---|---|
| [retro/](retro/README.md) | Cloud Run | Monday 05:00 Denver. Pulls the ISO week from Strava, Gmail, and HubSpot, has Claude write the retrospective, and emails it as `YYYY-Www Retro`. |
| [recruiter/](recruiter/README.md) | Cloud Run | Monday 18:00 Denver. Pulls the job boards with curl, runs the `recruiter` agent over the pulled listings so the week's sweep is done before the Tuesday work search block, and emails the board as `YYYY-Www Recruiter` with the ledger rows attached as a file. Promoted 2026-09-11. |
| [outreach/](outreach/README.md) | by hand | Runs the `outreacher` agent to build the week's roster into `Outreach/YYYY-Www-roster.md` in the Atelic repo before the Tuesday desk block, and emails a report as `YYYY-Www Outreach`. Deliberately unscheduled: one pass is about $7.50, which is worth paying on purpose and not on a timer. |

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

**A runner with a Dockerfile runs in its image here too.** `run-local` builds the runner's own Dockerfile with Docker Desktop and runs it with `out/` mounted as the work directory, so every loop above lands in the same place and the run is the container Cloud Run runs: the pinned Claude Code, a bare config, the model the entrypoint names. `--host` runs the entrypoint directly on this machine instead, which is the only path for a runner without a Dockerfile, and there `claude -p` is a different animal: it resolves the model, effort and settings from this machine's own Claude Code config. That was the whole of ATE-521. The same W36 draft cost $2.17 on the host (Opus at high effort, from `~/.claude/settings.json`) and $0.28 in Cloud Run (the current Sonnet, a bare config's default on this token), and the context load was not the difference: a one word call carries about 35K to 44K tokens of Claude Code's own system prompt in both places. So the retro entrypoint names its model, which makes both places agree by construction; each run keeps its full `claude -p` result in `out/result.json`; and the cost line prints the per model token breakdown beside the total. `.dockerignore` and `.gcloudignore` keep `.env.local` and `out/` out of every build context, local or Cloud Build.

**The cheapest loop needs an `out/` to read, and a fresh clone has none.** Do not
reach for the Full loop to create one: it costs every pull and a model call, and
it rotates the real Strava token. Rebuild the draft from the last email the
runner actually sent instead, which costs nothing and changes nothing outside
this machine. Pull the message with `gws`, decode its HTML part, and write a
`<name>.json` and a `week.env` back into `out/` by reading the rendered rows;
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
| `render-local <name>` | Pushes the saved `out/<name>.json` (or `out/result.json` for a runner with no draft) back through `render.jq` with the shared design and the saved run's footer line. No network, no model. |
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
/tmp/jq16 -r -L runners/lib --arg week 2026-W35 --arg monday 2026-08-24 --arg sunday 2026-08-30 --arg meta "" \
    -f runners/retro/render.jq runners/retro/out/retro.json > /tmp/jq16.html
diff /tmp/jq16.html runners/retro/out/email.html
```

The same check works for any runner: its draft is `out/<name>.json` (the outreach report renders from `out/result.json`, since it has no draft), and every runner's page is `out/email.html`.

The two steps stay separate because a pipeline reports only its last command's status, which would hand a compile error back wearing diff's exit code. A non zero exit from the render is the failure the cloud would have hit; a non zero exit from the diff means both versions parsed but disagree on the bytes. Clean on both is the answer you want. The binary is x86 and runs under Rosetta on Apple silicon.

**A local run still rotates the real Strava token.** Strava invalidates a refresh token the moment it issues the next one, so a local run that pulls Strava has to write the new one back to the vault or the next cloud run cannot refresh at all. `entrypoint.sh` falls back to the operator's own gcloud credentials when there is no metadata server to ask. This is the one thing a local run changes in the outside world, and it is not optional.

## The Email

**Every runner that mails a page mails the same design, composed from `runners/lib/email.jq`.** The design is Forni's "W38 Sweep Email" (Claude Design, 2026-09-11), made canonical the same day: cream ground (`#F6F1E7`), cards of paper (`#FDFBF6`) on a hairline (`#E6DFD2`) with a 14px radius, the atelic wordmark and one orange rule (`#FC4A1A`) at the top left with the runner's title beside them, monospace uppercase eyebrows, sans for everything read, and the accent reserved for the one value that matters on a row and the link underline. Every style is inline and every layout a table, for Gmail; disclosures fold in Apple Mail and open flat in Gmail, which is the designed fallback.

A runner's `render.jq` starts with `include "email";` and composes: `page` (the shell and the inbox preheader), `masthead` (the wordmark and the runner's title), `title_card` (eyebrow, one to three headline lines, a lede, and a `stats_row` of `stat` cells), `eyebrow` between cards, `card` around rows, `item` (the workhorse row: name, the accent value on the right, a subline of facts, a body, an optional `fold`, an optional link), `note` (a short text under a small eyebrow), `row` for any block inside a card, `big_fold` inside a `fold_row` for the long tail, `list` with `lead_row`, `mono_table` for rows the reader copies, and `footer` for the run's one line of facts. `failure_page` mails a bad run in the same cream. The scaffold's `runner_render` passes `-L` pointing at the library (`runners/lib` in the repo, `/home/runner/lib` in an image) plus `$week`, `$monday`, `$sunday` and `$meta`, and `bin/runner/render-local` passes the same. A new kind of row is a new def in the library, so the next runner gets it too; a runner never carries a palette or a frame of its own. The library is written for the image's jq 1.6 (`label` is a keyword there). All three runners compose from it since 2026-09-15 (ATE-543): `runners/recruiter/render.jq` is the reference composition, `runners/retro/render.jq` shows a draft with several kinds of row, and `runners/outreach/render.jq` shows a status email rendered from the `claude -p` result itself when there is no draft.

## Adding a Runner

A runner is three things of its own: its pulls, its prompt, and its renderer. Everything else comes from the scaffold in `runners/lib/runner.sh`, so a new runner directory is `entrypoint.sh` (executable), `prompt.md`, `render.jq`, and a `README.md`, plus a `Dockerfile` when it is meant for Cloud Run (copy `runners/recruiter/Dockerfile`: it installs the pinned Claude Code and copies `lib/` in), an `agents` file naming any agent definition it runs, and `mounts` for what a local container run needs from this machine.

The entrypoint's shape, which all three runners share:

```bash
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for candidate in "$SELF_DIR/lib/runner.sh" "$SELF_DIR/../lib/runner.sh"; do   # beside it in an image, one up in the repo
    [[ -r "$candidate" ]] && { . "$candidate"; RUNNER_LIB="$candidate"; break; }
done

runner_init retro "Retro" previous    # the directory name, the title a reader sees, current or previous week by default
require CLAUDE_CODE_OAUTH_TOKEN ... || exit 1
require_tools claude jq curl ... || exit 1

if [[ "$SKIP_PULLS" == "1" ]]; then check the cached files are there; else pull them into $WORK; fi

runner_claude "$(fill_prompt "$PROMPT_FILE")" --model sonnet --allowedTools Read || exit 1
runner_draft '(.headline | type == "array") and (.rows | type == "array")' || exit 1
runner_render || exit 1
status="success"
```

What each call does: `runner_init` makes the work directory and the log (stdout and stderr are tee'd into it from there), validates the week and sets `WEEK`, `MONDAY`, `SUNDAY` and `NEXT_MONDAY`, names every file (`RESULT_JSON`, `RESULT_RC`, `DRAFT_JSON` as `$WORK/<name>.json`, `REPORT_HTML` as `$WORK/email.html`), sets `SUBJECT` to `"$WEEK <Title>"`, and traps `runner_finish` on exit, which mails the page (with `ATTACHMENT` beside it if the runner set one) or the failure page, or on a dry run prints where the page is. `fill_prompt` fills `{{WEEK}}`, `{{MONDAY}}`, `{{SUNDAY}}`, `{{NEXT_MONDAY}}`, `{{TODAY}}`, `{{WORK}}`, and `{{EUDY}}`, `{{PULLS}}` or `{{ATELIC}}` when set. `runner_claude` makes the one headless call with the retry a long session needs (a timeout or a transient API error gets one more attempt), saves the result and its exit status for replay, and checks it is exit zero, JSON, and a completed turn. `runner_replay` puts a saved result back through the same checks, for a runner whose only pull is the agent. `runner_draft` cuts the object out of the result and holds it to the shape the renderer reads. `runner_render` runs `render.jq` with the shared design, the week, and the footer line. `require` and `require_tools` fail the run at the top rather than three pulls in; `send_email`, `html_escape`, `meta_line` and the GNU versus BSD date shims are there for anything else.

Two conventions the flags rely on: `DRY_RUN=1` renders and never sends, and `SKIP_PULLS=1` reuses what is already in `$WORK` (the pulled files, for a runner that pulls; the saved result, for one that only runs an agent), since those two are the whole local loop. Every artifact name above is what `run-local`, `render-local` and `mail` look for, so a runner that uses the scaffold gets all three loops without doing anything. The entrypoint finds its siblings relative to itself rather than at an absolute container path, so it runs unchanged wherever it is.

**An image is built from a staged context, never from the directory itself.** A Docker context cannot reach above its root, and neither can the tarball Cloud Build uploads, so `bin/runner/lib.sh` assembles `runners/<name>/.build/` fresh for every build: the runner's files, `lib/runner.sh`, and `agents/<name>.md` for each agent named one per line in the runner's `agents` file, copied from `.claude/agents/`. The Dockerfile copies from those paths (`lib/runner.sh` to where the entrypoint looks first, an agent to `/home/runner/.claude/agents/`). Two more optional files: `mounts` lists host paths a local container run mounts, one `host:container[:ro]` per line with `$HOME` expanded, which is how a checkout stands in for a deploy key clone on this machine; and `.dockerignore` keeps `.env.local` and `out/` out of the context. `runners/recruiter/` is the example that uses all of them.
