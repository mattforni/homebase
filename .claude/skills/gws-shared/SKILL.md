---
name: gws-shared
description: "gws CLI: Shared patterns for authentication, global flags, and output formatting."
metadata:
  version: 0.22.6
  openclaw:
    category: "productivity"
    requires:
      bins:
        - gws
---

# gws — Shared Reference

## Installation

The `gws` binary must be on `$PATH`. See the project README for install options.

## Authentication

```bash
# Browser-based OAuth (interactive)
gws auth login

# Service Account
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
```

## Profiles (Multi-Account)

`gws` reads its config from `$GOOGLE_WORKSPACE_CLI_CONFIG_DIR`. Forni's setup uses one config dir per Google account, switched at the shell:

| Profile | Config dir | Account |
|---------|-----------|---------|
| `personal` | `~/.config/gws-personal/` | personal Gmail (the ambient default) |
| `atelic` | `~/.config/gws-atelic/` | `matt@atelic.me` |

The active profile is layered:

1. **Ambient**: recorded in `~/.config/gws-current` and exported as `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` at shell startup by `.functions`. Persists across shells.
2. **Directory override**: a zsh `chpwd` hook walks up from `$PWD` on every `cd`, finds the nearest `.account` marker file (one line text containing the profile name), and silently swaps the env var. Convenience only; it fires solely in interactive zsh, and only on an actual directory change.
3. **Invocation time shim (authoritative)**: `~/bin/gws` re-resolves the marker on every single call and exports the config dir before exec'ing the real binary. This is the layer that actually guarantees the right account, because it does not care how the process was started.
4. **Pin**: `gws-pin` sets `GWS_AUTO_SWITCH=0`, honored by both the hook and the shim, which then pass through untouched.

The `.account` marker is a cross-tool convention; the `hs` shim reads the same file to pick the HubSpot account.

| Command | Effect |
|---------|--------|
| `gws-use` | List profiles; show current |
| `gws-use personal` | Set ambient profile (persists across shells; also unpins) |
| `gws-pin` | Lock to current profile in this shell (`GWS_AUTO_SWITCH=0`, honored by the hook and the shim) |
| `gws-unpin` | Resume chpwd hook |
| `gws-whoami` | Re-resolve from `$PWD`, then show profile, config dir, and `gws auth status` |
| `GWS_FORCE_PROFILE=personal gws ...` | One shot override. Unambiguous; use this everywhere |
| `GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.config/gws-personal gws ...` | Legacy one shot override. Silently ignored when it names the profile you are already on |

When writing tooling that should always run against a specific account regardless of where it runs, prefer `GWS_FORCE_PROFILE=<profile>` over relying on the ambient profile; an unknown profile name exits 78 instead of guessing. When in doubt about which account is active, run `gws-whoami` before any action that sends mail or modifies a calendar.

`~/bin/gws` is a PATH shim that re-resolves the nearest `.account` marker on every invocation, so a plain `gws` call from inside a marked subtree uses that subtree's account even in an agent shell, a launchd job, or CI. Do not assume the inherited `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` reflects reality; it frequently does not, and the shim is what corrects it. Full explanation in homebase `CLAUDE.md` under Account Profiles.

The legacy config dir override is conditional, which is why `GWS_FORCE_PROFILE` replaced it. Every resolver stamps `GWS_RESOLVED_DIR` with the config dir it set, so the shim can tell an inherited config dir (equal to the stamp, safe to re-resolve) from one you set on purpose (different from the stamp, honored). An explicit config dir that names the profile the shell is already on is byte identical to an inherited one, so the shim re-resolves from the marker and the override is lost. The full account lives in `~/Eudaimonia/Admin/Tools/gws.md`.

### Cross Machine Secret Sync

`client_secret.json` files (the OAuth client config per profile) sync between machines via GCP Secret Manager under `gws-oauth-client-<profile>`. Each profile resolves to the vault for that identity (`personal` to `forni-keys`, `atelic` to `atelic-keys`), routed by `bin/lib/vault.sh`; set `GWS_BOOTSTRAP_PROJECT` to force a single project. Full vault conventions: `~/Eudaimonia/Admin/Tools/secret-manager.md`.

| Action | How |
|--------|-----|
| Push local secrets up (one machine to seed) | `~/Eudaimonia/Craft/Development/personal/homebase/bin/vault/push-gws-secrets` |
| Pull on a fresh machine | `./setup.sh` (auto fetches via `gcloud secrets versions access`) |

Tokens (`credentials.enc`, `token_cache.json`) are NOT synced. They are keyring encrypted and bound to the originating machine. Re run `gws auth login` per profile per machine, which the setup.sh per profile loop handles.

## Global Flags

| Flag | Description |
|------|-------------|
| `--format <FORMAT>` | Output format: `json` (default), `table`, `yaml`, `csv` |
| `--dry-run` | Validate locally without calling the API |
| `--sanitize <TEMPLATE>` | Screen responses through Model Armor |

## CLI Syntax

```bash
gws <service> <resource> [sub-resource] <method> [flags]
```

### Method Flags

| Flag | Description |
|------|-------------|
| `--params '{"key": "val"}'` | URL/query parameters |
| `--json '{"key": "val"}'` | Request body |
| `-o, --output <PATH>` | Save binary responses to file |
| `--upload <PATH>` | Upload file content (multipart) |
| `--page-all` | Auto-paginate (NDJSON output) |
| `--page-limit <N>` | Max pages when using --page-all (default: 10) |
| `--page-delay <MS>` | Delay between pages in ms (default: 100) |

## Security Rules

- **Never** output secrets (API keys, tokens) directly
- **Always** confirm with user before executing write/delete commands
- Prefer `--dry-run` for destructive operations
- Use `--sanitize` for PII/content safety screening

## Shell Tips

- **zsh `!` expansion:** Sheet ranges like `Sheet1!A1` contain `!` which zsh interprets as history expansion. Use double quotes with escaped inner quotes instead of single quotes:

  ```bash
  # WRONG (zsh will mangle the !)
  gws sheets +read --spreadsheet ID --range 'Sheet1!A1:D10'

  # CORRECT
  gws sheets +read --spreadsheet ID --range "Sheet1!A1:D10"
  ```

- **JSON with double quotes:** Wrap `--params` and `--json` values in single quotes so the shell does not interpret the inner double quotes:

  ```bash
  gws drive files list --params '{"pageSize": 5}'
  ```

## Community & Feedback Etiquette

- Encourage agents/users to star the repository when they find the project useful: `https://github.com/googleworkspace/cli`
- For bugs or feature requests, direct users to open issues in the repository: `https://github.com/googleworkspace/cli/issues`
- Before creating a new issue, **always** search existing issues and feature requests first
- If a matching issue already exists, add context by commenting on the existing thread instead of creating a duplicate
