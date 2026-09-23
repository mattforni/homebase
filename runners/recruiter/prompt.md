Sweep the job sources for ISO week {{WEEK}} ({{MONDAY}} to {{SUNDAY}}); today is {{TODAY}}. Eudaimonia is checked out at {{EUDY}}, so every path in your definition that begins with ~/Eudaimonia resolves under it. Scratch directory for working files: {{WORK}}; write nowhere else.

The fetching in step 1 of your method is already done, by the runner, before you started. Do not fetch any board or feed yourself; WebFetch is not available and you do not need it. Read these first, in this order:

- {{WORK}}/ledger.md: the postings ledger, pulled from the Pinole work API by the runner: every posting already judged, any status (rejected, shortlisted, flagged, queued, applied, interviewing, closed). This is the seen set step 4 of your method dedupes against; a posting whose key is in it is a resurfaced dedupe, never a new candidate (the key is the ATS job id, or company plus title when there is none), and a reposted role that arrives with a new key gets a fresh look.
- {{WORK}}/pulls.md: what was pulled, and which source failed this run (a failed source is reported under `sources`, never silently skipped).
- {{WORK}}/listings.md: the whole Getro tier, every board on the software title query set, deduplicated on job id, with the deny list already applied and what it dropped listed at the top. Each line carries the employer's own posting url, so step 3a starts there rather than from a slug guess. A board page shows the first twenty results for a query; the pull table's Total column says when a query had more, which is worth a line under `sources` if it hid roles.
- {{PULLS}}/tech-jobs-for-good.md: the board as text, links kept.
- {{PULLS}}/fractional-jobs.md: the board as text. Its listing is never evidence a role is open; fetch each candidate's detail page with one curl before reporting it.
- {{PULLS}}/a16z/index.md, then only the issues dated since the last sweep, one file each in the same directory.

Then run the rest of your method: score, verify every shortlist and flagged candidate on the employer's own ATS with one curl per candidate (the APIs your definition names, piped through jq where the answer is JSON), dedupe against the log and the ledger, and run at least two WebSearch angles. Reading a posting: a Greenhouse or other JSON answer is one pipeline, `curl -s <api> | jq -r .content | sed 's/<[^>]*>//g' | grep -i -E '<terms>'`; an HTML page is `curl -sL -o {{WORK}}/<name>.html <url>`, then `node {{TEXT}} html {{WORK}}/<name>.html <url> | grep -i -E '<terms>'`. Never use a shell redirect (`>` or `>>`; the `curl -o` above is the one way to save a page), never use /tmp or python3, and never clean up; each of those is denied and costs a turn, and the scratch directory is discarded after the run. Then, instead of the markdown report your Output section describes, return exactly one JSON object and nothing else: no prose before it, no code fence around it. The runner renders it into the email, so a key that is missing or a value of the wrong type is a failed run.

The shape, every key present (use `null` or `[]` where a week has nothing):

```json
{
  "preheader": "One sentence on the state of the week, under 90 characters.",
  "headline": ["Three cleared.", "Target was five."],
  "lede": "One or two sentences: what the sweep covered and what the count means. No recommendations.",
  "shortlist": [
    {
      "company": "Foodsmart",
      "role": "Staff AI Engineer",
      "comp": "$190 to 210K",
      "arrangement": "Remote US",
      "fit": 8.6,
      "why": "One or two sentences on why it cleared, and any flag (freshness, comp against the floor).",
      "about": "One or two sentences on what the company actually does, then how the posting was verified (which API or page, what it said).",
      "url": "https://jobs.lever.co/foodsmart/..."
    }
  ],
  "flagged": [
    {
      "company": "C.Scale",
      "role": "Growth Engineer",
      "missed": "Comp $95 to 115K",
      "comp": "$95 to 115K",
      "arrangement": "Remote US",
      "why": "One or two sentences: which escape hatch this is (a growth engineering title, a hub hybrid outlier) and why it still earns a call.",
      "url": "https://..."
    }
  ],
  "fractional": [
    {
      "company": "A B2B Pharmacy Platform",
      "role": "CTO",
      "rate": "$10 to 20K/mo",
      "hours": "10 to 15 hrs/wk",
      "location": "Remote US/CA/EU",
      "why": "One sentence on the shape and the fit.",
      "detail": "One or two sentences: when it was added, how it was confirmed open, anything Forni should know before a first call."
    }
  ],
  "tradeoff": "The claim sentence, once, when a fractional role sits at or above the practice band; otherwise null.",
  "prospects": "One line on the a16z Lane B read, quiet weeks included.",
  "rejected": [
    { "company": "Zanskar", "reason": "Hybrid Salt Lake City on its own posting" }
  ],
  "rejected_note": "One line with counts for what was not individually verified: resurfaced dedupes and deny list hits.",
  "sources": [
    { "lead": "Lowercarbon is back.", "note": "Cert failure from Sep 8 did not repeat; failure counter reset." }
  ],
  "ledger": [
    { "date": "{{TODAY}}", "company": "Foodsmart", "role": "Staff AI Engineer", "board": "Lever", "key": "Lever, foodsmart, 1ff054fc", "track": "w2", "status": "shortlisted", "fit": 8.6, "url": "https://jobs.lever.co/foodsmart/...", "verdict": "Shortlisted: remote US confirmed via Lever API, Staff, $190 to 210K, recheck freshness." }
  ]
}
```

Rules for the values: `shortlist` is ordered by fit, highest first, and holds only roles verified on the employer's own posting; `flagged` holds every escape hatch your definition names (a growth engineering title on any hard filter miss, comp included; a hub hybrid outlier), with `missed` in three to five words, and a role in `flagged` never also appears in `rejected`; `rejected` holds only roles individually verified this sweep, one clause each; `sources` holds at most five entries and only what would change the source list; `ledger` holds every posting judged this sweep, shortlisted, flagged or rejected, keyed by ATS job id where there is one, with `url` the employer's own posting url when you reached it (null otherwise; it is the exact match the ledger dedupes on), and the runner upserts these rows into the Pinole postings ledger (the same one `{{WORK}}/ledger.md` was pulled from) so a row that is missing or malformed is a posting that never reaches the ledger and gets chased again next week. Each ledger row carries `board` (the ATS or board name: the first segment of the key, or the board itself when there is no ATS id), `fit` (the rubric score, or `null` when the posting was rejected before scoring), `track` (`w2`, or `fractional` for the fractional lane), and `status` (`shortlisted`, `flagged`, or `rejected`, whichever section the role landed in; a fractional role in the lane is `shortlisted`, one judged and left out is `rejected`, so every row carries one of those three). Brevity everywhere: the reader gives this two minutes. Currency and ranges as plain text. No dashes of any kind in prose (no hyphens, en dashes or em dashes; split the sentence or use a comma; hyphens inside identifiers, URLs and role titles as the employer wrote them are fine).
