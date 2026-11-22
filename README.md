# Homebase

Personal development environment: shell configs, Claude Code skills, dev tooling, and workstation setup.

Homebase is where every dotfile and configuration file lives so it can be iterated on in one place and shared across machines through `./setup.sh`. It is public; [Eudaimonia](https://github.com/mattforni/Eudaimonia), the personal library, is private and loads this repo's `CLAUDE.md` through the `~/CLAUDE.md` link the deploy table creates, which is how the workstation conventions reach every Claude Code session. Depth that only matters when a particular file is being edited lives in path scoped rules under `.claude/rules/`, so the always loaded file stays short.

## Claude Code Marketplaces

Homebase hosts two plugin marketplaces.

### skillset (public)

Curated, single purpose plugins for development workflows. Hosted at the repo root (`.claude-plugin/marketplace.json`).

```bash
claude plugin marketplace add mattforni/homebase
claude plugin install sdlc@skillset
```

| Plugin | Description |
|--------|-------------|
| [sdlc](plugins/sdlc/) | Plan, design, review, land, groom issues. See [docs/plugins/sdlc.md](docs/plugins/sdlc.md). |

> Migrating from `mattforni/skillset`? That repo is deprecated. Run `claude plugin marketplace remove skillset` then re add from `mattforni/homebase`.

#### Per clone config

The review gate is `~/bin/review/run <worktree>`, run locally on the branch, and it needs no configuration; the rules live in [plugins/sdlc/reference/code-review.md](plugins/sdlc/reference/code-review.md). `git config sdlc.review-command` only feeds the **public repo fallback**: the trigger comment `sdlc:review` posts so the PR bot takes a second look, which is worth having here because homebase is public and the free Open Source plan reviews properly on it. Nothing waits on that trigger. The plugin default is `/gemini review`, which is dead since Google sunset the consumer app, so `setup.sh` sets the local config automatically, or you can run it by hand:

```bash
git config sdlc.review-command "@coderabbitai review"
```

### local-skills (private)

Personal productivity skills. Lives under [.claude/local-skills](.claude/local-skills/) and is added as a local `directory` source only. Not installable via GitHub.

| Plugin | Description |
|--------|-------------|
| [assist](.claude/local-skills/plugins/assist/) | Emails, schedule, codify, sharpen, BD, job apply, meals. |

## Call Back

A Claude Code session can call the user back out loud: two Glass chimes, then a spoken line. macOS only; elsewhere it does nothing.

- **By hand.** `~/bin/call/back [--quiet-chime] <message>` rings once. Claude runs it when it is blocked on a decision that is the user's, or something broke that should not wait, and the user is away. `--dry-run` prints what it would do and makes no sound.
- **On a timer.** `.claude/hooks/call-back.sh` arms when a turn ends with a question (the final non empty line of Claude's last message ends in `?`) or Claude opens an `AskUserQuestion` dialog. If the user has not typed or answered five minutes later, it says "`<project>` is waiting on you." once per question. A turn that ends in a plain report never arms, and leaves an open question armed, so a background agent reporting in the meantime does not cancel it; a new question restarts the five minutes. Only the user disarms it: a prompt they typed, an answered dialog, or the session ending. Prompts nobody typed (background task and agent reports, messages from other sessions, teammates, channels, `/loop` and scheduled task firings) leave it armed. Subagents, `claude -p` runs, SDK hosts, cloud sessions, and stop hook continuations never arm. `CALL_BACK_AFTER_SECONDS` changes the five minutes.
- **Silencing it.** `touch ~/.claude/call-back.off` silences both until the file is removed, timers already running included. Stamps and `rings.log` (one line per ring) live in `~/.claude/call-back/` and are pruned after a day.

The hooks take effect once `.claude/settings.json` reaches `~/.claude/settings.json`, which the session start reconcile does on the first session after the change lands on `main`; `~/bin` and `~/.claude/hooks` are links, so the scripts are live as soon as `main` carries them.
