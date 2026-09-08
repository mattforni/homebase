# Triage Rules

Classification rules for inbox email triage. Read email-rules.md and learned-rules.md first; those override anything here.

## Purchase Detection

Auto-process (label, mark read, archive) when ANY of these match:

**Sender patterns** (case insensitive):

- `*@amazon.com`, `*@amazon.co.*`
- `*@shopify.com`, `*@myshopify.com`
- `*@paypal.com`, `*@paypal.co.*`
- `*@stripe.com`
- `*@square.com`, `*@squareup.com`
- `*@apple.com` with receipt/order in subject
- `noreply@*` with order/shipping/delivery in subject
- `*@ups.com`, `*@fedex.com`, `*@usps.com`, `*@dhl.com`

**Subject patterns** (case insensitive, any of):

- "order confirmation", "order shipped", "order delivered"
- "shipping confirmation", "shipping notification", "tracking number"
- "your receipt", "payment receipt", "invoice"
- "out for delivery", "delivery notification"
- "your order has", "thank you for your order"

**Known purchase senders** (from inbox research):

- `noreply@olo.com` (Illegal Pete's orders)
- `care@sijohome.com` (Sijo orders/shipping)
- `info@info.quince.com` (Quince orders/shipping)
- `webmaster@groomsgrotto.com` (The Grotto menswear)
- Cozy Earth
- Any Shopify-powered store (check headers)

**Multi-label purchases** (get Purchases + a second label):

- `invoice+statements@mail.anthropic.com` -> also `🛠️ Craft/🧑‍💻 Development` (Anthropic receipts)
- `noreply@singenuity.com` -> also `🛠️ Craft/🌏 Adventure` (Cajun Encounters, tour bookings)
- Tech tools/dev subscriptions -> also `🛠️ Craft/🧑‍💻 Development`

Target: `📑 Admin/🛒 Purchases`. Always mark read and archive.

## Star Rules

Star semantics are governed by the "Star semantics" rule in email-rules.md (Star Semantics): the star answers "who has the ball." Do not restate the definitions here; that rule is the single source of truth.

**Core behavior:**

- Never star emails that get archived. Stars mean action is needed.
- Always mark emails as read when archiving. Remove both INBOX and UNREAD together.

## Family Rules

Family emails always get surfaced for response, regardless of content.

**Known family senders:**

- `mfornaciari2000@yahoo.com` Michael Fornaciari (dad): Likes to send articles and links. Read the full content, summarize the article/topic, offer to draft a warm, appreciative reply.
- Any sender in `🤗 Community/👨‍👩‍👦‍👦 Family` label history

**Handling:**

1. Label `🤗 Community/👨‍👩‍👦‍👦 Family`
2. Yellow or red star (red if >3 days old)
3. Read full email content
4. Present overview to user
5. Offer to draft reply

## Routing Signals

Use these to determine pillar sublabel assignment. Always prefer the most specific sublabel.

**Known sender routing** (exact matches, highest priority):

- `samwieds@gmail.com` -> `🤗 Community/👬 Friends` (Sam Wiedemeier; adventure/outdoor content may also get `🛠️ Craft/🌏 Adventure`)
- `mealplanner@richroll.com` -> `🍏 Constitution/🥕 Nutrition`, archive + Linear ticket in Atelic
- `gifts@childhelp.org` -> `🤗 Community/🤲 Giving` (donation receipts, archive)
- `do_not_reply@geico.com` -> `🍏 Constitution/🪪 Insurance` (NOT Healthcare; GEICO is auto insurance)
- `kettlesarah@gmail.com` -> `🛠️ Craft/💻 TPF` (Sarah Kettles, TPF associate)

**Constitution signals:**

- Auto insurance (GEICO) -> `🍏 Constitution/🪪 Insurance`
- Health insurance, medical -> `🍏 Constitution/🏥 Healthcare`
- Financial, banking, investment -> `🍏 Constitution/💰 Financial`
- Tax documents -> `🍏 Constitution/💰 Financial/💸 Taxes`
- Trust/estate -> `🍏 Constitution/💰 Financial/📜 Trust`
- Gym, fitness, running, climbing -> `🍏 Constitution/💪 Athlete`
- Supplements, diet -> `🍏 Constitution/🥕 Nutrition`
- Grooming, skincare -> `🍏 Constitution/🧖 Personal Care`
- Recovery, AA, meetings -> `🍏 Constitution/🍾 Sobriety`

**Contemplation signals:**

- Books, reading lists, Kindle -> `🧠 Contemplation/📖 Reading`
- Streaming, TV, movies, music -> `🧠 Contemplation/🍿 Entertainment`
- Therapy, counseling -> `🧠 Contemplation/🛋️ Therapy`
- Courses, education, learning -> `🧠 Contemplation/👨‍🎓 Education`

**Community signals:**

- Jasmine -> `🤗 Community/😘 Jasmine`
- Family members -> `🤗 Community/👨‍👩‍👦‍👦 Family`
- Friends (personal social) -> `🤗 Community/👬 Friends`
- Brown University -> `🤗 Community/🏛 Brown`
- Book club -> `🤗 Community/📚 Book Club`
- SCF -> `🤗 Community/🌱 SCF`
- Denver events/community -> `🤗 Community/🌇 Denver`
- Italian language -> `🤗 Community/🇮🇹 Italiano`
- Charity, volunteering -> `🤗 Community/🤲 Giving`
- Seattle contacts -> `🤗 Community/⚓ Seattle`

**Craft signals:**

- Job search, recruiting, career -> `🛠️ Craft/💼 Vocation`
- Zero Homes -> `🛠️ Craft/💼 Vocation/0️⃣ Zero` (historical; W2 ended 2026-06-29, still matches old mail)
- Gremlin -> `🛠️ Craft/💼 Vocation/😈 Gremlin` (historical; still matches old mail)
- Networking, intros, conferences -> `🛠️ Craft/💼 Vocation/🕸 Networking`
- Mentorship -> `🛠️ Craft/💼 Vocation/👨‍🏫 Mentorship`
- Software, dev tools, GitHub -> `🛠️ Craft/🧑‍💻 Development`
- RYLLC, consulting -> `🛠️ Craft/💻 RYLLC`
- Atelic -> `🛠️ Craft/💼 Vocation/💻 Atelic`
- Product Forge, Titus -> `🛠️ Craft/💻 TPF`
- Travel, trips, flights, hotels -> `🛠️ Craft/🌏 Adventure`
- Australia -> `🛠️ Craft/🌏 Adventure/🇦🇺 Australia`
- Vehicles, auto -> `🛠️ Craft/🌏 Adventure/🚙 Vehicles`
- Climate tech -> `🛠️ Craft/🌦️ Climate`
- Photography -> `🛠️ Craft/🎨 Leisure/📸 Photography`
- Outdoor gear, REI, backcountry -> `🛠️ Craft/🌲 Outdoorsman`

**Admin signals:**

- Government correspondence -> `📑 Admin/🏛️ Government`
- Deals, coupons, offers -> `📑 Admin/🏷 Offers`
