Prep the weekly outreach roster for ISO week {{WEEK}} ({{MONDAY}} to {{SUNDAY}}); today is {{TODAY}}. Eudaimonia is checked out at {{EUDY}} and the Atelic repo at {{ATELIC}}, so every path in your definition that begins with ~/Eudaimonia resolves under {{EUDY}}. Scratch directory for working files: {{WORK}}; write nowhere else. You have no hs, no gws, no agent-browser and no git in this run, and you do not need them.

Steps 1 through 4 of your method, and the portal half of step 2 and 3's arithmetic, are already done by the runner, before you started. Read these first, in this order:

- {{WORK}}/pulls.md: what was pulled and what failed this run. A failed pull is named under `unverified` in your summary, never silently worked around.
- {{WORK}}/portal.md: the portal sweep. The counts line, then every name sorted into the pull's suggested section (replies owed, tasks due, bumps due, visits due, closes due, first touch candidates, in conversation, parked, waiting), with last send, days since, touches run, opens, and their last reply; the open tasks with their bodies; and the meetings and notes of the last sixty days with their bodies, Granola links included. The suggestion is the record's; the mailbox and the thread decide, and when you move a name out of its suggested section, say why on its roster line. {{WORK}}/portal-detail.md holds every active name's logged sends and replies in full, one `### Name, Company` block each: read a name's block when you draft for that name, with Grep to find it, never the whole file. {{WORK}}/portal.json holds the same as data.
- {{WORK}}/mailbox.md: both mailboxes, searched for every funnel domain and address over sixty days, with the bodies of incoming mail from the last three weeks. This is the mailbox dig for every name at once. A reply here that HubSpot missed moves the name to replies owed; a bounce marks the address dead.
- {{WORK}}/one-pager.md: the One Pager as text, the ICP statement included, if the pull succeeded.
- {{PULLS}}/sites/<domain>.md: one file per site for every name in bumps due, visits due, replies owed and tasks due, and the top first touch candidates. It opens with what the head of the home page code says (title, description, canonical, structured data types, the tells and third party hosts in the code), then robots.txt, the home page and a few internal pages as text with links kept. Their own published words for the pedestal and the opener, the team page for headcount. Read the file for a name when you draft for it; the raw HTML sits beside it under <domain>/ for a claim that needs the code itself, and nothing else. A fetch is not a walk: nothing about what a page shows or fails to show becomes a finding on its own, and a Google surface (the pack, the panel, an AI answer) is Forni's browser's to capture, so every finding that needs one is named on the roster line as owed rather than written as if seen.
- The Atelic repo: the method at {{ATELIC}}/Outreach/README.md and the three rules in Outreach/CLAUDE.md, the voice samples in Outreach/Voice/ and Brand/voice.md, last week's roster, and this week's skeleton at {{ATELIC}}/Outreach/{{WEEK}}-roster.md with whatever sits under its `## Placed Ahead` heading. Any name with a folder under Leads/ or Customers/ has an audit there; read it before drafting for that name.

Read only what a name needs. The turns are the cost: open a site file, a detail block or a Voice sample when you are drafting for that name or that shape, not all of them up front, and never loop over files in Bash.

Then run the rest of your method: sort the week into its fixed order, draft every reply, bump and first touch against the method and the samples, grade the cold drafts, and write the roster. Two differences from a run on the laptop:

1. **Write the roster to {{WORK}}/{{WEEK}}-roster.md, as the complete file**: the skeleton's `## Placed Ahead` section carried over verbatim at the foot, with every name under it given a fully worked line in the week's sections, and everything above it replaced by the built roster (the built date, the standing snapshot note, the weekly scoreboard, the counts, the sections). The runner attaches that file to the report and Forni places it in the repo, so you do not write into the checkout at all.
2. **Return one JSON object and nothing else** as your final message: no prose before it and no code fence around it. The runner renders it into the email, so a key that is missing or a value of the wrong type is a failed run. Never put a full draft in it; the drafts live in the roster file.

The shape, every key present (use `[]` or `""` where a week has nothing):

```json
{
  "preheader": "One sentence on the state of the week, under 90 characters.",
  "headline": ["Five replies owed,", "six bumps, two visits."],
  "lede": "Two or three sentences: what the sweep found and what the block should open on. Name the hottest reader on the board.",
  "scoreboard": [
    { "type": "Replies", "target": 5, "details": "One line for the row: the shape of what remains and any blocker with its owner." },
    { "type": "Bumps", "target": 6, "details": "" },
    { "type": "Closes", "target": 0, "details": "" },
    { "type": "Intros", "target": 5, "details": "" },
    { "type": "Visits", "target": 2, "details": "" }
  ],
  "checklist": [
    { "type": "Replies", "names": [ { "person": "Salley Wilson", "company": "Outdoors Geek", "contact_url": "https://app.hubspot.com/contacts/246648548/record/0-1/...", "company_url": "https://app.hubspot.com/contacts/246648548/record/0-2/...", "note": "the one line the block needs: what this touch is, the sending address, the grade" } ] }
  ],
  "counts": { "next_up": 64, "next_up_new": 40, "unscored": 6, "tasks_due": 2, "tasks_parked": 2, "tasks_stale": 0, "top_opened": "Xerxes Steirer, Just Heat Pumps, 7 opens on day 12" },
  "flags": [ { "lead": "Blue Spruce Maids reads NEW with a reply on the record.", "note": "One or two sentences: both values, and what you recommend. You flag; you do not fix." } ],
  "unverified": [ { "lead": "The One Pager pull failed.", "note": "What was not verified today and what it would take." } ],
  "not_in_block": [ { "lead": "Kristy Adams, Project Angel Heart", "note": "Why this name is deliberately not on the board this week." } ]
}
```

Rules for the values: `scoreboard` holds exactly the five types in that order, Complete is zero on Monday and the runner adds it; `checklist` holds one entry per type with anyone still owed that touch, person then company, in the same order as the rows, and a type with nobody gets an empty `names`; `flags` is the portal diff (a roster line whose state disagrees with the portal, a send never logged, a status that lags a reply); `unverified` is everything you could not verify today, the failed pulls included; `not_in_block` is what you left off on purpose. Brevity everywhere: the reader gives the email two minutes and the roster the block. Dates ISO, clocks 24 hour. No dashes of any kind in prose (no hyphens, en dashes or em dashes; split the sentence or use a comma; hyphens inside identifiers, URLs and names as their owners wrote them are fine). End with the JSON; the success line your definition asks for is not needed here.
