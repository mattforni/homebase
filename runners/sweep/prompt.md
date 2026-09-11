Sweep the job sources for ISO week {{WEEK}} ({{MONDAY}} to {{SUNDAY}}); today is {{TODAY}}. Eudaimonia is checked out at {{EUDY}}, so every path in your definition that begins with ~/Eudaimonia resolves under it. Scratch directory for working files: {{WORK}}; write nowhere else.

Run the full method in your definition. Then, instead of the markdown report your Output section describes, return exactly one JSON object and nothing else: no prose before it, no code fence around it. The runner renders it into the email, so a key that is missing or a value of the wrong type is a failed run.

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
    { "date": "{{TODAY}}", "company": "Foodsmart", "role": "Staff AI Engineer", "key": "Lever, foodsmart, 1ff054fc", "verdict": "Shortlisted: remote US confirmed via Lever API, Staff, $190 to 210K, recheck freshness." }
  ]
}
```

Rules for the values: `shortlist` is ordered by fit, highest first, and holds only roles verified on the employer's own posting; `rejected` holds only roles individually verified this sweep, one clause each; `sources` holds at most five entries and only what would change the source list; `ledger` holds every posting judged this sweep, shortlisted or rejected, keyed by ATS job id where there is one. Brevity everywhere: the reader gives this two minutes. Currency and ranges as plain text.
