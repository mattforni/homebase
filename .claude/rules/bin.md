---
paths:
  - "bin/**"
  - ".githooks/**"
  - ".github/workflows/**"
---

# bin/ Scripts and the Lint Gates

Loaded when a script, the git hooks, or the CI workflow is read.

## bin/ Script Conventions

New scripts live in a namespace folder named for their tool or domain, with verb noun filenames: `bin/vault/push-secrets`, `bin/vault/push-gws-secrets`. Because `~/bin` is a single symlink to the repo's `bin/`, nested folders deploy with no extra plumbing. Legacy flat scripts (`checkout-branch.sh`, `sync-marketplaces`) migrate into namespaces opportunistically when next touched.

**Flat files are shims; directories are namespaces.** A shim shadows a real binary of the same name on PATH (`bin/gws`, `bin/hs`, `bin/ynab`), so it has to be a flat executable sitting directly in `bin/` where PATH lookup finds it. Everything else goes in a namespace folder. The two collide the moment a tool needs both, and the shim wins the bare name: `bin/gws/push-secrets` moved to `bin/vault/push-gws-secrets` on 2026-08-07 to free `bin/gws` for the profile shim, which also consolidated the two secret pushers under one namespace. When adding a shim, check that `bin/<tool>` is not already a directory, and remember a directory is also `-x`, so any "find the real binary on PATH" loop needs a `! -d` guard or it will happily try to exec the folder.

**Shared logic lives in `bin/lib/`, sourced rather than duplicated.** `bin/lib/account-profile.sh` is the single implementation of `.account` marker parsing and profile resolution, sourced by `bin/gws`, `bin/hs` and `.functions`. It exists because three copies drifted: a path traversal fix on 2026-08-07 had to be written three separate times and the third copy, in the since retired `bin/claude` wrapper, was missed twice before review caught it. Two rules when adding to `bin/lib/`:

**A shim routes identity and no longer gates writes.** `bin/gws` and `bin/hs` resolve identity. Until 2026-10-06 `bin/ynab` refused budget writes without `YNAB_APPLY=1` and `bin/hs` refused CRM writes without `HS_APPLY=1`. Both bumps came out that day on Forni's call: they stacked with the session's permission classifier, which read the flag itself as a bypass and blocked writes he had asked for. The gate on a write is the classifier plus his instruction in the session. `bin/ynab` is gone, so the real CLI runs from PATH.

- **A sourced library must never take the caller down.** `bin/gws` passes through untouched when the library is unreadable, since blocking the command it wraps would be worse than resolving the wrong profile. `.functions` leaves its resolver a no-op so the shell still starts. `setup.sh` is the deliberate exception and fails loudly, because it has nothing correct to do without its table. Guard every source with `[[ -r ... ]]` and define the degraded behavior explicitly.
- **Anything `.functions` sources must be zsh clean, not just bash clean.** Shims run under bash where `path` is an ordinary variable; `.functions` is read by zsh, where **`path` is special and tied to `$PATH` as an array**. A `local path=...` there silently clobbers command lookup for the rest of the function, so `tr` stops resolving and every marker reads as empty with the error swallowed by `2>/dev/null`. Avoid the zsh special names entirely: `path`, `status`, `prompt`, `cdpath`, `manpath`, `dirstack`, `argv`. Run `zsh -n` and an actual zsh resolution test, since `bash -n` cannot see this class of bug.

## Custom Git Branch Checkout

The `git cob` alias uses `bin/checkout-branch.sh` to checkout branches by their numerical position from `git branch` output. Usage: `git cob <number>`

### Linting

Two gates, both running the same scripts locally and in CI.

- **Markdown** — `npx markdownlint-cli2`. Globs live in both `.markdownlint-cli2.jsonc` and the workflow's `globs:` input, kept in sync. **Do not remove the workflow's `globs:` input.** The action's default is a single-asterisk `*.{md,markdown}` that matches only the repo root; without an explicit glob this job linted exactly two files from the day it shipped until 2026-08-11, while 94 findings accumulated behind it.
- **Shell** — `bin/lint/shell` runs shellcheck plus `bash -n` plus `zsh -n`, gated at warning severity so style noise does not train you into `--no-verify`. The `zsh -n` pass is the point: `.functions` must be zsh clean, and `bash -n` cannot see that class of bug. **A brand new script is invisible to it until staged**, because it discovers files through `git ls-files`. Running the linter after writing `bin/hs` reported clean over the same file count as before; `git add` first, then lint, or trust the pre-commit hook to catch it at the gate.
- **Reconciler** — `bin/lint/reconcile-test` clones to a scratch path and exercises `reconcile_home` against a throwaway `$HOME`, asserting migration, refusal, pruning, merge behaviour and idempotence.
- **Review normaliser** — `bin/lint/review-normalise-test` drives the normalisers in `bin/review/lib.sh` with canned reviewer output: the findings array in every accepted shape, prose and bracket fragments that must come out `ran: false`, a CodeRabbit stream with and without its `complete` line, and the scorecard header. It exists because a shape that normalised to "zero findings" when nothing was reviewed would be a merge gate that fails open; add a row for every new shape a reviewer emits.
- **Runner email renderer** — `npm ci`, `npm run typecheck`, `npm run build` and `npm test` in `runners/email`, on node 20 because that is what the runner images ship. The test renders six invented fixtures through the built bundle and holds each against a frozen golden, html and text alike. It needs `runners/email/package-lock.json`, so it stays red until `@atelic-action/ui` is published at the pinned version and the lockfile lands.
- **Secrets gate** — `bin/lint/secrets-gate-test` drives `.claude/hooks/secrets-gate.sh` with a table of commands that must deny (anything that prints a `.env.local`, a gws credential file, or a vault export: `cat`, `head`, `cut`, `sed`, `awk`, `grep` without `-c`, `-l` or `-q`, a `$(cat ...)`) and must pass (`grep -c`, `wc`, `stat`, `ls`, `source`, a `gcloud ... | python3` move that never echoes). The hook exists because on 2026-09-21 a `cut -d= -f1` meant to list variable names printed two deploy keys and a mailbox token whole: multi line values have no `=` on their continuation lines. Add a row for every new way a secret nearly prints. `SECRETS_GATE_BYPASS=1` is the deliberate override.
- **Voice gate** — `bin/lint/voice-gate-test` drives `.claude/hooks/voice-gate.sh` with a table of `gws gmail` commands that must deny (`+send`, `+reply`, `+reply-all`, `+forward`, `drafts create`, `messages send`, while the session transcript shows no Read of `VOICE.md` and `Admin/Tools/email.md`) and must pass (the same commands once both are read, in the session or a subagent beside it; every read; `drafts send` of an existing draft). The hook exists because on 2026-10-05 an email drafted mid task went through four drafts with the voice canon unread, though GC already asked for it. `VOICE_GATE_BYPASS=1` is the deliberate override.

A tracked `.githooks/pre-commit` runs the first two on staged files. Activate it
once per clone:

```bash
git config core.hooksPath .githooks
```

**A comment whose first word is the analyzer's own name is parsed as a
directive**, whitespace-insensitively, and errors as SC1072 or SC1124. Lead
explanatory prose with something else. This bit three separate files while the
gate was being written, including the linter itself.
