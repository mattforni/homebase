---
name: plan-meals
description: Weekly meal planning, shopping list generation, and pantry aware grocery runs. Produces a plant based, seasonal, batch prep friendly meal plan for the week, authored into the Pinole app, plus a consolidated shopping list grouped by store. Use this skill whenever the user mentions meal planning, wants to plan the week's food, asks for a shopping list, wants help figuring out what to cook, mentions batch prep, macros, recipes, a grocery run, a Sprouts or Costco trip, or says things like "back on the healthy eating train" or "kick the takeout habit." Also trigger for "/assist:plan-meals", "meals for the week", or "what should I cook". Prefer invoking this skill even when the user's ask is oblique (e.g., "I want to stop eating out" or "I need to hit my macros this week") since meal planning is usually the underlying need.
argument-hint: "[optional week, e.g. 2026-W17]"
allowed-tools:
  - Bash
  - mcp__pinole__*
  - WebFetch
  - WebSearch
  - Read
  - Edit
  - Write
  - Glob
  - AskUserQuestion
---

# Plan Meals Assist

**Direct invocation only (2026-08-24).** Weekly planning no longer includes a meals phase; this skill runs only when Forni asks for meal planning himself.

Help Forni plan a week of plant based, seasonal, batch prep friendly meals, author it into the Pinole app, and produce a single primary shopping list. The goal is less decision fatigue mid week and more momentum on the healthy eating front.

## Why This Matters

Forni's 2026 growth edge is eliminating overconsumption. The most visible form is defaulting to takeout when the week gets tired. A good meal plan removes the decision and the cravings compound. A bad plan (boring, unrealistic, mismatched to his week) is worse than no plan; it generates friction and a story to push against. Aim for plans he wants to eat, sized to his actual week, using ingredients he actually has or can easily get.

The meal plan now lives in the Pinole app, where Forni can actually look at it through the week and work the Sunday prep checklist; that presence is what makes the plan change behavior instead of dying in a file. The shopping list is still the action artifact for the grocery run.

## Before Every Invocation

1. Read [learned-rules.md](learned-rules.md) in this directory
2. Read the canonical nutrition context:
   - `~/Eudaimonia/Constitution/Nutrition/README.md` — daily macro targets, meal budgets, supplement stack
   - **Pantry inventory and staples live in the Pinole api db** (migrated from `pantry.md` and `staples.md` on 2026-05-15 in ATE-141), reached through the Pinole MCP tools (`mcp__pinole__list_pantry_items`, etc.) — see the Pantry Access section below.
3. Read the most recent plan(s) from Pinole with `mcp__pinole__list_meal_plans` (and `mcp__pinole__get_meal_plan` for a week's detail) to see what we just ate and avoid repeating it
4. Read [references/recipe-sources.md](references/recipe-sources.md) for the preferred recipe sites and what's worked in the past
5. Determine the target week. Default to the current ISO week. Use `date +"%G-W%V"` for the week identifier.

## Pantry Access

Pantry and staples live in the Pinole api db, reached through the Pinole MCP tools (no `rails runner`, no SQL). Each tool is typed and routes writes through the model, so store normalization and restock bookkeeping happen automatically.

- **`mcp__pinole__list_pantry_items`** — read the pantry. Optional filters: `staple` (only staples), `needs_restock` (only items at or below their restock threshold), `store`. Returns a `collection` of items plus `distinct_stores`. Each item carries per-user state (`staple`, `level` 0 to 4, `restock_at`, `needs_restock`, `store`, `notes`) and delegated product fields (`name`, `brand`, `variant`, `organic`). Stock is quantitative: an item needs restocking when `needs_restock` is true (i.e. `level <= restock_at`), not a boolean in/out.
- **`mcp__pinole__add_pantry_item`** — add something new to the pantry. Identify the product by `name` (plus optional `brand`/`variant`/`organic`); the consumable is created in the catalog if it does not exist. Optional `staple`, `level` (0 to 4, default 4), `restock_at`, `store`, `notes`. Errors if the item is already in the pantry; use update for that.
- **`mcp__pinole__update_pantry_item`** — change `staple`, `level`, `restock_at`, `store`, or `notes` on an existing item. Locate it by `name` (plus optional `brand`/`variant`/`organic` to disambiguate) or by `id`. If a name matches more than one item, the error lists the candidates with ids; retry with an id or a disambiguator. Only the fields you pass change.

A storeless item (no `store` set) surfaces under any `store` filter, so staples with no fixed store are never hidden by a store-filtered read.

## Source of Truth

| Source | Purpose |
|--------|---------|
| `Constitution/Nutrition/README.md` | Daily macros and per meal budgets |
| Pinole api db (`PantryItem`, `Consumable`) via MCP | What is already on hand + brand preferences. Read with `mcp__pinole__list_pantry_items`. See Pantry Access above |
| Pinole api db (`MealPlan`) via MCP | Prior weekly plans. Read with `mcp__pinole__list_meal_plans` / `get_meal_plan`; author with `create_meal_plan` / `update_meal_plan` |
| Pinole api db (`Recipe`) via MCP | Recipes meals link against. Discover with `mcp__pinole__list_recipes`; create new ones (import from a URL or author from scratch) with `mcp__pinole__create_recipe` |
| `references/recipe-sources.md` | Approved recipe sites and historical ratings |
| `learned-rules.md` | Corrections learned through use |

Meal plans live in Pinole, not in markdown. Author them through the MCP tools (see Phase 5 and the Meal Plan Shape section); do not write plan files.

## Principles

- **Plant based.** No meat. Tofu and lentils are the protein backbone. Eggs and Greek yogurt are acceptable but not required.
- **Seasonal.** Lean on what is actually in season at the target week. Check the date when deciding. Spring (now) favors asparagus, snap peas, radishes, artichokes, spring greens, strawberries, new potatoes. Summer favors tomatoes, stone fruit, corn, zucchini, peppers, cucumbers. Use this as a guideline, not a rule.
- **Batch prep friendly.** One prep session on Sunday or Monday carries most of the week. A mid week refresh handles the rest. Favor ingredients that survive the fridge for several days.
- **Macro anchored.** The daily target is 2,112 cal / 118g P / 257g C / 68g F. The shake handles ~32g of protein and ~225 cal. The remaining three meals should roughly split the rest as laid out in README.
- **Realistic for the week.** Social events, travel, and team lunches eat meals. Do not prep for meals that will not happen.
- **A couple of meal kinds, eaten repeatedly.** The whole point of prepping is a few meals eaten several times; one batch can rightly carry four days. Variety comes week to week, not within the week.
- **Recipe backed, not hand waved.** Every real cooked meal links to a Recipe with actual ingredients, amounts, and directions, so Forni can open it and cook it and the macros are computed rather than guessed. If a recipe does not exist yet, create it (Phase 5). Reserve freeform text and estimated macros for genuinely uncooked meals (Social, Out, Leftovers).

## The Plan Flow

### Phase 1: Frame the Week

1. Compute the target week's Monday through Sunday dates
2. Fetch Google Calendar events for that range. Filter out `transparency: "transparent"` (free/informational) events
3. Identify meals we should NOT plan for:
   - Social dinners (restaurants, invited events)
   - Out of town travel
   - Any other eating-out anchors the calendar shows; confirm these against the calendar each run rather than assuming a weekly pattern
4. Confirm the shopping day with Forni rather than assuming it. The Sprouts run after High Noon on Wednesday or Friday is a hint for reading the calendar, not a default; shop days move (2026-07-16's run was a Thursday afternoon).

Present the week back as a simple list of planned vs skipped meals. Ask Forni if anything is missing before continuing.

### Phase 2: Reconcile the Pantry First

**The pantry data drifts and must be reconciled against reality before drafting. Do not trust stock levels at face value, especially after a travel week.** Planning against a stale pantry means building meals around produce that is no longer there and buying duplicates of what is already on hand. This reconcile is the first real move of every weekly plan.

1. Pull the full pantry with `mcp__pinole__list_pantry_items` (see Pantry Access above)
2. **Reconcile the perishables first.** Produce, dairy, and fresh proteins are where the data rots. Present what is currently shown in stock (group hardy vs delicate so it is fast to answer) and have Forni confirm what actually survived; knock everything else to level 0. After a travel week, assume most fresh stock is gone unless he says otherwise. For a full reconcile, present the list and let him name the survivors rather than asking thirty one-at-a-time questions (that scales badly on a phone); reserve the one-at-a-time pattern (see Pantry Rules in learned-rules.md) for the smaller set of genuinely ambiguous staples.
3. Write the reconciliation back immediately with `mcp__pinole__update_pantry_item` (level up survivors, 0 for gone), `mcp__pinole__add_pantry_item` for new items, and `mcp__pinole__remove_pantry_item` for ones no longer tracked, so the rest of the flow reads accurate data. When zeroing, route each out item to its store (or remove it); a storeless `needs_restock` item pollutes every store's shopping view (see Pantry Rules).
4. Then surface restock candidates (staple + `needs_restock`, anything "low" in `notes`) for items used heavily week to week (tofu, soy milk, kimchi, hummus, greens, lentils, rice, oats) and confirm before adding to the shopping list

### Phase 3: Choose the Menu Together

**The menu is a conversation, not a deliverable.** Never compose a finished week and present it for a yes or no; the walking of options IS the value. Work in rounds, one question at a time:

1. **Start from the season.** Read `Constitution/Nutrition/seasons.md` and present the month's board (minus standing dislikes from learned-rules.md) as pickable anchors. Ask which appeal.
2. **Source candidates on the picked anchors.** Check the library first with `mcp__pinole__list_recipes` (prefer rated repeats), then find 2 or 3 candidates per anchor on the preferred sites (WebSearch scoped to those domains). Verify each with WebFetch against the house rules (plant based, no alcohol, no corn, no pasta, no soups, everything in Food Preferences) before showing it; report casualties ("SVB's version has corn, it's out") so the vetting is visible.
3. **Present the board with links** (hyperlink the recipe names) and let Forni pick the centerpieces. One or two centerpieces per week; the rest is batch variations and leftovers.
4. **Audit the picks.** Protein and macro math on the chosen menu against the daily targets, with concrete boosts offered (extra lentils, TVP in the taco beans) rather than silently applied.
5. **Slot the picks into the framed week.** Repeat lunches up to twice; breakfast mostly constant; social days get a freeform "Social" meal rather than being left out. Batch prep steps carry amounts (e.g. "Cook 1.5 cups dry quinoa", never "a big batch"). When Forni states a new like, dislike, avoid food, or allergy at any point, append it to Food Preferences in learned-rules.md with the Why / How to apply structure so the next plan inherits it.

### Phase 4: Present the Full Plan in Plan Mode

**No plan artifact writes to Pinole before this gate.** (The Phase 2 pantry reconcile is the deliberate exception: it records reality, not plan decisions.) Enter plan mode and write the complete plan in the three section format. The plan's one job is decision elimination: the tired mid week moment ("Wednesday 17:30, what happens next") must get its answer in one glance, already cooked.

1. **The Meals.** Every meal and snack named, with Cal / P / C / F per serving. Clean numbers, no tildes or hedge marks (he knows they are estimates). A couple of meal kinds per week, period; snacks are one or two standing items, never per day engineering.
2. **The Plan.** Every meal of every day explicit (breakfast, lunch, snacks, dinner; no "mornings are all the same" shorthand), each day totaled as actual / target for all four macros. Dinners out get an asterisk on the day and the event with a single footnote under the table; those days' totals count home food only.
3. **The Prep.** Numbered cook sessions with exact amounts, times, and temperatures. Fresh proteins and grains cook no more than 2 days ahead, so the back half of the week gets a midweek refresh session. Prep beyond the current week belongs to next week's planning session.

After the three sections: every Pinole write to be made (recipes to create or reuse, authoring the plan, shopping list changes item by item) and the shopping day when there is one. Exit plan mode for approval and execute only on the green light. An AskUserQuestion answer about one meal is not plan approval; the approved plan document is.

### Phase 5: Execute the Writes

1. **Back every real meal with a recipe** so the plan links by `recipe_name` (not freeform text with guessed macros). For each cooked meal and anchor:
   - **Reuse if it exists.** If `list_recipes` already has a good match, link by name; nothing to create.
   - **Import a real dish from a trusted source** by calling `mcp__pinole__create_recipe` with the vetted `url` from Phase 3; the API reads the page's recipe data. When the plan adapts the dish (feta swapped out, protein bumped), author from scratch instead with the adaptations baked in, crediting the site, so the computed macros match what actually gets cooked.
   - **Author simple assembly meals from scratch** with `name`, short `directions`, `servings`, and free-text `ingredients` lines with amounts (one per line, e.g. "2 cups cooked quinoa").
   - **Set `servings` honestly** to what the batch yields, so per-serving macros land right.
   - **Anchors are recipes too.** The breakfast bowl and shake get light recipes once, reused by link in later weeks.
   - `create_recipe` errors if the name exists. Before linking the existing record, confirm it is actually the same dish (check its ingredients via `list_recipes`); if a different recipe wears the name, use a distinguishing name rather than linking blind. New ingredients get USDA macros backfilled automatically; if nutrition comes back incomplete, tell Forni and give a hand-math estimate rather than papering over it.
2. **Author the plan** with `mcp__pinole__create_meal_plan` (or `update_meal_plan` if the week exists; create errors and points you at update). `unmatched_recipes` must come back empty for cooked meals; a name landing there means the recipe was not created, so create it rather than leaving the meal freeform.
3. **Record the recipes** in `references/recipe-sources.md` under "Recipes Used": week, site (or "Claude drafted"), rating left blank.
4. **Build the shopping list as the merged view.** Tracked staples get on the list through their pantry row (`update_pantry_item`: level 0, `store` routed, quantity guidance in `notes`); `mcp__pinole__add_shopping_item` covers untracked one offs and tracked non staples (the list prints staple rows only), quantities in the item name (lb, oz, fl oz; never "1 bag"), brand and recipe hints in `notes`. Never add a shopping item for a staple the pantry already tracks; that prints it twice. Dropping a food means clearing its pantry flag, not saying so in chat. Final step: read back `get_shopping_list` for the store, reconcile it line by line against the intended basket, and print the reconciled list in chat as the backup copy. See the Shopping Rules in learned-rules.md for the 2026-08-04 duplicate incident behind all three rules.

### Phase 6: Close the Loop After the Shop

When Forni reports the shop is done (same session or later), write reality back so next week's Phase 2 reconcile starts nearly true:

1. Ask whether everything made it into the cart or there were misses and substitutions.
2. Check off the bought items with `mcp__pinole__update_shopping_item` (`checked_off: true`).
3. Restore pantry levels for restocked tracked items with `mcp__pinole__update_pantry_item`; add newly tracked items with `mcp__pinole__add_pantry_item` (set `category` and `store`; a consumable born from a recipe import defaults the category to `other`, so fix it). Skip one-shot ingredients that will be consumed within a day or two.

## Shopping List in Pinole

**The list Forni sees in the app is a merged view**: `get_shopping_list` unions staple pantry rows flagged `needs_restock` with open ShoppingItems (non staple rows never print, since 2026-08-18). Both surfaces feed one list, so each food must live on exactly one of them:

- **Tracked staples ride their pantry row.** A tracked staple that is out is already on the list. Set its `level` to 0, route its `store`, and put quantity guidance in `notes` via `update_pantry_item`. Never also add a shopping item for it.
- **`add_shopping_item` is for untracked one offs and tracked non staples** (a single bake's bread flour, a specialty ingredient, this week's seasonal produce; see the staple only rule in learned-rules.md). Keep item names concise but include quantity, e.g. `"Bread Flour, 5 Lb"` (lb, oz, fl oz; never "1 bag"). Brand hints and recipe associations go in `notes`. Set `store`; a storeless item surfaces under every store filter.
- **Dropping a food from the list means clearing its flag** (raise `level`, reroute `store`, or `remove_pantry_item`), never just saying so in chat. A checked off ShoppingItem drops a one off.
- **Always read back `get_shopping_list` for the store as the final step** and reconcile line by line against the intended basket before handing the list over. The authoring calls each look fine alone; only the merged read shows duplicates.

## Meal Plan Shape

`create_meal_plan` authors a full week as one payload, and `update_meal_plan` takes the same full payload or partial edits:

- `week` (ISO, e.g. `"2026-W24"`), `starts_on`, `ends_on` (Monday and Sunday, `YYYY-MM-DD`)
- `intro` — the short one-line summary of the week
- `target_calories`, `target_protein`, `target_carbs`, `target_fat` — the daily macro target snapshot (from README)
- `planned_meals` — one entry per planned meal. Each has a `kind` (`breakfast` / `lunch` / `dinner` / `snack`; the shake is a `snack`), a `day` (`monday`..`sunday`, or `daily` for a meal that repeats every day, e.g. a constant breakfast; always required), and a `recipe_name` linking the recipe created or reused in Phase 5 (macros and ingredients come through automatically). Only genuinely uncooked meals use a freeform `description` (leftovers, social, out) with optional per meal `est_calories`/`est_protein`/`est_carbs`/`est_fat`. Optional `context` (e.g. `"lift, DRC"`).
- To change a few meals in an existing week, `update_meal_plan` takes `edit_planned_meals`, `add_planned_meals`, and `remove_planned_meals` instead of the full `planned_meals` array. Each locates a meal by `day` plus `kind` (or its `id`); an edit sends only what changes, moving a meal with `new_day` / `new_kind`. Never resend the whole week to change a few meals.
- `batch_prep_steps` — the Sunday/midweek prep checklist. Each has a `description` and an optional `target_day` label (e.g. `"Sunday"`).

Call out macro gaps to Forni in chat (e.g., "Fat is ~7g under target; add extra tahini or nuts"), the same way the old plan notes did.

## Recipe Sources

See [references/recipe-sources.md](references/recipe-sources.md) for the full list and ratings history. Primary sites:

- cookieandkate.com
- simpleveganblog.com
- halfbakedharvest.com (filter for plant based)
- budgetbytes.com

When you introduce a new recipe, add a row to the "Recipes Used" table with the week, recipe title, site, and a blank rating. Forni fills ratings in over time. If a recipe turns into a repeat favorite, note it in the "Favorites" section.

Feel free to suggest new sites similar in vibe (plant based, seasonal, approachable). Add candidates to the "Candidate Sites to Try" section rather than introducing them directly.

## Pantry Update Pattern

When Forni mentions outside this skill that he bought or finished something (e.g., "grabbed two blocks of tofu at Sprouts"), update the pantry with `mcp__pinole__update_pantry_item` (set `level` back up when restocked, down when used up), or `mcp__pinole__add_pantry_item` if it is not tracked yet. This keeps the inventory accurate without needing a formal mode. When running the plan, always re query fresh rather than trusting cached state.

## Constraints and Defaults

**Durable constraints** (unlikely to change without Forni flagging):

- **IF window**: 7:30 to 18:30. No dinner scheduled after 18:30.
- **Shake timing**: PLNT v2 + 1 cup Silk soy milk. Usually post workout or mid morning. Count toward daily macros.
- **Weekends**: Saturday is Adventure Day; lunch is often on the go. Sunday is rest and planning; dinner works from leftovers.

**Current weekly pattern** (things that *can* go stale as jobs and seasons change — **always verify against the calendar pulled in Phase 1**, and update the date stamp below when confirmed or corrected):

- **Tuesday evening**: DRC run club meets ~18:00 at Ratio Beerworks. Plan dinner before, optional protein snack after. *(Confirmed 2026-04-17.)*
- **Wednesday midday**: PAH Kitchen Assistant volunteering ~13:00 to 15:00; lunch goes before leaving at 12:30. *(Confirmed 2026-04-17.)*

The calendar is the source of truth. These patterns are hints for interpreting calendar events, not substitutes for them.

## Learned Rules

See [learned-rules.md](learned-rules.md). Append to that file when Forni corrects a choice (wrong recipe type, too many chickpeas, missed a staple, etc.) so the skill improves over time.
