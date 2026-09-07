# Handle Budget Learned Rules

Corrections and calibration for how `assist:handle-budget` should reason about partitioning, tagging, and approving transactions. Overrides SKILL.md. Read on every invocation. Payee to category corrections live in the plugin wide `learned-rules.md` under `## Spend Categorization`, not here.

- **2026-09-07, the plan is walked, never tabled.** A 27 row plan table was "very hard to parse"; the one at a time walk of only the undecided rows, followed by a tally by category, "works really well." Now the method in SKILL.md Phase 3. Keep it that way even for a short queue.
- **2026-09-07, a sit down restaurant asks who was there.** The same payee is `❤️ Romantic` on a date and `🍽️ Dining Out` otherwise (Little India was a date night). Propose Dining Out and ask; never auto decide a restaurant that has been Romantic before.
- **2026-09-07, own bank transfer pairs stay on Inflow: Ready to Assign, both legs.** A partition case Phase 2 does not name: a Bank of America to First Tech move where YNAB has not matched the legs as a transfer imports as two rows that net to zero. Both are categorized and approved as inflow, never one as spend, and never left for the New branch to ask about.
- **2026-09-07, the monthly run is the treasurer agent's.** `~/.claude/agents/treasurer.md` runs this skill as its phase one and returns the slate; the main session does the walk. Inline runs of the skill still follow Phase 3 as written.
