# Handle Budget Learned Rules

Corrections and calibration for how `assist:handle-budget` should reason about partitioning, tagging, and approving transactions. Overrides SKILL.md. Read on every invocation. Payee to category corrections live below under `## Spend Categorization`, and the Atelic budget's in the Atelic repo at `~/Eudaimonia/Craft/Vocation/Atelic/Tools/ynab.md`.

- **2026-09-07, the plan is walked, never tabled.** A 27 row plan table was "very hard to parse"; the one at a time walk of only the undecided rows, followed by a tally by category, "works really well." Now the method in SKILL.md Phase 3. Keep it that way even for a short queue.
- **2026-09-07, a sit down restaurant asks who was there.** The same payee is `❤️ Romantic` on a date and `🍽️ Dining Out` otherwise (Little India was a date night). Propose Dining Out and ask; never auto decide a restaurant that has been Romantic before.
- **2026-09-07, own bank transfer pairs stay on Inflow: Ready to Assign, both legs.** A partition case Phase 2 does not name: a Bank of America to First Tech move where YNAB has not matched the legs as a transfer imports as two rows that net to zero. Both are categorized and approved as inflow, never one as spend, and never left for the New branch to ask about.
- **2026-09-07, the monthly run is the treasurer agent's; 2026-09-29, the weekly run is too.** `~/.claude/agents/treasurer.md` runs this skill as its phase one and grooms both budgets, Personal and Atelic (since 2026-10-05), and returns the slate plus the plan as one batch file per budget; the main session does the walk and applies the plan on Forni's yes. The permission layer blocked the agent's own YNAB writes on 2026-09-27, so the agent never writes. Inline runs of the skill still follow Phase 3 as written.

## Spend Categorization

Rules for `assist:handle-budget`. The payee map is [reference/payee-map.md](../../reference/payee-map.md); these corrections override it.

Mechanics (hard-won, do not rediscover):

- Everything goes through the `ynab` CLI behind the `~/bin/ynab` dry run shim (since 2026-08-13; the REST recipes and the MCP are retired). The CLI's own gotchas (file before `jq`, help on write verbs) are in the skill's Access section.
- Imported transactions land **unapproved**, and categorizing does NOT approve them. Approve as the final step (`approved: true`) or the changes never flow into budget views. This is the usual cause of "my changes aren't showing up."
- YNAB clients use delta sync. After API writes, an open app or web session needs a hard refresh to display them.
- Payee names carry HTML entities (`&amp;`). Decode before matching.
- Budget IDs: Personal `a55b71e6-76e4-46d9-a5c6-336b36ddd14c`. The Atelic budget's id is in `~/Eudaimonia/Craft/Vocation/Atelic/Tools/ynab.md`.
- **Check direct import status on every run, before trusting the queue.** `ynab accounts list --budget <id>` carries `direct_import_linked` and `direct_import_in_error` per account; any open, linked account in error is the first thing reported, since its missing rows make the queue and every spend number look lighter than they are. BofA Checking and BofA Cash Rewards sat silently in error until 2026-09-27.

Conventions:

- Trips are itemized into real categories with a memo `<emoji> <Trip Name>` (e.g. `🏔️ Crested Butte`, `⛷️ Vail`), NOT a YNAB flag. Quarantines vacation from the everyday baseline while keeping a per-trip total. Non-discretionary trip-time charges (vehicle repair) stay untagged.
- Admin is not a generic catch-all. Estate and legal bills go to `📑 Admin / ⚖️ Legal`. Home-purchase costs (down payment, lender fees, inspection) go to `📑 Admin / 🏡 3033 Blake St Home Purchase`.
- A date, a show, or a dinner with company can be `🍿 Entertainment`, `🍽️ Dining Out`, or `❤️ Romantic`; ask. Precedents: The Empire Strips Back was Entertainment (2026), Little India was Romantic (2026-09-06).
- **`🏡 Housing` is the whole cost of the condo**: the Onity mortgage, the Rail Yard Lofts HOA, and the Account Integrators eCheck fee that rides with the HOA. Never split them across Utilities or Financial (Forni, 2026-09-07).

Payee corrections (session 2026-06-29):

- `7-Eleven` -> `🚬 Nicotine` (confirmed, buys nicotine there).
- `Bunny and Clyde's` -> `☕️ Cafés` (Salida coffee).
- `Body Jewelry`, `Easy Steez Vintage` -> `🧥 Clothing`.
- `Badfish SUP` -> `🌲 Outdoorsman` (was Gear before the tree merge). `Rhino Air`, `Discount Tire`, `Costco Gas` -> `🚙 Transportation`.

Payee corrections (session 2026-07-18):

- `Illegalpetes` (Toast POS variant of Illegal Pete's) -> `🍟 Fast Food`.
- Santa Barbara trip (July 8 to 14): itemize each charge into its real category (coffee -> `☕️ Cafés`, pool/swim like Cal Lutheran Pool -> `💪 Fitness`, restaurants -> `🍽️ Dining Out`, groceries -> `🛒 Groceries`, lodging -> `🌏 Adventure`) AND stamp the memo `💍 Santa Barbara` so it totals as a trip. Do NOT dump the whole cluster into `🌏 Adventure`; Forni corrected exactly this ("coffee shops are coffee, Cal Lutheran Pool is Athlete"). The memo, not the category, is what quarantines the trip. Nicotine buys (ARCO, 7-Eleven) inside a trip window stay in `🚬 Nicotine` untagged, to keep the growth-edge total honest.

Payee corrections (session 2026-09-07, the first run after the tree restructure):

- `☕️ Caffeine` was renamed `☕️ Cafés` and moved from Vices to Contemplation on 2026-09-07 (category id unchanged, history intact). `The French Press`, `Sapor Coffee & Concepts` -> `☕️ Cafés`.
- `Rail Yard Lofts` (the HOA) and `Account Integrators` (the CINC eCheck fee) -> `🏡 Housing`.
- `ACH Deposit 261003712` is the Fidelity HSA reimbursing the health premium: payee `Transfer: Fidelity HSA`, category `🏥 Healthcare`, memo `🏥 HSA premium reimbursement` so it is findable at tax time.
- `Sierra Dental` (bank descriptor `Sierra River N Dent`, mysierradental.com) -> `🏥 Healthcare`, its own payee. It is NOT River North Dentistry; never merge the two.
- `Ratio Beerworks` -> `🍽️ Dining Out`. `7-Eleven` stays `🚬 Nicotine`.

Payee corrections (session 2026-09-27, the personal groom to zero):

- `Amazon` -> `🏡 Home Improvement`, auto decided as the catch all; it rides in the tally where Forni can pull any row out, and is no longer an always confirm payee.
- `Chef Zorba's Restaurant` -> `🍾 Sobriety` when it is fellowship (taking people out from the High Noon meeting); otherwise ask like any sit down restaurant.
- `Culinary Dropout`, `Pita Fresh`, `High Mountain Pies` -> `🍽️ Dining Out`.
- `Hello Darling`, `Hearth Highlands`, `Honey Hill` -> `☕️ Cafés`.
- `Oura` (the membership) -> `🏥 Healthcare`.
- `Stinker Stores` (fuel) -> `🚙 Transportation`.
- `Thule` -> `🚙 Transportation` (car rack parts).
- `Colorado Parks and Wildlife` -> `🌲 Outdoorsman` (Forni, 2026-09-29). The 2026-09-15 camping date stays `❤️ Romantic` as filed.
- **A Venmo payment the Atelic budget already records is deleted from Personal, never categorized.** When Venmo is funded from the Atelic bank, the charge is the business's and lives on the Atelic budget; the personal Venmo row is a duplicate. Match on date and amount against Atelic before proposing any category for a personal Venmo payment, and propose the delete when it matches.

Payee corrections (session 2026-10-05):

- `Arc Thrift` -> `🧥 Clothing`, auto decided and no longer always confirm. Forni: "Arc Thrift Store purchases should be categorized as clothing not home improvement."
- A `Thule` warranty reimbursement check -> `🌏 Adventure`, with the payee set to Thule; it imports as a `Neo` mobile check deposit. Forni: "I don't want the Thule check to go into transportation. Put it into adventure."
- `Google Cloud` on Personal -> `💰 Financial`, auto decided: the personal Google Cloud projects (the keys vault). On Atelic it stays `🖥️ Infrastructure`.
- A Venmo refund of part of a group payment nets into the original spend category, never `Inflow: Ready to Assign`, which is where YNAB's payee memory routes it.
- `Rail Yard` (descriptor "Rail Yard Lofts - OnlinePay") is the HOA: `🏡 Housing`, reassigned to the existing `Rail Yard Lofts` payee.
- On Personal, `ACH Deposit: 261003712 ... MONEYLINE` is still the HSA premium reimbursement; the MONEYLINE suffix marks a funding move only on Atelic.
- The small monthly `Anthem Blue Cross Blue Shield` charge is the dental premium. The health premium is `Elevate Health Plans`, the one the HSA reimburses.

Payee corrections (session 2026-10-12):

- `Altra` -> `💪 Fitness`, never Outdoorsman (Forni: "Altra is an athlete").
- `Pacific Mercantile` (the Japanese grocery at Sakura Square) -> `🛒 Groceries`.
- `Chase Annual CC Fee` ANNUAL FEE REFUND -> `💳 Card Fees`, cancelling the fee it refunds.
- `Alzheimer's Association` -> `🤲 Giving`.
- A BofA `DES:CASHREWARD` deposit -> `Inflow: Ready to Assign`.

Payee corrections (session 2026-10-19):

- `EN Denver` is Embrace North, a monthly sauna membership -> `🧖 Personal Care`, auto decided.
- `Travelers` ("TRAVELERS PER INS", the condo policy) -> `🪪 Insurance`.
- `Genesee Country` (fuel, Golden) -> `🚙 Transportation`. Fuel bought on the way to a trip carries no trip memo.
- `Sherpa House` (Golden) -> `🍽️ Dining Out`.
- A `Coinbase` ACH deposit -> `Inflow: Ready to Assign`, memo naming the coin sold (`🪙 Sold ETH`). It is cash moved out of an untracked holding, not income.
- Alaska Airlines award taxes and fees -> `🌏 Adventure` with the memo of the trip it was booked for (the Thailand award, `🇹🇭 Thailand`); ask when more than one trip is open.

Payee corrections (session 2026-10-26):

- **A bank outflow to Venmo is always a transfer to the Venmo account, never a category.** YNAB tracks Venmo as its own account, so one payment imports twice: the Venmo row (the spend, which takes the category and the memo) and the bank leg that funds it (payee `Venmo` on FirstTech Paper or any checking account), which becomes a transfer by setting its `payee_id` to the Venmo account's `transfer_payee_id` (from `ynab accounts list`) with no category; a literal payee name does not make a transfer. This applies when the payment is not already on the Atelic budget; the Atelic funded Venmo rule above (delete the personal duplicate) still wins. Forni, 2026-10-26: "Anytime there's that duplication... follow this pattern of labeling one a transfer and the other one as the actual payment."
- The CPA's Venmo payee -> `💰 Financial`, memo `🧾 <year> Tax Prep` for the personal return, after the Atelic cross check above. The business return's fee sits on Atelic under its own rule.
- **A memo is an emoji and a short Title Case name** (`🧾 2025 Tax Prep`, `🏔️ Aspen`, `💵 2026 October Build Fee`), never a sentence or a payee restatement. The older `🏥 HSA premium reimbursement` memo is the one exception.
- `Comedy Works` and `Cantina New` -> `❤️ Romantic` (a date). A show and a sit down restaurant are still asked about each time.
- `Grab & Go` stays always confirm; it has been `🚬 Nicotine`.
- `St Moritz Lodge & Condominiums` is a second spelling of `St Moritz Lodge`; reassign to the first. The 🏔️ Aspen weekend itemized: lodging `🌏 Adventure`, `Hotel Jerome` and `520 Grill` `🍽️ Dining Out`, `Leadville Exchange`, `Melanzana Mountain`, `Aspen Thrift Shop` `🧥 Clothing`, every row memoed `🏔️ Aspen`.
- An `Airbnb` charge refunded the same day stays at `🌏 Adventure` on both rows so they net to zero.

Payee corrections (session 2026-11-02):

- **A Venmo receipt from a person is a friend's share of a group spend** and nets into that spend's category, `🍽️ Dining Out` when the note reads as food, and that case is auto decided. Any other note is asked, since the repaid category cannot be inferred.
- `York Street Club` -> `🍾 Sobriety` on every row, Venmo included, auto decided; it no longer asks (a Venmo payment still gets the Atelic duplicate check first).

Payee cleanup mechanics (session 2026-07-18, hard-won):

- **Renaming a payee to an existing name does NOT merge them via the API.** It just creates a second payee with the same display name (verified: renamed `Illegalpetes` -> `Illegal Pete's` and ended with two `Illegal Pete's` records). The app merges on rename; the public API does not.
- **The real merge primitive is transaction reassignment.** Get the duplicate's transactions (`GET /payees/{id}/transactions`), PATCH each with `payee_id` = the canonical payee, and the source drains to 0 transactions.
- **The API cannot delete payees** (no DELETE endpoint). Emptied/orphan payees are removed by YNAB's own maintenance (unused payees auto-purge), but not on demand. For an immediate purge of hundreds of orphans, use the app's Manage Payees screen (multi-select delete / Combine). Native Renaming Rules to strip Venmo quoted-note sprawl are also app-only.
- Only bother merging clusters where **two or more spellings both have transactions**; single-used-plus-orphan clusters need no action since the orphan auto-purges. Most Venmo note-variants (e.g. Azam Mughal 15 variants, 0 txns) are pure orphans.

- **Changing a budget's category tree, either budget:** **the web app's stale delta sync will claim categories still have transactions after CLI moves; hard refresh the page before deleting categories in the app.** Category create goes through the API (`ynab api POST '/plans/{plan_id}/categories' --budget <id> --data '{"category":{"name":...,"category_group_id":...}}'`). Category delete is app only, driven via agent-browser on the personal Chrome identity (`--identity personal`, signed in to YNAB once by hand in its headed window), with the YNAB tab's URL read back before each delete; rename and move go through `ynab categories update <id> --name --category-group-id` with history intact.

**The Atelic budget's rules live in the Atelic repo, at `~/Eudaimonia/Craft/Vocation/Atelic/Tools/ynab.md`** (its policy, its payee corrections, its budget id). Read that file before grooming the Atelic budget. This section governs the Personal budget: where a line above names Atelic (a personal Venmo row matched against the Atelic budget, `Google Cloud`, the MONEYLINE deposit), it is settling a Personal row by contrast or by cross check, and the Atelic side of it is that file's rule. Only the mechanics and the category tree rule hold for both budgets.
