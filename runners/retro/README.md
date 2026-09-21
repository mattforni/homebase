# The Retro Runner

A Cloud Run Job (`retro`, project `atelic`, region `us-central1`) that fires every Monday at 05:00 Denver, pulls the ISO week from Strava, Gmail, and HubSpot with curl, has headless Claude Code draft the retrospective as JSON, renders it into the branded email through the node renderer in [../email/](../email/), and sends it through Resend as `YYYY-Www Retro`. Read only against the world except the rotated Strava refresh token, which it writes back to the vault. Tracked as ATE-471.

The runtime one pager (why Cloud Run over Routines and launchd, the service account and its secrets, the schedule, the traps) lives in Eudy at `Admin/Tools/cloud-run.md`.

**Iterate locally first.** The loops and the promote step are in [../README.md](../README.md); the short version is `bin/runner/render-local retro` while changing how the email looks, `bin/runner/run-local retro --reuse` while changing what it says, and `bin/runner/promote retro` once it is right.

```bash
bin/runner/fetch-env retro                 # once per machine
bin/runner/run-local retro --week 2026-W35 # renders to out/, sends nothing
bin/runner/render-local retro              # instant re-render after a renderer edit
bin/runner/promote retro                   # build and point the job at it
bin/runner/fire retro                      # run production now
```

| File | Role |
|---|---|
| `Dockerfile` | `node:20-slim` plus curl, jq, tzdata, and a pinned Claude Code; runs as the non root `runner` user |
| `entrypoint.sh` | The pulls and the Strava write back, on the shared scaffold in `runners/lib/runner.sh` (the week, the `claude -p` call with Read as its only tool, the draft check, the render, the send) |
| `hubspot.mjs` | The Atelic pull, called by `entrypoint.sh`: the HubSpot joins and the outreach arithmetic, handed to the prompt as finished tables |
| `prompt.md` | The retro brief: the block's grading, the JSON shape, the voice rules; `{{WEEK}}`, `{{MONDAY}}`, `{{SUNDAY}}`, `{{TODAY}}`, `{{WORK}}`, `{{EUDY}}` are filled at run time |
| `render.jq` | The fallback renderer, and the record of what the page was before `runners/email/retro.tsx` took over. Which of the draft's fields go where, composed from the shared runner email design (`runners/lib/email.jq`) since 2026-09-15: sessions, deals and leads as item rows, the coverage tables as compact mono tables, each read as a note. The 2026-08-27 Geist template it replaced lives in git history |

The page lands at `out/email.html` and the draft at `out/retro.json`, the names every runner uses.
