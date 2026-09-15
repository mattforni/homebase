# Login Agents

macOS LaunchAgents this repo deploys to `~/Library/LaunchAgents`. They are
copied rather than symlinked, because that directory is full of foreign writes
from other installers, so an edit here needs a `./setup.sh` run and a reload
before launchd sees it.

| Agent | What It Does |
|---|---|
| `me.atelic.brave-debug-port.plist` | Starts Brave at login with the CDP remote debugging port open on 9222 |

## Why Brave Needs the Port

Browser automation runs through `agent-browser`, which ships its own Chrome for
Testing build and launches it with a throwaway profile. That fingerprint is the
one every bot check is built to catch: no history, no extensions, and Chromium's
automation flags on the command line. It cannot pass the ID.me Cloudflare
challenge (documented in the `assist:report-unemployment` skill) and it could
not pass Workable's application captcha on 2026-09-15.

Two separate fixes, and they compose:

1. **Which binary runs.** The `bin/agent-browser` shim points every invocation at
   Brave via `AGENT_BROWSER_EXECUTABLE_PATH`, so nothing launches Chrome for
   Testing any more. A launch through the shim still gets a clean automated
   profile.
2. **Which profile runs.** When a site screens hard enough that a real logged in
   profile is required, attach to the running Brave instead of launching
   anything: `agent-browser connect 9222`. That is what this agent keeps
   available.

Brave has no flags file on macOS and no browser setting for the port, so a login
agent is the only way to make it permanent. Without it the port exists only when
Brave is launched by hand, and that launch is lost every time Brave restarts on
its own.

## The Security Tradeoff

**While the port is open, any local process can drive the browser and read every
logged in session.** That includes banking, email, and anything else with a live
cookie. The port binds to localhost only, so nothing off the machine can reach
it, but every process running as this user can. This is a deliberate trade: the
alternative is retyping credentials into an automated browser for every task
that needs a real session, which is worse.

Close it for a while by unloading the agent and restarting Brave normally:

```bash
launchctl bootout "gui/$(id -u)/me.atelic.brave-debug-port"
```

## Verifying

```bash
curl -s http://localhost:9222/json/version
lsof -nP -i :9222 | grep LISTEN
```

**Never verify on the JSON's `Browser` field.** Brave is Chromium and reports
`Chrome/<version>` there, never its own name, so that test can only ever fail.
Check the listener's owner with `lsof` instead. A listener that is not Brave
means a stale process holds the port, so stop rather than attach.

## Quitting Brave

`KeepAlive` is set to `SuccessfulExit: false`, so Brave comes back with the port
when it crashes or an update restarts it, and a clean quit is respected. Brave
stays quittable.

The gap that leaves: after you quit Brave deliberately, the next launch from the
Dock or from a link has no port, because LaunchServices starts it without the
flag. Fix it for that session by reloading the agent:

```bash
launchctl kickstart -k "gui/$(id -u)/me.atelic.brave-debug-port"
```

Or make the port unconditional by replacing the `KeepAlive` dict with a bare
`<true/>`, at the cost of never being able to quit Brave at all.
