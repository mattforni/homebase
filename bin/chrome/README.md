# Chrome Identities

Signed in browser automation runs through two Google Chrome instances, one per
identity, each with its own profile folder and its own CDP port. Claude never
drives Brave; Brave is Forni's browser and nothing attaches to it.

| Identity | Signed In As | Port | Profile Folder |
|---|---|---|---|
| `atelic` | `matt@atelic.me` | 9223 | `~/Library/Application Support/Google/Chrome-Atelic` |
| `personal` | `mattforni@gmail.com` | 9224 | `~/Library/Application Support/Google/Chrome-Personal` |

The names match the `.account` profiles that `gws` and `hs` use. The table
itself lives in `bin/lib/chrome-identity.sh`, the one copy the launcher and the
shim both read.

## Using One

```bash
agent-browser --session <name> --identity atelic tab new https://search.google.com/search-console
agent-browser --session <name> --identity atelic screenshot out.png
```

Put `--identity` on **every** call. The `bin/agent-browser` shim turns it into
`--cdp <port>`, and starts the instance first if it is not running; it then
stays up until the machine restarts. Nothing starts at login. A bare
`agent-browser connect 9223` followed by calls without the flag does not stay
attached: each later call quietly launches a throwaway browser, which reads as
"signed out" (2026-09-30).

**Headless is the default**, for reads nobody watches: console reads, Google
result pages, bot screened sites. There is no window, so nothing raises over
Forni's work, which is the problem this replaced (ATE-601: attaching to his
Brave on 9222 pulled his window forward and stole keyboard focus mid read).

Headless runs with extensions off: Bitwarden's background worker spins
without a window (about 250% CPU on an idle instance, 2026-09-30), and no
unattended read needs an extension. Close your tab when the read is done;
console pages keep running their scripts in the background.

**Add `--headed` when the task needs his hands**: a sign in, a captcha, a
certification on MyUI+, an application form he submits himself. Same profile,
in a window he can see. One profile runs in one mode at a time, so the shim
refuses a call whose mode does not match the running instance rather than
restarting it under whatever else is attached. Switch deliberately:

```bash
~/bin/chrome/stop-identity atelic
agent-browser --session <name> --identity atelic --headed tab new <url>
```

## Signing In

A new machine, or a session Google has ended, needs one sign in by hand:

1. `~/bin/chrome/stop-identity <name>` if it is running.
2. `agent-browser --session signin --identity <name> --headed tab new https://accounts.google.com`
   opens the window. Forni signs in there, second factor included, and answers
   Chrome's "existing profile data" question with **Continue to work in this
   profile**, which keeps the sign in in the profile the instance opens.
3. `~/bin/chrome/stop-identity <name>`. The next plain call comes up headless and
   signed in.

Credentials are never typed by an agent.

## The Security Tradeoff

**Device bound sessions are switched off in both instances**
(`--disable-features=EnableBoundSessionCredentials,DeviceBoundSessions` in
`launch-identity`). Chrome normally ties a Google sign in to a key held in the
Secure Enclave, so a cookie copied off the machine stops working within
minutes. A session signed in with a window and then run headless lost that
binding and Google revoked it: the session cookies vanished from the profile.
With binding off the sign in is an ordinary long lived cookie, and so is
stealable from disk by anything that can read the profile folder. FileVault and
the account password are what protect it.

**While an instance runs, any local process can drive it** through its port and
act as that Google account. The port binds to localhost only, so nothing off the
machine reaches it. Instances start on demand rather than at login, so the ports
are open only after something has needed them; `stop-identity` closes one early.

## Verifying

```bash
curl -s http://localhost:9223/json/version    # HeadlessChrome in User-Agent means headless
lsof -nP -iTCP:9223 -sTCP:LISTEN
```

A listener that is not Chrome running the identity's profile folder means
something else holds the port; the shim and `stop-identity` both refuse to
treat it as the identity.

## Why Chrome and Not a Second Brave

Google's consoles and sign in are built against Chrome, and Brave's
fingerprint randomising and Shields are one more thing for them to trip on. A
different app also keeps any headed window out of Brave's Dock icon and
Cmd Tab slot. This is real Google Chrome with a persistent profile, never the
Chrome for Testing build agent-browser ships, whose throwaway profile fails
Workable's captcha and ID.me's Cloudflare check.
