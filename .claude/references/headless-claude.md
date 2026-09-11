# Headless Claude on macOS

Build recurring `claude -p` automations that run on launchd, survive sleep, auth
from Keychain, and fail visibly. Based on the 2026-04-23 implementation of
L7 mise; see Eudy's `LEVELS.md` for the story.

**A scheduled routine is a runner, and this file is the macOS half of how one
is executed.** `runners/README.md` owns the pattern itself and is the place to
start; this one carries what is specific to launchd, the Keychain, and
`claude -p`. The worked example is
[`runners/outreach/`](../../runners/outreach/README.md), which is run by hand
through `bin/runner/run-local`.

**Nothing is on a LaunchAgent right now and `launchagents/` is empty.** The
outreach runner was scheduled for one morning and unscheduled the same day
(2026-08-31), because a pass is about $7.50 and a weekly timer spends that
whether or not the week needs it. The machinery below is intact and a plist is
all it takes to schedule something; the point is that a schedule is a cost
decision, and an agent priced like this earns its timer or does not get one.

**Removing a plist from `launchagents/` does not undeploy it.** `setup.sh`
renders and bootstraps every plist it finds and prunes none, unlike the deploy
table's reconciler, so a machine that already has one keeps firing it. Bootout
and delete the rendered copy by hand:

    launchctl bootout gui/$(id -u)/<label>
    rm ~/Library/LaunchAgents/<label>.plist

**There is no per routine wrapper script any more** (2026-08-31). `bin/run-mise`
was pruned 2026-07-23 and `bin/run-outreacher` followed, roughly three hundred
lines that reimplemented what an entrypoint plus `runners/lib/runner.sh` gives
for free. What replaced it is one generic command taking a runner's name. Two
copies of the Resend send and two of `html_escape` went with it.

**Local execution is not a lesser Cloud Run.** It is where every runner lives
before it is promoted, and where some stay: a runner reading through the local
CLIs (`hs`, `gws`, `linear`, each resolving its identity from an `.account`
marker) or needing a real browser cannot be containerised without work that has
to be decided rather than assumed. Cloud scheduling drawing credentials from the
Secret Manager vault (`~/Eudaimonia/Admin/Tools/secret-manager.md`) is the
direction for routines whose credentials can leave the machine.

**Running an agent, not a skill.** `claude -p "<prompt>" --agent <name>`
makes a user level agent definition (`~/.claude/agents/<name>.md`) the main
thread, model and all, so a routine can share one definition with the
interactive `Agent` tool instead of carrying a skill copy. The agent's own
prose has to enforce the single command rule below, because the allowlist
cannot.

## When to use this pattern

Recurring tasks on a predictable schedule that do not need human judgment each
run: morning syncs, weekly triage, nightly build checks.

## When NOT to use it

- **CronCreate / /loop / /schedule**: session only. Fires only while a Claude
  REPL is live and idle; auto expires after 7 days. Useful for in session
  reminders, not daily routines. See sharpen skill's `learned-rules.md`.
- **pmset schedule wake**: forces the laptop awake at a specific time. Burns
  battery and disrupts sleep. Usually overkill for morning prep.

## The three pieces

1. **LaunchAgent plist** at `~/Library/LaunchAgents/com.<user>.<label>.plist`,
   rendered from `launchagents/` by `setup.sh`
2. **The runner** at `runners/<name>/entrypoint.sh`, executed by
   `bin/runner/run-scheduled <name>`
3. **OAuth token in Keychain** (or gitignored file as fallback)

### LaunchAgent

`StartCalendarInterval` fires at the scheduled time. If the Mac is asleep at
fire time, launchd catches up on next wake (one catch up per missed window).
`RunAtLoad: false` so `launchctl bootstrap` does not fire the job immediately.

Plists do not expand `$HOME` or `~`. Template with placeholders and substitute
at install time:

    <string>{{HOME}}/bin/runner/run-scheduled</string>
    <string><runner-name></string>

Install flow (in your setup script):

- `sed "s|{{HOME}}|$HOME|g" template.plist > ~/Library/LaunchAgents/<label>.plist`
- `launchctl bootout gui/<uid>/<label>` if already loaded
- `launchctl bootstrap gui/<uid> <rendered-plist>`
- Skip the bootout+bootstrap cycle if the rendered content is unchanged AND
  the agent is already loaded, else every setup run kills an in flight job.

### The runner

`bin/runner/run-scheduled <name>` is everything a plist points at. It sets the
PATH, fills the environment from this machine's vaults, runs
`runners/<name>/entrypoint.sh`, and appends to
`~/.claude/debug/runner-<name>.log`. Write the routine as an entrypoint; do not
write a wrapper.

The split that makes one entrypoint run in three places is worth stating
plainly, because breaking it is the easy mistake:

- **`runners/lib/runner.sh` is pure with respect to the environment.** It reads
  variables and writes files. No Keychain, no `~/.config`, no gcloud. An
  entrypoint never learns which of the three modes it is in.
- **`bin/runner/lib.sh` is the half that knows it is on Forni's Mac.** The
  Keychain reads, the recipient file, and the PATH. Cloud Run reaches none of
  it, because there the same variables arrive from Secret Manager instead.

**The PATH is longer than it looks like it needs to be, and it is stated in two
places that cannot read each other**: `runner_local_path` in `bin/runner/lib.sh`
and the plist's own `EnvironmentVariables`. Keep them identical.

    $HOME/bin:$HOME/.local/bin:$HOME/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin

`$HOME/bin` carries the `gws` and `hs` shims and has to win, the same precedence
`.zshrc` finalizes with. `$HOME/.local/share/mise/shims` is how a non
interactive shell reaches what `mise activate` wires for an interactive one, and
the real `hs` lives there as an npm global under mise managed node. The
Outreacher shipped with neither and every Monday run died in preflight on `hs
not on PATH` (2026-08-31); fixing only the first would have found the shim and
then failed one layer down. launchd starts a job with an empty environment and
never sources a shell, so none of this can be inherited.

### Auth via Keychain

One time setup (interactive): `claude setup-token` opens a browser for OAuth
and prints a long lived token. Store it:

    security add-generic-password -a "$USER" -s "<service-name>" -w "<token>" -T /usr/bin/security -U

Flags:

- `-T /usr/bin/security` restricts ACL to the `security` CLI. Prefer over
  `-A` (any app) per the 2026-04-23 Gemini review on Eudy PR #19.
- `-U` updates in place so the item is not briefly deleted.

`runner_local_credentials` in `bin/runner/lib.sh` does the retrieval, and only
ever fills a gap: anything already exported wins, so a `.env.local` fetched from
a deployed job keeps production parity and a command line override always
survives. It reads `claude-code-oauth` and `resend-api-key`, falling back to a
gitignored `~/.claude/.oauth-token` for environments without a Keychain.

Missing credentials are not fatal there. What a run needs depends on what it
will do, and the entrypoint's own `require` is what knows; failing in the driver
would make a dry run over cached results impossible.

## Permissions: --allowedTools over --dangerously-skip-permissions

Pre allow only the tools the skill actually needs. `claude --help` documents
the example `"Bash(git *) Edit"` so `Bash(pattern)` syntax is supported.

Known valid tool names: `Read`, `Edit`, `Write`, `Bash`, `Skill`. `SlashCommand`
is unverified (as of 2026-04-23) but harmless to include while uncertain.

Verify the allowlist covers everything by checking `permission_denials` in the
JSON output; an empty array means the list was sufficient.

Note: even with `--dangerously-skip-permissions`, writes to `.claude/`, `.git/`,
`.vscode/`, `.idea/`, `.husky/` still prompt. For a true no prompt run in those
paths, use `--allowedTools` with explicit patterns instead.

**Compound shell commands cannot be allowlisted.** A `Bash(git:*)` entry matches
only a single bare `git ...` invocation. A multi-statement command (a `for`
loop, piped commands, `cmd1 && cmd2`, anything with shell control flow) matches
no single-prefix entry and is denied every run, even when each inner command
would be allowed on its own. When a skill needs mechanical multi-step shell in a
headless run, extract it into a committed script and allowlist that one path
(e.g. `Bash(./bin/sync-marketplaces:*)`). Bonus: far fewer model turns spent
authoring loops, which shrinks the window for a transient API/socket drop. The
mise marketplace-sync step thrashed on denied loops for a week before this fix
(PR #109, 2026-06-09).

## Success detection

Exit code alone is not enough. `claude -p "/unknown:skill"` returns 0 with
"Unknown skill" as text output. Require positive confirmation via JSON:

    jq -e '.subtype == "success" and .is_error == false and ((.result // "") | contains("<expected>"))'

Where `<expected>` is the distinctive success string the skill emits.

## Gotchas

- **Two claude binaries**: `~/.local/bin/claude` (user install, has plugins)
  vs `/opt/homebrew/bin/claude` (brew, lacks plugin context). Put
  `$HOME/.local/bin` first in PATH or skills resolve to "Unknown skill".
- **Do not merge stderr into stdout** when capturing JSON. `claude -p ...
  --output-format json 2>&1` corrupts the JSON with any stderr byte, and `jq`
  silently fails via `// empty`. Redirect stderr to the surrounding log block.
- **Keychain must be unlocked**. Works on wake for the logged in user on a
  personal machine. Locked keychain (e.g., separate lockdown policy) breaks
  the flow.
- **`id -u` via subshell in bash `local`**: `local var="$(id -u)"` masks the
  return value (ShellCheck SC2155). Split declare and assign.
- **Transient API/socket drops on long runs**: `claude -p` can die mid-stream
  with `API Error: The socket connection was closed unexpectedly` and exit
  non-zero, especially on long sessions. Wrap the invocation in a `timeout` with
  a single retry on a transient signature (`socket connection was closed|API
  Error|overloaded|Connection error`); a clean skill-level abort (e.g. a merge
  conflict) should not match and should report immediately. Idempotent routines
  are safe to retry. Reference impl: `bin/run-mise` in git history (PR #109,
  2026-06-09; pruned 2026-07-23).
- **A headless call resolves the model from wherever it runs.** With no
  `--model`, `claude -p` takes the model and effort from the config dir it
  finds: the laptop's `~/.claude/settings.json` (Opus at high effort) on the
  host, a bare default (the current Sonnet on this token) in a container. The
  same retro draft cost 2.17 USD one way and 0.28 the other with the context
  load about equal, roughly 35K to 44K tokens of Claude Code's own system
  prompt either way (ATE-521, 2026-09-11). Name the model in the invocation,
  and rehearse a containerised routine in its container (`bin/runner/run-local`
  does this by default for a runner with a Dockerfile).

## Email reporting via Resend

macOS notifications are best effort: silenced by Focus, get truncated, and
have no click through to a record. Treat them as a redundant fallback, not
the source of truth. The source of truth is an email per run.

Shared library: `runners/lib/runner.sh`, sourced by every entrypoint. It holds
one `send_email` and the three builders that assemble a status email
(`build_summary_block`, `build_meta_block`, `build_report_html`), so a runner
whose email is a report on an agent run writes no HTML of its own. A runner
that renders its own document, like the retro, builds its body with a renderer
and never calls the builders.

`bin/lib/email-report.sh` was the previous home and was deleted 2026-08-31: it
and `runners/retro/entrypoint.sh` had each grown a Resend send, and two senders
is one too many.

Reads, all from the environment, because the library is not allowed to know
whether it is on this Mac or in a container:

- `RESEND_API_KEY`. Locally `runner_local_credentials` fills it from the
  Keychain (service `resend-api-key`, sending only scope); in Cloud Run it
  arrives from Secret Manager.
- `REPORT_RECIPIENT`. Locally from `~/.config/headless-report/recipient-<name>`
  if the runner has one, otherwise the shared `recipient`. Who a runner reports
  to is a property of the runner and not of the machine: the retro is personal
  and goes to the Gmail account, the outreach roster is Atelic work and goes to
  `matt@atelic.me`. The addresses live in `~/.config` rather than the repo
  because homebase is public.
- `REPORT_SENDER`, defaulting to `Claude <claude@atelic.me>`.

Output:

- **A weekly runner subjects its email `YYYY-Www <Name>`**, which is what both
  live runners do: `2026-W36 Retro` and `2026-W36 Outreach`. A weekly briefing
  is read on the morning it lands, so the week is the handle worth carrying and
  the send date is noise.
- **A daily status routine uses `[<Routine>] YYYY-MM-DD` instead**, and the
  bracketed tag is load bearing (2026-07-17): Gmail filters archive report mail
  by subject tag while interactive <claude@atelic.me> mail (review asks,
  anything needing action) stays in the inbox. That is precisely why the weekly
  briefings drop it, since they are meant to be read rather than filed. When
  adding a daily routine, add its `[Tag]` to the archive filter's subject
  terms, and never give an interactive email a bracketed subject prefix. Full
  convention: `~/Eudaimonia/Admin/Tools/resend.md`.
- Body: status heading, optional reason note, `<pre>` block with the
  skill's `.result` text (HTML escaped), metadata table (duration, cost,
  turns, exit code, session id).
- On any failure (missing key, missing recipient, curl error, a Resend HTTP
  status outside the 200s): `send_email` prints the reason and returns non zero. Treat a failed
  delivery as a failed run and exit non zero, since at 06:00 the log is the only
  place left that could show it.

Tool entry: `Eudy/Admin/Tools/resend.md` for vendor context, alternatives
considered, and pricing. JSON payload assembled via `jq -n --arg ...` to
dodge bash escaping pitfalls; HTML escaping via `sed`.

Adding a new headless routine: read `runners/README.md`, copy the shape of
`runners/outreach/entrypoint.sh`, and add a plist pointing at
`bin/runner/run-scheduled <name>`. Swap the subject, the success predicate, the
`--allowedTools` set, and what the runner actually does. Everything else,
including the whole email path, comes from `runners/lib/runner.sh`.

## Reference

- `claude --help` for current flag list
- `launchd.plist(5)` and `security(1)` man pages
- L7 mise source: homebase git history (`bin/run-mise` pruned 2026-07-23;
  the mise plist retired 2026-07-16). The generic `install_launchagents`
  phase remains in `setup.sh` for future plists.
- Resend API: <https://resend.com/docs/api-reference/emails/send-email>
