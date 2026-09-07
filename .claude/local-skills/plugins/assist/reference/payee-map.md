# Payee Map (Spend Categorization Rules Engine)

Read on every `assist:handle-budget` run. Generated from YNAB transaction history (payee -> dominant category), refreshed by re mining with the recipe in the skill's Refreshing the Map section. Last mined 2026-09-07 from the trailing year against the restructured category tree. Corrections live in [learned-rules.md](../learned-rules.md) under `## Spend Categorization` and OVERRIDE this file.

How to use it:

- **Skip** (never categorize, they are account moves): any payee whose name matches `Transfer`, `CRCARDPMT`, `AUTOPAY`, `External Transfer`, `P2P`, `RECURRING FROM CHK`, `Online Scheduled Payment`, `PAYMENT FROM CHK`, `Confirmation`, `Descriptive Withdrawal/Deposit`. Leave uncategorized.
- **Inflows** (income, route to `Inflow: Ready to Assign`, not a spend category): see the Inflows list below.
- **Auto categorize**: payees below with a clear historical category (at least 80% of two or more transactions). Apply silently.
- **Always confirm**: payees whose history is split. Ask before applying; do not auto default.
- **New payees** (not listed): ask the user one by one, then append the decision to learned-rules.md so it sticks.

Trip handling: itemize each trip charge into its real category (coffee to Cafés, meals to Dining Out) AND set the transaction memo to `<emoji> <Trip Name>` (e.g. `🏔️ Crested Butte`, `⛰️ Four Pass Loop`). Forni's own convention, NOT a YNAB flag. This keeps everyday categories clean while letting a trip be totaled by its memo.

Housing: `Matthew Bigelow` was Rent through May 2026 (the category is now hidden). Since the 3033 Blake purchase, `🏡 Housing` carries the Onity mortgage, the Rail Yard Lofts HOA, and the Account Integrators eCheck fee.

## Auto Categorize (clear history, apply silently)

- **🛒 Groceries**: Sprouts (24), Safeway (18), King Soopers (10), Natural Grocers (7), Raquelita's Tortillas (6), Whole Foods (6), Spinellis (5), Trader Joe's (5), Costco (4), Clark's Market (3), Albertsons (2), Brothers Market (2), Chelatchie Prairie General Store (2), City Market (2), FamilyMart (2), Mountain Earth Grocery (2)
- **🍟 Fast Food**: Domino's (52), Illegal Pete's (27), Sliceworks (5), DoorDash (4), McDonald's (4)
- **🍾 Sobriety**: York Street Club (43), High Noon (16), New Zanzibar Billiards (3), Dakota Schwarz (2)
- **☕️ Cafés**: Improper City (11), Blue Sparrow Coffee (6), Crema Coffee House (3), Gorsuch Ski & Cafe (3), Ragamuffin Coffee (3), Before & After (2), Blend.co (2), Bunny and Clyde's (2), Camp 4 Coffee (2), Corvus Coffee Roasters (2), Huckleberry Roasters (2), Invigatorium (2), Lazybird Coffee (2), Queen City Collective (2), Starbucks (2), Station 24 Cafe (2), Wash Perk (2)
- **🌏 Adventure**: Airbnb (9), United Airlines (9), Foreign Transaction Fee (8), Booking.com (3), Jetstar (3), Azam Mughal (2), Cajun Encounters (2), Highway Bus (2), Hokkaido Resort Liner (2), Inn the Clouds (2), Kajiwara Kitchen Supply (2), Kuroneko Yamato (2), Southwest Airlines (2), The Bidwell (2)
- **🚬 Nicotine**: 7-Eleven (42), ARCO (2), Nesbit's Magazine St Mkt (2)
- **🚙 Transportation**: Suica (7), Maverik (6), Sinclair (6), Veo (6), Shell (5), Circle K (3), Public Works (3), Amtrak (2), ExxonMobil (2), JR East (2), Keisei Skyliner (2)
- **🍿 Entertainment**: Amazon Prime (11), Nick Titus "📺" (6), Netflix (5), Prime Video (3), Spotify (3), AXS (2), Buffalo Exchange (2), Hulu (2)
- **🤲 Giving**: Project Angel Heart (13), Charity: Water (12), Colorado Mountain Club (6), We Dont Waste (3)
- **🍽️ Dining Out**: Drift Food & Beverag (3), Shibuya Tokyu Foodshow (3), The Corner Beet (3), Great Divide Brewery (2), Himchuli Indian (2), New Moonlight Pizza (2), TST* 1926 (2), Willie's (2)
- **🏡 Home Improvement**: Ace Hardware (7), Mill Industries (5), Carbon Knife Co (2), Off the Bottle (2), The Home Depot (2)
- **🏥 Healthcare**: Elevate Health Plans (8), River North Dentistry (4), Anthem Blue Cross Blue Shield (2), Epic Hospital & Clinic (2)
- **🧖 Personal Care**: Cult of Mane Salon (5), CVS Pharmacy (3), Naosu Sauna (3), Pratt Physical Therapy (3), Hair By Luis Miguel (2)
- **⚡️ Utilities**: Xcel Energy (12)
- **🌲 Outdoorsman**: REI (9), Smith Optics (3)
- **🧥 Clothing**: Keep it Local (3), Adan Tailoring (2), Arc Thrift Stores (2), Goodwill (2)
- **🛋️ Therapy**: Elizabeth Sump (8)
- **🧽 Cleaning**: Blue Spruce Service (5), Joan of Clean (2)
- **❤️ Romantic**: Comedy Works (2), Nocturne (2)
- **💪 Fitness**: Cal Lutheran Pool (2), Movement RiNo (2)
- **💊 Supplements**: Nutrafol (3)
- **🎁 Gifts**: Rapha Racing (2)
- **🏡 Housing**: Onity Mortgage (2)
- **💳 Card Fees**: Annual Membership Fee (2)
- **🪪 Insurance**: GEICO (2)

## Always Confirm (history is split, ask first)

- **ATM Withdrawal** (2 txns, 50% 🌏 Adventure); confirm, buys across categories.
- **Amazon** (40 txns, 63% 🏡 Home Improvement); confirm, buys across categories.
- **Arc Thrift** (12 txns, 58% 🏡 Home Improvement); confirm, buys across categories.
- **Conoco** (4 txns, 50% 🚙 Transportation); confirm, buys across categories.
- **Denver Parks & Rec** (2 txns, 50% ❤️ Romantic); confirm, buys across categories.
- **Exxon** (3 txns, 67% 🚙 Transportation); confirm, buys across categories.
- **Grab & Go** (2 txns, 50% 🚬 Nicotine); confirm, buys across categories.
- **Guiry's** (2 txns, 50% 🎁 Gifts); confirm, buys across categories.
- **Hello Darling** (3 txns, 67% ❤️ Romantic); confirm, buys across categories.
- **Joe's Liquors** (3 txns, 67% ☕️ Cafés); confirm, buys across categories.
- **Neo** (2 txns, 50% Inflow: Ready to Assign); confirm, buys across categories.
- **Phillips 66** (5 txns, 60% 🚬 Nicotine); confirm, buys across categories.
- **QuikTrip** (4 txns, 75% 🚙 Transportation); confirm, buys across categories.
- **Rumors** (2 txns, 50% ☕️ Cafés); confirm, buys across categories.
- **St. Mark's Coffeehouse** (3 txns, 67% ☕️ Cafés); confirm, buys across categories.
- **USPS** (3 txns, 67% 🎁 Gifts); confirm, buys across categories.

## Inflows (route to Inflow: Ready to Assign, not spend)

Bank of America (2), CDLE UI Benefits (4), Chase (5), Credit Dividend (12), Fidelity (8), First Tech Federal Credit Union (5), RYLLC Income (5), Standard transfer (4), Venmo (10), Zero Homes (9)
