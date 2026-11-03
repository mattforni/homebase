# Runners

Headless Claude routines that run on a schedule. One directory per runner, each holding everything that runner is: its pulls, its prompt, its renderer, and its container if it has one.

| Runner | Runs On | What It Does |
|---|---|---|
| [brief/](brief/README.md) | Cloud Run | Pulls the closing ISO week from Strava, Gmail, and HubSpot and the week ahead from both inboxes, all three calendars, both YNAB budgets, the Linear cycle and Todoist; has Claude write the retrospective and the first pass of the Monday planning session, banding every proposed row; applies the rows an exact rule covers when writes are on; and emails it all as `YYYY-Www Brief` with a numbered board on top. Named `retro` until 2026-10-19 (ATE-674), when the planning pass joined the retrospective. |
| [recruiter/](recruiter/README.md) | Retired (was Cloud Run) | Pulls the job boards with curl, runs the `recruiter` agent over the pulled listings so the week's sweep is done before the Tuesday work search block, upserts the judged rows into the Pinole work ledger and logs the sweep as an activity, and emails the board as `YYYY-Www Recruiter`; the ledger rows live in the API and never in the mail. Promoted 2026-09-11, retired 2026-11-02 with the unemployment claim: the job, its scheduler entry and its service account are deleted, and its Dockerfile is parked as `Dockerfile.retired` so promote skips it. |

**A third runner, the plumber, lives in the practice's own repository and is built with this tooling** ([A Runner in Another Repository](#a-runner-in-another-repository)), where it moved with its page, its agent and its tests on 2026-10-13 (ATE-656).

The runtime one pager (why Cloud Run over Routines, the service accounts and their secrets, the traps) lives in Eudy at `Admin/Tools/cloud-run.md`.

**Homebase keeps the machinery that runs any job, and everything a job knows about the Atelic business lives in the Atelic repo.** The scaffold, the mail, the renderer, the promote and the generic pulls are here. The funnel rules are not: the retro's HubSpot week is `plugins/atelic/scripts/lib/hubspot.mjs` in the Atelic repo, run from the checkout its entrypoint puts in place, so the runner and the manual commands there read one copy (ATE-656, 2026-10-13). No image here carries it, so a rule changed there is live on the retro's next run and promotes nothing here, and that run executes whatever the Atelic repo's main holds at that moment, unpinned. A runner that lives in that repository pins the rules it runs to its own image, through its `context` manifest.

**The brief is personal work that runs in the Atelic cloud project, on purpose** (Forni, 2026-10-13, ATE-656, when the recruiter ran there too). The compute is pennies and the job works, so a second project for them would be work with no gain. The brief reads the Atelic HubSpot only through the Atelic repo's own `week` command and keeps no funnel rule of its own.

**When a runner fires is written in one place.** For a runner with a `job.json` (the brief here, the plumber in the Atelic repo) that file states it and `bin/runner/apply-job <name>` makes the Cloud Scheduler entry match; for a runner without one the Scheduler entry is the only statement, and the command that reads it is in Eudy's `Admin/Tools/cloud-run.md`. A day or a clock copied into a README, a comment, an agent, or a skill is a second copy that drifts (ATE-649), so look it up when it matters and never write it down. One thing does depend on it: each runner's default week in `runner_init` (`runners/lib/runner.sh`) assumes the fire falls on the night before a week opens, so a move to another night is a scheduler change and a look at those defaults together.

## Where a Runner Runs

A runner is defined once and can be executed three ways. Which one it is in is never something the runner itself learns: whoever invokes it puts the secrets in the environment first, and `runners/lib/runner.sh` is deliberately pure with respect to that environment. It reads variables and writes files, and it never touches the Keychain, `~/.config`, or gcloud.

| Mode | Command | Secrets from |
|---|---|---|
| By hand | `bin/runner/run-local <name>` | `.env.local` if fetched, then this machine's Keychain |
| On a schedule, locally | `bin/runner/run-scheduled <name>`, from a LaunchAgent | the same |
| Production | Cloud Run Job, fired by Cloud Scheduler | Secret Manager, injected by the job |

**No runner is on a LaunchAgent right now**, and `launchagents/` is empty. The
pipeline runner was scheduled for one morning and unscheduled the same day
(2026-08-31): a pass then cost about $7.50, which is a real number to spend
every week whether or not the week needs it. The middle row is kept because
it is where a runner goes when the schedule earns its cost, and because it is
the only thing a plist has to name. Adding one back is a plist and nothing else.

**Who a runner reports to is a property of the runner**, so it may name its own
recipient in `~/.config/headless-report/recipient-<name>`, falling back to the
shared `recipient`. The brief is personal work and the outreach roster is Atelic
work, and they go to different mailboxes. The addresses stay in `~/.config`
rather than the repo, because homebase is public.

**Local is not a lesser Cloud Run.** It is where every runner lives before it is promoted, and where some of them stay. A runner that drives the local CLIs (`hs`, `gws`, `linear`, each authenticated on this machine and each resolving its identity from an `.account` marker) or that needs a real browser cannot be containerised without work that has to be decided rather than assumed. Such a runner ships no Dockerfile, `bin/runner/promote` refuses it by name, and its README says what promoting it would take. `pipeline/` was the example until 2026-09-15, when its CLI reads became API pulls in the entrypoint (the portal through the vaulted service key, the mailboxes and the One Pager through the vaulted Google tokens) and its browser walk moved out to the Tuesday block; it has a Dockerfile now and no live runner is local only. The parked recruiter has no Dockerfile either, but run-local refuses it rather than treating it as local (see its README).

The driver side, which does know it is on Forni's Mac, is `bin/runner/lib.sh`: the Keychain reads, the recipient file, and the PATH a local runner needs. That PATH is longer than it looks like it needs to be, and `runner_local_path` carries the reason.

## Iterate Locally, Then Promote

**Every change to a runner is developed and iterated on this machine first, and reaches production only once the local result is right.** Editing a routine by rebuilding an image, waiting on Cloud Build, firing the job, and reading the result out of a logging query is a four minute round trip for a one line change, and it puts every experiment into production and into an inbox. The local loops below are seconds, and nothing they do is visible to anyone.

Three loops, each answering a different question. Use the cheapest one that can answer yours.

| Loop | Command | Costs | Use it when |
|---|---|---|---|
| Render | `bin/runner/render-local <name>` | nothing, no network | changing how the email looks: the page in `runners/email/`, a table, the type, the palette |
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
# merge to main: Cloud Build builds it and the job points at it, unasked
bin/runner/fire <name>             # run production now and print its log
```

A browser preview is not the artifact. Gmail collapses styles, rewrites markup,
and renders on a phone, so `mail` is the last check before the merge: it sends
the exact rendered bytes through the same Resend sender the job uses. Its key
comes from the Keychain through `runner_local_credentials` in
`bin/runner/lib.sh`, never from the vault, because the vault copy belongs to
the container.

### A Merge to Main Is the Promote

**A merge to main promotes without asking** (Forni, 2026-09-30, ATE-608). A
promote by hand, a scheduler change, or any other deploy still takes his
explicit yes each time, and that includes starting the workflow by hand or
running a failed promote again.

`.github/workflows/promote.yml` runs on every push to main. It asks
`bin/runner/changed` which images the push changed and runs
`bin/runner/promote <name>` for each, the same script a hand promote uses, so
there is one path to production and not two. Each runner is built from the tip
of main as it is when its job starts, not from the commit that triggered the
run, so a run that starts late or is run again can only ever promote the
newest main and never an older one; the job summary names the commit built.

| A Change To | Promotes |
|---|---|
| `runners/lib/`, `runners/email/` | every runner with a Dockerfile, since both ship in every image |
| `runners/email/<name>.tsx` | the runner called `<name>` and no other, since a bundle carries its own runner's page |
| `bin/runner/promote`, `bin/runner/lib.sh` | every runner with a Dockerfile, since they decide what ships |
| `runners/<name>/`, its `agents` and `context` manifests included | that runner |
| `.claude/agents/<x>.md` | each runner whose `agents` manifest names `x` |
| a path a runner's `context` manifest names as a source, or its `agents` manifest brings an agent from | that runner |
| a runner's `README.md`, `mounts`, `out/`, `.build/`, `.env.local`, and the `email/tst/` of a runner that keeps its own page | nothing: none of them reaches an image |
| `runners/email/tst/`, `fixtures/`, `goldens/` | nothing: the image's first stage bundles `render.tsx` and what it imports, and copies only that file forward |
| anything else (this README, the other `bin/runner/` scripts) | nothing |

**None of this rebuilds a runner that lives in another repository** (Forni, 2026-10-13, ATE-656). Its image carries `runners/lib/`, the renderer and the Claude Code pin from here as well, but this workflow promotes only the runners in this tree, and that repository's workflow only sees its own pushes. So a fix here that such a runner should carry is finished only when that repository's Promote workflow has been run by hand on its main, which takes Forni's yes like any promote by hand. Until then that runner keeps firing an image built with the old tooling, beside a green run here.

The rules live in `bin/runner/changed` and nowhere else; the workflow carries
no path filter of its own. What a runner's directory keeps out of its image is
one list in `bin/runner/lib.sh` (`RUNNER_CONTEXT_EXCLUDES`), read by both the
staging and the rules, and one function there reads an `agents` manifest for
both. Runners and manifests are read from the tree at the pushed commit, so a
new runner's path rules apply the day its Dockerfile lands. Only a runner in
this repository is ever on the list: one that lives in another repository is
promoted by that repository's own workflow, which may ask this same script
about its own tree with `-C`
([A Runner in Another Repository](#a-runner-in-another-repository)). **Its Cloud Run
job does not: the workflow updates a job and never creates one**, so a brand
new runner needs its job created by hand once (with its service account,
secrets and schedule) before a merge can promote it, and until then its
promote fails red. A push with no usable starting point (a force push, a first
push) promotes every runner. `bin/lint/runner-changed-test` holds each row of
the table.

**Between the merge and the end of its Actions run, the old image still
fires.** A build takes a few minutes per runner, each runner is its own job,
and two promotes of one runner never overlap (the script ends by deleting
every other image, so the second waits for the first). Merge well ahead of a
schedule, or check the run before trusting a fire.

**A failure is loud and changes nothing.** The runner's job fails, the run
goes red, and GitHub's own failed workflow notice is the mail. The job summary
names each runner, whether it was promoted, and the digest the registry holds.
One runner failing does not stop the others. **A red promote is not retried
by a later push that leaves that runner alone**: the runner keeps firing the
image it already had until the workflow is run by hand on main for it, or the
next merge that changes it lands. The dispatch is the fix, and either way the
build is the newest main.

**By hand, with Forni's yes.** From the Actions tab, run the Promote workflow
on main and pick one runner or all of them, or from a clean checkout of main:

```bash
gh workflow run promote.yml --repo <owner>/homebase --ref main -f runner=all
bin/runner/promote <name>          # one runner, from this machine
```

A local promote builds from whatever is checked out, so it is also how an
image is built from a branch on purpose (`--dirty` for uncommitted work). The
next merge that touches that runner replaces it.

### The Deploy Identity

What the workflow runs as in Google Cloud, recorded here so it can be audited
or removed. **No key exists anywhere**: GitHub signs a token naming the
repository and the ref of the run, and Google trades it for an hour as the
service account, so there is nothing to store, rotate, or leak.

| Piece | Value |
|---|---|
| Service account | `runner-deployer@atelic.iam.gserviceaccount.com` |
| Roles on the project | `cloudbuild.builds.editor`, `run.developer`, `logging.viewer`, `serviceusage.serviceUsageConsumer`, `storage.bucketViewer` |
| Role on `gs://atelic_cloudbuild` | `storage.admin` (where Cloud Build takes the uploaded context) |
| Role on the `runners` repository | `artifactregistry.repoAdmin` (push the image, delete the earlier ones) |
| Role on the three runtime accounts and the compute default account | `iam.serviceAccountUser` (point a job at an image while it runs as its own account; build as the default one) |
| Workload identity pool and provider | `github` and `homebase`, issuer `https://token.actions.githubusercontent.com` |
| Provider resource | `projects/897452392033/locations/global/workloadIdentityPools/github/providers/homebase` |
| Attribute condition | pins the repository id, the owner id, and `refs/heads/main` |

The condition names the repository and its owner by their numeric ids and not
only by name, which is what makes a renamed or re registered repository name
useless: a name can be taken over, an id cannot. The condition is why the workflow has no `pull_request` trigger and must never
gain one: only a run on main of this repository can become the deploy
identity, and a pull request runs code nobody has merged. To remove the whole
thing, delete the provider (or the pool), then the service account, then the
workflow. Created 2026-10-07.

Two things the first real runs taught, both on 2026-10-07:

**The bucket viewer role is needed at the project, not only on the bucket.**
With `storage.admin` on `gs://atelic_cloudbuild` alone, `gcloud builds submit`
was forbidden from the bucket before it uploaded anything ("The user is
forbidden from accessing the bucket"). Before it writes, the command lists the
project's buckets to confirm the default staging bucket is the project's own,
and a grant on the bucket itself does not cover a listing of the project.
`storage.bucketViewer` on the project does, and it reads bucket metadata only,
never an object.

**The identity cannot read a build's log, and that is left as it is.** Cloud
Build writes the log to its default logs bucket, which only a project Viewer
or Owner may read, and Viewer is too broad for a deploy identity. gcloud's own
wait is tied to its log tail, so the second run built all three images and
then failed each promote with:

```text
ERROR: (gcloud.builds.submit)
The build is running, and logs are being written to the default logs bucket.
This tool can only stream logs if you are Viewer/Owner of the project and, if applicable, allowed by your VPC-SC security policy.
```

The builds had succeeded; the job update and the prune never ran.
`--suppress-logs` does not help, since it silences the output and the tail
still reads the bucket. So `bin/runner/promote` no longer lets gcloud wait:

- It submits the build without waiting, prints its id and console link, and
  takes the verdict from the build's status (`runner_build_wait` in
  `bin/runner/lib.sh`), which needs only the right to see the build. Only
  `SUCCESS` points a job at the image.
- The build writes its log to `gs://atelic_cloudbuild/logs`
  (`RUNNER_BUILD_LOG_DIR`), a bucket the deploy identity holds a role on, so
  the live log can be read by the workflow as well as by a person. Google's
  documentation names a logs bucket of your own as the route for a reader who
  is not a project Viewer (Storage Object Viewer on it is enough to read). For
  the account that writes, it asks for Storage Admin on the bucket unless the
  build runs as the legacy Cloud Build account. Builds here run as the compute
  default account, which holds `cloudbuild.builds.builder` on the project and
  through it `storage.objects.create`, and no role on the bucket itself. That
  should be enough to write a log and was not proven before this shipped, so
  if Cloud Build refuses the build with that log directory the script submits
  it once more with the default logs bucket and says so. Setting
  `RUNNER_BUILD_LOG_DIR` empty turns it off.
- The log is a courtesy beside the wait and never the verdict. The wait
  prints the build's status every thirty seconds either way, and when the log
  cannot be read the promote says so in one line.
- A build submitted this way outlives the script, so the script cancels it
  whenever it stops short of a verdict: Ctrl C, a cancelled workflow, an
  error, twenty minutes without an ending (`RUNNER_BUILD_DEADLINE`; builds
  take under two), or two minutes of status reads that all fail. A build left
  running would later move the tag behind the next promote.

`bin/lint/runner-build-test` holds the wait against a fake gcloud.

### The Commands

| Command | Role |
|---|---|
| `fetch-env <name>` | Writes `runners/<name>/.env.local` from the **deployed job's own** secret mapping, pulling each value from the vault. Run it once per machine, and again whenever a runner gains a secret. |
| `run-local <name>` | Runs the real `entrypoint.sh` against those real secrets, rendering the email into `out/` instead of sending. `--week` drafts another week, `--reuse` skips the pulls, `--send` actually delivers. A runner with no `.env.local` is fine and falls back to the Keychain. |
| `run-scheduled <name>` | The same execution path, sending for real and logging to `~/.claude/debug/runner-<name>.log`. This is what a LaunchAgent points at, and the only thing a plist needs to know is the runner's name. |
| `render-local <name>` | Pushes the saved `out/<name>.json` (or `out/result.json` for a runner with no draft) back through the node renderer with the shared design and the saved run's footer line. No network, no model. |
| `changed <base> <head>` | Prints the runners a diff between two commits affects, one per line; `--all` prints every runner with a Dockerfile. The promote workflow's only source of what to promote. |
| `promote <name>` | What a merge to main runs for each runner it changed, and what a hand promote runs. Cloud Build builds the image, the job is pointed at it, and promotion attempts to delete every earlier image of that runner from the registry (a failure here only warns; the promote itself has already succeeded). Refuses a dirty tree without `--dirty`. |
| `fire <name>` | Executes the job now and prints its log. `--week` is applied, used, and cleared again. |
| `mail <name>` | Mails whatever is rendered in `out/` to the production recipient, so a draft can be read in Gmail rather than a browser. Preview only; production sending stays in the runner. |

**Every command that takes `<name>` takes a path as well.** A bare name is `runners/<name>` here; anything with a slash in it is a path to a runner directory, absolute or relative to where the command is typed, and the runner's name is then that directory's own name, which is also what its Cloud Run job and its image are called. That is how a runner in another repository is run, rendered, and promoted with the commands above.

`out/` and `.env.local` are gitignored. `.env.local` is mode 600 and holds live credentials in plaintext: never commit it, never print it into a transcript.

### Two Things Worth Knowing

**The secret mapping is never written down twice.** `fetch-env` reads it back out of the deployed job rather than keeping a copy in the repo, so a local run cannot quietly become an older version of production. The cost is that a brand new runner has to be created in Cloud Run before its local loop works.

**The container's jq is older than yours.** The image is `node:24-slim` (ATE-565), still on Debian bookworm, which ships jq 1.6; a Homebrew mac is on 1.8. The scaffold still reads every result and every draft with jq, so an expression that compiles here can still fail in the cloud at the very last step, after every pull and the whole Claude call have been paid for. The trap that caught us on 2026-08-29 was `label`, a jq keyword that 1.8 tolerates as a `$label` parameter name and 1.6 rejects outright. Prefer plain names. The email itself is out of reach of this since the renderer became node (ATE-563), and the way to catch a renderer that only works here is a container run, `bin/runner/run-local <name>`, which builds the bundle the way the image does.

**A local run still rotates the real Strava token.** Strava invalidates a refresh token the moment it issues the next one, so a local run that pulls Strava has to write the new one back to the vault or the next cloud run cannot refresh at all. `entrypoint.sh` falls back to the operator's own gcloud credentials when there is no metadata server to ask. This is the one thing a local run changes in the outside world, and it is not optional.

## The Email

**Every runner that mails a page mails the same design, composed from `@atelic-action/ui/email`.** The design is Forni's "W38 Sweep Email" (Claude Design, 2026-09-11), made canonical the same day: cream ground (`#F6F1E7`), cards of paper (`#FDFBF6`) on a hairline (`#E6DFD2`) with a 14px radius, the atelic wordmark and one orange rule (`#FC4A1A`) at the top left with the runner's title beside them, monospace uppercase eyebrows, sans for everything read, and the accent reserved for the one value that matters on a row and the link underline. Every style is inline and every layout a table, for Gmail; disclosures fold in Apple Mail and open flat in Gmail, which is the designed fallback.

A runner's page (`runners/email/<name>.tsx`) composes what the package exports: `renderEmail` (the shell and the inbox preheader), `Masthead` (the wordmark and the runner's title), `TitleCard` (eyebrow, one to three headline lines, a lede, and a `StatsRow` of `Stat` cells), `Eyebrow` between cards, `Card` around rows, `Item` (the workhorse row: name, the accent value on the right, a subline of facts, a body, an optional fold, an optional link), `Note` (a short text under a small eyebrow), `Row` for any block inside a card, `BigFold` inside a `FoldRow` for the long tail, `List` with `LeadRow`, `MonoTable` for rows the reader copies, and `Footer` for the run's one line of facts. `renderFailureEmail` mails a bad run in the same cream. The scaffold's `runner_render` passes the week, its Monday and Sunday, and `$meta`, and `bin/runner/render-local` passes the same. A new kind of row is a new component in the `ui` package, so the next runner gets it too; a runner never carries a palette or a frame of its own. `runners/email/recruiter.tsx` is the reference composition and `retro.tsx` shows a draft with several kinds of row. The jq library the pages were first written against retired on 2026-09-22 (ATE-563) and is in git history at `4985f1a9`.

## The Renderer

**The page is rendered by `runners/email/`, a small node project that carries the runner pages as React and bundles each one, with the failure page, into a CommonJS file of its own.** The design itself is no longer written here: it is `@atelic-action/ui/email`, the shared component library every Atelic surface draws from, pinned to an exact version in `runners/email/package.json`. It is the only renderer in the tree and in every image: the jq one it replaced retired on 2026-09-22 (ATE-563), once the recruiter and the retro had each come back clean on the node path from Cloud Run, so a renderer that cannot start is now a failed run rather than a plainer email.

**A bundle carries one runner's page and no other** (ATE-656, 2026-10-13). `render.tsx` is the command line and the failure page, and it imports its page as `runner-page`, a name no file has: the build points it at `<name>.tsx` for the runner being built and tells the bundle that name. So the retro's image holds the retro's page, a change to one page promotes one runner, and a page can live with its runner in another repository. The command line did not change (`node render.cjs <name> <html|text> --week ...`, and `node render.cjs failure html ...`), and a bundle asked for a page it does not carry answers the way it answers any name it does not know, in one line: `render: unknown runner "recruiter"; one of retro, failure`. A page is `<name>.tsx` beside `render.tsx`, and what makes it a page is one export, `page`, an object with an `html` and a `text` function.

The build is `build.mjs`, one esbuild call per runner, and it is CommonJS on purpose:

```bash
RUNNER=brief npm run build          # writes dist/render-brief.cjs
node build.mjs brief recruiter      # several at once, which is what the tests do
```

It is the esbuild call it always was (`--bundle --platform=node --format=cjs --target=node24 --jsx=automatic`, production React, `--minify-syntax`) with two additions: the alias from `runner-page` to the page, and the runner's name defined as `RUNNER_NAME`. With no runner named it stops and says so.

**Do not switch the format to ESM.** It was tried under `node:20-slim` on node 20.20.2 and the bundle died at startup with `Dynamic require of util is not supported`: React's server renderer reaches for a CommonJS require that an ESM bundle cannot answer. CommonJS runs. Every image builds its own runner's bundle in a first stage (`FROM node:24-slim AS email`, `npm ci`, `RUNNER=<name> npm run build`) and copies exactly one file forward, `dist/render-<name>.cjs` to `/home/runner/lib/render.cjs`, so the final image gains no `node_modules` and the scaffold finds the bundle under the plain name it always looked for.

**On this machine there is a bundle per runner, `runners/email/dist/render-<name>.cjs`,** which is where the scaffold looks second. `runner_email_bundle` in `bin/runner/lib.sh` builds it when it is missing, older than any source, or built for another directory of the same name (the directory is written beside the bundle), and `render-local` and a host run both ask it first. One file for every runner would be the last runner's page, and the next one to render would be told its page is unknown.

**When the renderer cannot start.** The scaffold looks for the bundle beside the shared library and then in the repo's own build for this runner, and when it is missing, exits non zero, or writes an empty file, it says so on one loud `RENDERER:` line and fails the run, which mails the failure page. That page is the one thing with a fallback left: it renders through the same bundle (`render.cjs failure html`, the log's tail on stdin) and drops to a bare `<pre>` if even that cannot run, because it mails at the moment everything else is already broken.

**A layout change is three steps, in order.** Change the component in the `ui` repo and release it; bump the exact pin in `runners/email/package.json` and commit the lockfile that moves with it; then merge, which promotes every runner because `runners/email/` ships in all of them, so each image carries the new bundle. Nothing about the email design is edited in this repo any more.

**Parity, before any of that lands.** Render the same draft before and after the change and compare the parsed documents, which is how a `ui` bump is held to the layout it claims to leave alone:

```bash
bin/runner/render-local brief --no-open && cp runners/brief/out/email.html /tmp/before.html
# bump the pin, npm ci, then render again
bin/runner/render-local brief --no-open
node runners/email/parity.mjs runners/brief/out/email.html /tmp/before.html
```

`parity.mjs` exits 0 only when the two parse to the same canonical tree and prints the first difference with its path otherwise; it ignores what only the markup differs on, which is what made it the check against the jq renderer this one replaced. For a change where the pixels are the question, screenshot both files at 800 and at 390 wide and compare them with `magick compare -metric AE`; zero at both widths is the bar the port was held to. `npm --prefix runners/email test` is the standing version of the same check: four invented fixtures, html and text, each frozen as a golden that has to match byte for byte. It builds each runner's bundle first, the way that runner's image does, and every render goes through the built file. A page that lives with its runner in another repository keeps its fixtures, its goldens and its tests there.

## Adding a Runner

A runner is three things of its own: its pulls, its prompt, and its renderer. Everything else comes from the scaffold in `runners/lib/runner.sh` and the pull script beside it (`text.mjs`, a page to text with its links kept), which ship into every image as `lib/` and are reached from an entrypoint as `$LIB_DIR/<script>`. Neither has a test of its own today; the funnel rules whose tests used to sit beside `lib/` left for the Atelic repo with ATE-656 and are tested by its CI. A test written for a script there sits outside `lib/`, never inside it, because a directory inside it breaks the flat copy. What a runner knows about the business is not among them: it is read from the Atelic checkout at run time (`runner_checkout` in `runner.sh` puts a repository in place, a present checkout used as it is and an absent one cloned over its read only deploy key). So a new runner directory is `entrypoint.sh` (executable), `prompt.md`, a page in `runners/email/` named for the runner (`<name>.tsx`, exporting `page`), and a `README.md`, plus a `Dockerfile` when it is meant for Cloud Run (copy `runners/brief/Dockerfile`: it installs the pinned Claude Code, builds the runner's own bundle, and copies `lib/` in), an `agents` file naming any agent definition it runs, a `context` file for anything else its image needs from its repository, and `mounts` for what a local container run needs from this machine.

The entrypoint's shape, which every runner shares:

```bash
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for candidate in "$SELF_DIR/lib/runner.sh" "$SELF_DIR/../lib/runner.sh"; do   # beside it in an image, one up in the repo
# a runner in another repository tries ${RUNNER_LIB_DIR:+"$RUNNER_LIB_DIR/runner.sh"} between those two
    [[ -r "$candidate" ]] && { . "$candidate"; RUNNER_LIB="$candidate"; break; }
done

runner_init brief "Brief" previous    # the directory name, the title a reader sees, current or previous week by default
require CLAUDE_CODE_OAUTH_TOKEN ... || exit 1
require_tools claude jq curl ... || exit 1

if [[ "$SKIP_PULLS" == "1" ]]; then check the cached files are there; else pull them into $WORK; fi

runner_probe_write --agent <name> --allowedTools "${ALLOWED_TOOLS[@]}" || exit 1   # only when the agent writes files
runner_claude "$(fill_prompt "$PROMPT_FILE")" --model sonnet --allowedTools Read || exit 1
runner_draft '(.headline | type == "array") and (.rows | type == "array")' || exit 1
runner_render || exit 1
status="success"
```

What each call does: `runner_init` makes the work directory and the log (stdout and stderr are tee'd into it from there), validates the week and sets `WEEK`, `MONDAY`, `SUNDAY` and `NEXT_MONDAY`, names every file (`RESULT_JSON`, `RESULT_RC`, `DRAFT_JSON` as `$WORK/<name>.json`, `REPORT_HTML` as `$WORK/email.html`), sets `SUBJECT` to `"$WEEK <Title>"`, and traps `runner_finish` on exit, which mails the page (with `ATTACHMENT` beside it if the runner set one) or the failure page (with the model's draft beside it, or the raw result when no draft was cut, so a run that failed after the model answered can be replayed without paying for it again), or on a dry run prints where the page is. `fill_prompt` fills `{{WEEK}}`, `{{MONDAY}}`, `{{SUNDAY}}`, `{{NEXT_MONDAY}}`, `{{TODAY}}`, `{{WORK}}`, and `{{EUDY}}`, `{{PULLS}}` or `{{ATELIC}}` when set. `runner_probe_write` is the cheap short circuit every runner whose agent writes files runs before the real call (Forni, 2026-09-15): a one line Haiku call with the same agent and allowlist, asked only to write a marker into the work directory, about half a cent, so a permission problem fails there rather than after a whole run is drafted (the first two pipeline runs in their image cost 17 USD to learn that a path scoped `Write` rule is denied in every form and the bare `Write` is the one that works). `runner_claude` makes the one headless call with the retry a long session needs (a timeout or a transient API error gets one more attempt), saves the result and its exit status for replay, and checks it is exit zero, JSON, and a completed turn. `runner_replay` puts a saved result back through the same checks, for a runner whose only pull is the agent. `runner_draft` cuts the object out of the result and holds it to the shape the renderer reads. `runner_render` runs the node renderer with the shared design, the week, and the footer line. `require` and `require_tools` fail the run at the top rather than three pulls in; `send_email`, `html_escape`, `meta_line` and the GNU versus BSD date shims are there for anything else.

Two conventions the flags rely on: `DRY_RUN=1` renders and never sends, and `SKIP_PULLS=1` reuses what is already in `$WORK` (the pulled files, for a runner that pulls; the saved result, for one that only runs an agent), since those two are the whole local loop. Every artifact name above is what `run-local`, `render-local` and `mail` look for, so a runner that uses the scaffold gets all three loops without doing anything. The entrypoint finds its siblings relative to itself rather than at an absolute container path, so it runs unchanged wherever it is. The one thing a runner in another repository cannot find that way is this library on a host run, so `runner_execute` exports `RUNNER_LIB_DIR`, this repository's `runners/lib`, for every runner alike, and such an entrypoint tries `$RUNNER_LIB_DIR/runner.sh` after the copy its image holds. `LIB_DIR` is then that directory, so `text.mjs` and the runner's own bundle are found the way they are for a runner here; a pull that is the runner's alone sits beside its entrypoint and is reached as `$SELF_DIR/<script>`.

**An image is built from a staged context, never from the directory itself.** A Docker context cannot reach above its root, and neither can the tarball Cloud Build uploads, so `bin/runner/lib.sh` assembles `.build/` in the runner's directory fresh for every build: the runner's files, `lib/` and `email/` from this repository, `agents/<name>.md` for each agent its `agents` file names, and whatever its `context` file adds. The Dockerfile copies from those paths (`lib/runner.sh` to where the entrypoint looks first, an agent to `/home/runner/.claude/agents/`). The files that drive the staging, none of which ships itself:

| File | One Line Is | What It Does |
|---|---|---|
| `agents` | `name` | stages `.claude/agents/<name>.md` from this repository as `agents/<name>.md` |
| `agents` | `name=path` | stages the runner's own definition at `path`, relative to the runner's directory, as `agents/<name>.md` |
| `context` | `source:dest` | copies a file or a directory at `source`, relative to the runner's directory, to `dest` in the staged context |
| `mounts` | `host:container[:ro]` | mounts a host path into a local container run, `$HOME` expanded, which is how a checkout stands in for a deploy key clone on this machine |

Blank lines and lines that open with `#` are skipped in all three. A path in `agents` or `context` may reach up with `..`, since what a runner ships can sit elsewhere in its own repository, and it is refused the moment it resolves outside that repository, through a symlink or otherwise: a manifest that could name any file on the machine would put it in an image. A file that git ignores is refused too, as a `context` source or as an agent by path, and so is a `context` folder that git ignores, itself or through a folder above it (a gitignored clone is the likely one): promote's dirty gate asks git about every source, git says nothing about an ignored path, and so one would ship from a tree the gate had called clean. The ignored contents of a folder git can see (an install, a build) are that folder's own business. A `context` dest has to stay inside the staged context and has to be free, so a line can add to `lib/` and can never replace a file of it. A runner may also keep an `email/` folder of its own, whose files are staged beside the shared renderer's as though they had been written there; a file that shares a name with one of the renderer's is refused. `.dockerignore` keeps `.env.local` and `out/` out of the context. `runners/recruiter/` was the example in this repository, and it uses `agents` and `mounts`; it is parked now (see its README), so read it as a reference rather than a staged build.

### A Runner in Another Repository

**A runner does not have to live here.** This repository keeps the machinery that runs any job, and a job whose every file is one business's own (its pulls, its prompt, its page, its agent, the rules it runs) belongs in that business's repository, where this public one never sees it. Such a runner is a directory there with the same files as a runner here, and that repository's workflow checks this one out at the tip of main and runs the same commands against its own directory:

```bash
<homebase>/bin/runner/run-local runners/<name> --reuse    # from the other repository's root
<homebase>/bin/runner/render-local ./runners/<name>
<homebase>/bin/runner/promote "$PWD/runners/<name>"
```

What comes from where:

| Piece | Comes From |
|---|---|
| `lib/` (the scaffold and the generic pulls) | this repository's `runners/lib/`, always |
| the renderer (`render.tsx`, `build.mjs`, the helpers, the pinned `ui` package) | this repository's `runners/email/`, always |
| the page | the runner's own `email/<name>.tsx`, with any helper files beside it; it imports `./jq`, `./local`, `./text`, `./types` and `./records` as though it sat in `runners/email/` |
| an agent | this repository's `.claude/agents/` for a bare name in `agents`, the runner's own repository for a `name=path` line |
| anything else the image needs | the runner's own repository, through `context` |

The Dockerfile is written against the staged context exactly as one here is, so `COPY lib/`, `COPY email/` and `RUN npm ci && RUNNER=<name> npm run build` read the same, and a `context` line such as `../../plugins/<plugin>/scripts/lib:rules` is how business code elsewhere in that repository reaches the image, pinned to the commit the image was built from.

Three things are that repository's to carry, since nothing here reaches it. Its `.gitignore` has to keep `out/`, `.build/` and `.env.local` out of its history. Its workflow decides when to promote. It can ask `bin/runner/changed -C <its checkout> <before> <after>`, which reads that repository's own `runners/<name>/` tree and manifests and answers for it as it does for this one; what no workflow there can see is a push here, so a change here to `runners/lib/` or `runners/email/` promotes nothing there until that workflow runs again. And its deploy identity is its own, because the one described above is pinned to this repository and no other can become it. The promote's dirty gate asks both repositories: the shared directories here, and in the runner's repository its directory and every path its manifests name.

The two workflows cannot serialise against each other, since a concurrency group holds within one repository: a runner of one name must never exist in both, or two promotes could prune each other's images.

`bin/lint/runner-outside-test` holds all of it against a throwaway repository with an invented runner: the path resolution, what is staged and from where, every refusal above, and the page built into a bundle of its own.
