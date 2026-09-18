# Learned Rules: assist:plan-meals

Corrections and preferences specific to meal planning. Read on every invocation. Append when Forni corrects a decision so the skill improves over time. General defaults live in SKILL.md.

## Planning Rules

- **Default target week depends on invocation day.** Invoking on Wednesday or later means plan the NEXT week (Mon through Sun), not the current one. Shop on the Fri High Noon Sprouts run, batch prep Sun/Mon.
  - Why: Forni confirmed this pattern on 2026-04-17 when we tested the skill. Matches the Fri shop cadence and avoids half planning a week that is mostly already spent.
  - How to apply: if today is Mon or Tue, default to this week; Wed through Sun, default to next week. Still confirm with Forni in Phase 1.

- **DRC on Tuesday evenings is a running event, not social drinking.** Ratio Beerworks is just the meeting point. Plan a normal dinner BEFORE the run and a high protein snack after.
  - Why: Forni clarified on 2026-04-17 that DRC is Denver Run Club.
  - How to apply: on weeks with DRC, treat Tuesday dinner as a standard slot timed to eat before the ~18:00 start. Do not skip it and do not plan for a brewery meal.

- **Wednesday PAH volunteering (Kitchen Assistant, 13:00 to 15:00) means lunch goes BEFORE leaving at 12:30.** Pack or eat at home around 11:30 to 12:00. Do not plan a lunch for after PAH since he's driving straight home.
  - Why: Forni confirmed on 2026-04-17.
  - How to apply: on weeks with PAH on the calendar, Wednesday lunch is a packed/early lunch slot, not a normal 12:00 to 13:00 window.

- **Thursday "Kitchen Cruising" with Ross is an optional social cooking event**, not a fixed commitment. Don't reorganize the meal plan around it; plan a normal Thursday dinner and let Forni flex if the event is on.
  - Why: Forni clarified on 2026-04-17 that it's a "fun cooking" thing with Ross, not required.

- **The menu is a conversation, not a deliverable.** Start from what is in season (read `seasons.md`), ask which seasonal anchors appeal, source 2 or 3 candidate recipes per anchor from the approved sites, verify them against the house rules, and walk the choices with Forni one question at a time. Never compose a finished menu and present it for a yes or no.
  - Why: On 2026-07-16 the first W29 draft was composed, authored, and pushed to Atelic in one motion. Forni pulled it back: "can we discuss the menu before you just make decisions on my behalf." The walking of options IS the value, not overhead.
  - How to apply: Phase 3 is a dialogue: seasonal anchors first, then sourced options with links, then his picks, then protein and macro audit on the picks. Only then does a full plan exist to present.

- **Plan mode gate: present the complete plan and get approval before ANY plan artifact write to Pinole.** No recipe creation, no meal plan authoring, no shopping list push until Forni has approved the full picture (menu, prep with amounts, every Pinole write, shopping list changes) through plan mode. The Phase 2 pantry reconcile is the one deliberate exception; it records reality, not plan decisions.
  - Why: Forni asked for this explicitly on 2026-07-16 ("switch into planning mode and present it") after the first draft went to Atelic without a review gate. An AskUserQuestion answer about one meal is not plan approval.
  - How to apply: after the menu conversation lands, enter plan mode, write the full plan (readable prose, amounts everywhere), and exit plan mode for approval. Execute only after the green light.

## Shopping Rules

- **The shopping list IS the merged view: pantry restock flags plus one off shopping items. Never add a shopping item for a food the pantry already tracks as a staple.** `get_shopping_list` unions pantry rows with `needs_restock` true and open ShoppingItems into one list. A tracked food that is out is therefore already on the list; adding a shopping item for it prints the food twice. Drive tracked foods entirely through the pantry row (`update_pantry_item`: set `level` 0, route `store`, put quantity guidance in `notes`). Reserve `add_shopping_item` for genuinely untracked one offs (bread flour for a single bake, a specialty ingredient) that have no pantry row and should not get one.
  - Why: On 2026-08-04 the Sprouts list rendered roughly 43 lines for a 25 item shop. Ten tracked staples printed twice because a shopping item was added for each food whose pantry row already flagged it. Forni opened the app mid shop and hit a wall of duplicates.
  - How to apply: before every `add_shopping_item`, check `list_pantry_items` for the food first. A tracked staple means update the pantry row instead; a tracked non staple rides a one off shopping item, since the list prints staple rows only. Untracked but recurring means add it to the pantry with level 0 rather than as a shopping item.

- **Dropping an item from the list means clearing its pantry flag, not saying so in chat.** A food stays on the list until its pantry row stops flagging `needs_restock`. Prose has no effect on the rendered list.
  - Why: Same 2026-08-04 shop: asparagus, arugula, super greens, and tzatziki were declared dropped in conversation but their rows still flagged, so all four printed anyway.
  - How to apply: to drop a tracked food, either raise its `level` (it is actually stocked), route it to a different `store` (buy it elsewhere later), or `remove_pantry_item` (stop tracking it). To drop a one off, check the ShoppingItem off with a note saying why.

- **Read back the merged `get_shopping_list` view for the store before declaring the list done.** The authoring surface is not the shopping surface; only the merged read shows what Forni will actually see in the app.
  - Why: The 2026-08-04 duplicates were invisible at authoring time because each add looked reasonable alone. One read back of the merged view would have caught all of them before the store did.
  - How to apply: final step of every list build: call `get_shopping_list` filtered to the store, compare it line by line against the intended basket, and reconcile every extra or missing line before handing the list over. Print the reconciled list in chat as the backup copy.

- **`get_shopping_list` prints staple rows only, so a tracked non staple rides a one off shopping item and never duplicates.** The merged view unions pantry rows with `staple: true` and `needs_restock: true` plus open ShoppingItems. A tracked non staple at level 0 (cucumbers, lemons, peaches, cilantro, jalapenos, tomatoes) is out but never prints, so the 2026-08-04 duplicate hazard applies only to staple rows.
  - Why: Confirmed on the 2026-08-25 post vacation Sprouts list; the tool narrowed to staples only after the 2026-08-04 duplicate incident. Flipping `staple` on for a one week seasonal buy is wrong because it nags every week after.
  - How to apply: staples still ride their pantry row (level 0, store routed, quantity in notes). Seasonal or single week produce that the pantry tracks as a non staple gets `add_shopping_item` with the quantity in the name, and Phase 6 restores its pantry level after the shop. On a bare week with no Costco run coming, reroute the needed Costco staples to Sprouts with "Costco normally, route back after the shop" in notes, and route them back in Phase 6. Still read back the merged store view before handing the list over.

- **All bulk dry goods come from Sprouts, not Costco.** Beans (black, kidney, adzuki), rice (white basmati, brown short grain), lentils (green, red), quinoa, and similar bulk items live in the Sprouts bulk bin section.
  - Why: Forni said on 2026-04-17 "I LOVE their bulk section."
  - How to apply: when generating a shopping list, put dried beans, rice, lentils, quinoa, and related bulk staples under Sprouts. Costco is for jarred/packaged items (kimchi, hummus, olives, artichokes, pickled onions, yogurt, nuts, coffee, vanilla extract).

- **The primary shopping list goes into Pinole via `mcp__pinole__add_shopping_item`.** One call per item, with `store` set and quantity/brand hints in `notes`; it surfaces in the Pinole app for the run. (The system was named Atelic until 2026-07-20.)
  - Why: superseded Apple Reminders in ATE-353 (2026-06-16) when meal plans moved into the app; the shopping plan now lives alongside the pantry rather than in a separate app.
  - How to apply: See the "Shopping List in Pinole" section of SKILL.md. Only push items for the store being shopped that day; other stores can be added with their own `store`.

- **Quantities in lb, oz, fl oz, or grams. No "1 bag", "1 carton", "1 bunch", "1 container", "1 loaf".** Packaging sizes vary by store and brand; actual weight or volume is what gets Forni the right amount.
  - Why: Forni corrected this on 2026-04-17. Container units are ambiguous.
  - How to apply: convert everything to the unit most natural for the ingredient. Produce by the lb or oz (e.g. asparagus 1 lb, mint 1 oz). Liquids in fl oz. Small specialty amounts in grams or oz. Bread as a loaf weight ("~1 lb loaf"). Bulk bin items by weight.

- **Shopping list groups by store section, not produce subtype.** No "leafy & herbs", "alliums & roots", "fruits & veg" sub buckets. One flat "Produce" section.
  - Why: Forni said "having alliums and roots and leafy and herbs and fruits and veg, it's fine. Just produce is fine" on 2026-05-15.
  - How to apply: shopping list sections are Produce, Refrigerated, Bulk Bins, Center Aisles / Spices, Frozen, Snacks. No further subdivision within a section.

- **Vanilla extract is a Costco staple.** Sprouts does not reliably carry it; Costco does.
  - Why: Forni confirmed on 2026-04-17.
  - How to apply: when vanilla is needed, put it in the Costco section of the shopping list, never Sprouts.

## Recipe Rules

- **No alcohol in any recipe, ever.** No cooking wine, no beer batters, no bourbon glazes, no mirin (which contains alcohol), no rum extract. Even "the alcohol cooks off" is a no.
  - Why: Forni is in twelve step recovery. Cooking with alcohol is adjacent enough that it's not wanted. Confirmed on 2026-05-15 when bourguignon (red wine) and risotto (white wine) were both rejected.
  - How to apply: when a classic recipe calls for wine, substitute vegetable broth + a splash of vinegar (red wine vinegar for red, white wine vinegar or rice vinegar for white) and a touch of tomato paste or miso for umami. For deglazing, broth or balsamic works. Skip any dish where alcohol is structurally essential (bourguignon, risotto, beer can chicken, etc.) and propose something different.

- **"Fun food" does not mean high variety.** Going back to basics with one or two fun centerpieces is what lands. Five new specialty cuisines in one week is too much shopping, too much context switching, and reads as scattered.
  - Why: Forni rejected the W21 draft on 2026-05-15 with "way too much variety." He had asked for fun food but the response (bourguignon + risotto + bibimbap + pad thai + soba) was over indexed.
  - How to apply: pick one or two centerpiece dinners per week. The rest is batch prep variations (bowls, stir fry, leftovers). Specialty ingredient purchases should support the centerpiece, not five different cuisines.

- **No soups, hot or cold.** Not a soup fan in general; gazpacho and other chilled soups included.
  - Why: Stated 2026-07-16 when gazpacho was offered as a summer blender showcase. This REVERSES the 2026-04-17 blender soup experiment rule that used to live here; do not resurrect it.
  - How to apply: do not propose soups of any kind (pureed, chunky, brothy, chilled) unless Forni explicitly asks. The immersion blender earns its keep on sauces, dressings, and salsas instead.

- **No bananas.** Forni does not eat them, anywhere.
  - Why: Forni said so on 2026-04-17.
  - How to apply: do not propose recipes that use bananas, and do not include bananas on any shopping list. For the quinoa breakfast alt (previously sweetened with banana), use dates, a small drizzle of agave, or seasonal berries instead.

## Food Preferences

Standing likes, dislikes, and avoid foods. Read before drafting any plan, cross-check the draft against this list, and append here whenever Forni states a new preference during planning. New entries follow the same Why / How to apply structure as the rules above. A durable product home for preferences and allergies is tracked as a Pinole ticket; until it ships, this section is the source of truth.

**Format preference:**

- **Fresh and raw forward; one cook maximum per dish.** Prefers dishes built from very fresh, raw ingredients that need little cooking, and never a second cook after the lentils, chickpeas, or grains are done. Cook a base once, assemble raw on top.
  - Why: Stated 2026-08-02 during W32 planning, arriving home exhausted: "I much prefer dishes with very fresh, raw ingredients that don't require a ton of time to cook up or don't require a second cook after making the chickpeas or lentils or whatever."
  - How to apply: Bias menus toward one cooked base plus raw assembly (bowls, marinated salads). A true cooked centerpiece is fine when deliberately chosen for Cook Night, never as the default shape.

- **No stuffed vegetables.** Stuffed peppers read bland (W29/W30), stuffed tomatoes were declined unseen.
  - Why: Stated 2026-08-02. The format buries fresh ingredients under a second cook.
  - How to apply: Do not propose stuffed pepper, stuffed tomato, or stuffed squash formats.

**Produce preference:**

- **Tomatoes on the vine over any other slicing variety.** Cluster, roma, and heirloom are fallbacks, not equals.
  - Why: Stated 2026-08-25 when the list carried "slicing tomatoes, any variety": "I tend to prefer those."
  - How to apply: write tomato lines as "Tomatoes on the vine, N" and keep the on vine pantry row as the slicing tomato of record.

**Dislikes / avoid:**

- **Corn.** Keep it off menus and shopping lists entirely.
  - Why: Dislikes the taste, and it disagrees with his digestion. Stated 2026-06-21.
  - How to apply: Do not propose recipes containing corn, and never add it to a shopping list.
- **Pasta.** Favor grain bowls and skillet formats over pasta dishes.
  - Why: Not a fan of pasta. Stated 2026-06-21.
  - How to apply: Reach for quinoa or rice instead of building a meal around pasta.
- **Bananas.** Does not eat them, anywhere.
  - Why: Stated 2026-04-17. See the dedicated rule under Recipe Rules above.
  - How to apply: No bananas in recipes or on shopping lists; sweeten with dates or berries instead.

**Grain preference:**

- **Quinoa over rice** when a recipe leaves the grain open.
  - Why: Stated preference on 2026-06-21.
  - How to apply: Default to quinoa unless the recipe specifically calls for rice or Forni asks for it.

**Already well stocked (do not add to a list by default, confirm first):**

- **Tahini.** Do not add to a list by default; confirm first.
  - Why: Owns plenty. Stated 2026-06-21.
  - How to apply: Use lemon juice plus olive oil for bowl dressings rather than defaulting to tahini.

## Macro Rules

- **A recipe amount is always stated in the form that gets eaten, which is cooked.** Lentils, quinoa, rice, and beans are never eaten raw, so the ingredient line carries the cooked weight and the dry measure lives in the preparation note and the directions.
  - Why: Pinole's `UsdaNutritionService` bonuses cooked and canned forms, so a shared consumable like Quinoa matches cooked nutrition. A line stating a dry amount against a cooked match undercounts by roughly three times. Caught on 2026-08-31 when the delicata salad reported 557 cal per serving instead of 657. Forni settled it: "I'm never gonna eat uncooked lentils... we are going to use the cooked nutrition always."
  - How to apply: write the ingredient as the cooked weight, put "cooked, from N cups dry" in the preparation, and keep the dry measure in the directions where it is actually measured. Rough yields: quinoa and lentils both roughly triple from dry weight.

- **Verify a recipe's macro panel after authoring it, and do not trust `is_complete` alone.** A recipe can report complete and still be wrong.
  - Why: same session. The panel read complete while the quinoa line was undercounting by 800 calories, because every ingredient resolved; none of them resolved *correctly*.
  - How to apply: hand calculate the per serving figure independently and compare. A gap over about 10 percent means a consumable is matched to the wrong form.

## Unit Rules

- **Weights metric, volumes imperial, oven temperature Fahrenheit.** Within weights, grams up to 1,000 and kilograms above, so a line reads 340 g or 1.75 kg, never 1,750 g.
  - Why: settled 2026-08-31. Forni: "I do want it either all in imperial or all in metric and my thought is we should go metric," then scoped it after seeing that volumes cannot follow.
  - How to apply: recipe 265, Delicata Squash and Green Lentil Grain Salad, is the reference implementation. Note this governs recipes; the *shopping list* stays in lb and oz for produce, because that is how it is bought.

- **Never set a Pinole ingredient's unit to `ml`.** It is accepted and saved, and it silently destroys nutrition resolution for that ingredient.
  - Why: converting six volume lines from cup/tbsp/tsp to exact ml equivalents on 2026-08-31 dropped the recipe from 657 to 586 cal per serving with no error. `ML_PER_VOLUME` maps cup, tbsp, and tsp but a raw `ml` measure has no path to grams. Tracked as item 5 of ATE-516.
  - How to apply: use cup, tbsp, and tsp for volumes until that ticket lands.

## Plan Format Rules

- **Use a single combined daily table for lunch + dinner, not two separate tables.** Same Day column, Lunch column, Dinner column. Easier to scan.
  - Why: Forni called the split "weird and hard to read" on 2026-05-15.
  - How to apply: in the "Daily Meals" section, render one table with Day / Lunch / Dinner columns. Keep breakfast as a separate paragraph above since it's mostly constant.

- **Weights and amounts apply to BATCH PREP too, not just the shopping list.** No "3 sweet potatoes", "1 bag spinach", "1 bunch asparagus" in the prep section either. Use lb, oz, fl oz, grams.
  - Why: Forni corrected this on 2026-05-15 — "I don't know how much that is" applies to the prep section just like the list.
  - How to apply: every quantity, everywhere in the plan, in weight or volume units. Pantry references can stay loose since they're identity not quantity.

- **Sweet potatoes scale down.** ~1 lb (about 2 medium) per week is plenty if they're a side / oat bowl topping, not a centerpiece. 3+ lb lasts way too long.
  - Why: Forni said 3 large last week (W17) lasted too long on 2026-05-15.
  - How to apply: default to 1 lb / 2 medium unless the menu has sweet potatoes as a main two or more nights.

- **Tofu restocks at two blocks (32 oz) minimum.** One block is never enough for a week.
  - Why: Forni, 2026-08-25: "two blocks of super firm tofu, bare minimum."
  - How to apply: any tofu line on a Sprouts list reads "2 blocks (32 oz)" or more; size up when tofu is a centerpiece.

## Pantry Rules

- **Reconcile the pantry against reality FIRST, before drafting the plan.** Treat the stored stock levels as a stale draft, not truth, especially after a travel week. Knock down what is gone and confirm survivors before planning anything.
  - Why: On 2026-06-27 the pantry claimed a full summer produce drawer (4 tomato entries, 3 bell peppers, broccoli, kale, etc.) after a week in a rental kitchen. Planning against it would have built meals around food that did not exist and bought duplicates. Forni called for reconciliation to be step one of every weekly plan.
  - How to apply: this is Phase 2 of the flow. Present perishables grouped hardy vs quick to expire, let Forni name the survivors, zero the rest, write it back, then plan against the corrected pantry.

- **Say "quick to expire," not "delicates."** Group the reconcile as quick to expire vs hardy; Forni found "delicates" an odd word for produce (2026-08-02).

- **A full reconcile is a "name the survivors" pass, not thirty one-at-a-time questions.** The one-at-a-time rule below is for the smaller set of genuinely ambiguous staples, not for a whole-fridge audit.
  - Why: After travel, most fresh stock is gone, so it is faster for Forni to list the few survivors than to tap through every item. He is often mobile (e.g. shopping) when this happens and dislikes tedious phone input.
  - How to apply: present the in-stock perishables grouped hardy vs quick to expire and ask him to name what is still good; zero everything he does not name.

- **Zeroing a non-staple still flags it `needs_restock`, and storeless items show under every store filter.** A bulk reconcile that zeros lots of produce floods every store's shopping view unless each out item carries a store.
  - Why: On 2026-06-27, zeroing about 30 produce items buried the Costco shopping view under out-of-stock produce, because storeless `needs_restock` rows match all store filters.
  - How to apply: when zeroing during a reconcile, route each out item to the store it is bought at (or `remove_pantry_item` if it is untracked / no longer wanted) so each store's list stays the clean "what to grab here" surface.

- **Pantry inventory questions go one at a time, not in a batch.** Use AskUserQuestion with structured options rather than asking for a batched reply in chat.
  - Why: Forni corrected this on 2026-04-17. A long checklist in chat feels tedious; one question at a time keeps the rhythm conversational.
  - How to apply: loop through pantry items individually. Each question should offer the common answers (Yes on hand, No need to buy, Have some but low, Skip) plus a free text option for quantity or notes. (Exception: a full post-travel reconcile uses the "name the survivors" pass above, not this.)

## Plan Presentation (Codified 2026-07-19, Week 30 Session)

- **The plan's one job is decision elimination.** The mid week moment ("Wednesday 17:30, tired, what happens next") must get its answer in one glance, already cooked. Every format choice serves that; macros exist so Forni never has to think about them mid week, not so he reads them daily.
- **Present every plan in three sections: The Meals, The Plan, The Prep.** The Meals names each meal with full macros (Cal / P / C / F), snacks included, the trust layer read once at approval. The Plan shows every meal of every day explicitly (breakfast, lunch, snacks, dinner; no "mornings are all the same" shorthand) with per day totals shown as actual / target for all four macros. The Prep is numbered sessions with exact amounts and times.
- **A couple of meal kinds per week, period.** The whole point of prepping is a few meals eaten several times. Do not engineer per day snack variety or one off meals to tune macros; a protein bar and one snack pairing is plenty. Forni, 2026-07-19: "The whole point of meal prepping is to make a couple kinds of meals... make this very fucking simple."
- **No tildes or hedge marks on estimates in the presented plan.** He knows they are approximate. Clean numbers only.
- **Dinner out days: asterisk the day and the event, one footnote under the table.** Do not scatter asterisks across every cell; totals count home food only.
- **Breakfasts are protein and carb forward, never fat heavy.** The 21g fat yogurt bowl was rejected 2026-07-19; more yogurt, fruit forward, granola as a sprinkle.
- **Fresh proteins and grains cook no more than ~2 days ahead.** Back half meals get a midweek refresh session (bake tofu and cook grains Wednesday for Friday, never Sunday for Friday).
- **Prep beyond the current week belongs to next week's planning session.** Do not put next Sunday's cooking in this week's plan.
