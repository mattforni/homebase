# Email Rules

Email routing rules shared by the clerk agent, `assist:triage-inbox`, and `assist:plan-week`. Extracted verbatim from the plugin's learned-rules.md on 2026-08-09. Read on every invocation. These override default rules in [triage-rules.md](triage-rules.md).

## Sender Rules

- `heather.frechette@gmail.com` (Heather Frechette, HNGC secretary) -> 🍏 Constitution/🍾 Sobriety. Auto-reply "Thank you for your service! 🙏", then label and archive. HNGC = High Noon Group Conscience (AA home group business meeting).
- `info@bluesprucemaids.com` (Blue Spruce Maids cleaning reminders) -> 🍏 Constitution/🧖 Personal Care. Mark read, archive. Recurring 7-day cleaning reminders.
- `EnergyReport@xcelenergy.com` (Xcel Home Energy Report, usage marketing email distinct from actual Xcel bills) -> Informational only. Unsubscribe (URL only, no mailto) and archive without label. The actual Xcel utility bill goes to Bills; this monthly usage/marketing report has no value to keep.
- `dor_taxreminder-state.co.us@shared1.ccsend.com` (Colorado Department of Revenue withholding tax reminders) -> 🍏 Constitution/💰 Financial/💸 Taxes. Forni files a $0 return for these. Label, mark read, archive.
- `UHC@benefits.unitedhealthcare.com` with "UHC Rewards" subject -> 🍏 Constitution/🏥 Healthcare + GREEN_STAR. Action: enroll in rewards program ($1000 potential). Keep in inbox until enrolled.
- `prime@amazon.com` membership change confirmations (renewal, cancellation) -> 📑 Admin/🛒 Purchases. Mark read, archive.
- `support@email.mill.com` (Mill food waste device) -> 📑 Admin/🛒 Purchases. Mark read, archive.
- `*@coestatematters.com` (Colorado Estate Matters, estate planning attorney) -> 🍏 Constitution/💰 Financial (the parent). Route to Phase 4 for manual review; auto-archive patterns will codify once enough subject lines are observed. Amended 2026-08-09: the rule previously routed to the 📜 Trust sublabel with a "NOT Financial parent" caveat, but that sublabel was retired from Gmail before 2026-08-09, and Forni called the reroute to the Financial parent during the label map true up.
- `askme@blackblum.com` (Black+Blum houseware) -> 📑 Admin/🛒 Purchases. A brand "Thank you!" is usually a post-purchase receipt, not a promo, even with an unsubscribe header. Label Purchases, archive. Confirmed 2026-07-17.
- `cdle_ui-alerts@state.co.us` and any CDLE / Colorado Division of Unemployment Insurance correspondence (`*@state.co.us` UI notices: inactive-claim notices, reopen confirmations, determination letters, payment/certification alerts) -> label all three: 📑 Admin/🏛️ Government (Label_8590681278241891702) + 🍏 Constitution/💰 Financial (Label_13) + 🛠️ Craft/💼 Vocation (Label_8835009841782117271) + GREEN_STAR, and keep in inbox; NEVER auto archive CDLE mail (amended 2026-08-03; the original 2026-07-21 disposition was archive). Forni reviews each notice himself and archives by hand after review, stripping stars on archive. He also declined a CDLE filter (2026-08-03): these notices are deadline bearing (a MyUI+ questionnaire decides without his input if the window lapses), so nothing may route them past the inbox. The notices link to a portal (ColoradoUI.gov / MyUI+) and often don't name the document; the actual PDF is a download (lands in ~/Downloads as `<correspondenceID>.pdf` or `OpenFileDialog.pdf`). The claim is closed, so an inactive-claim or closure notice is expected and is never surfaced as actionable. Working record: `~/Eudaimonia/Constitution/Financial/FY27-unemployment.md`. Codified 2026-07-21.
- `do-not-reply@denvergov.org` "Denver Tax Return(s)/Charge Form(s) Now Available" -> the monthly **Denver OPT (Occupational Privilege Tax)** notice for RELIABLY YOURS LLC, arriving at `matt@atelic.me`. It is a **$0 return** filed by hand in the eBiz Tax Center each month payroll is paused, for the month before the notice. How to file and the filing record: the Atelic README, "Denver OPT". No follow up task anywhere: the starred notice in the inbox is the reminder. **Keep it in the inbox with a yellow star until the $0 return is filed, then label 📑 Admin/🏛️ Government + 💰 Financial/💸 Taxes (both exist in the Atelic mailbox), archive, and clear stars.** Only the paired "Received: Denver OPT Return (Period Ending ...)" confirmation is archive on sight: label 📑 Admin/🏛️ Government + 💰 Financial/💸 Taxes, archive. Amended 2026-11-18.

- `claude@atelic.me`, the weekly reports (`YYYY-Www Brief`, `YYYY-Www Recruiter`, `YYYY-Www Pipeline`) -> 📑 Admin in whichever mailbox they land, and nothing else: they stay in the inbox, unread, until Forni has read them, and the planning session archives them after the sitting. Never mark one read or archive it by rule (Forni, 2026-11-09: "the whole point is for me to be able to read them"). Other mail from this sender is not covered by this line: an `[Outreach]` report in the Atelic mailbox is a judgment row. Codified 2026-10-05 for the Retro (called the Brief since 2026-10-19), widened 2026-10-19, narrowed to the label alone 2026-11-09.

- `rino@movementgyms.com` (Movement RiNo: booking confirmations, cancellations, membership and billing notices) -> label `🍏 Constitution/💪 Fitness`, mark read, and archive, every message, never trash. Trash on sight from 2026-07-24 until 2026-11-23, when Forni simplified it: "Mark everything fitness."
- `marketing@movementgyms.com` (Movement marketing) -> unsubscribed 2026-07-24 via portal link + trash. If more arrive, the unsubscribe did not stick; re-unsubscribe and trash.
- `info@atlasptco.ccsend.com` (Atlas Physical Therapy newsletter, Constant Contact) -> unsubscribed 2026-07-24 + trash. Its prospect verdict is the Atelic repo's, in `~/Eudaimonia/Craft/Vocation/Atelic/plan/2026-07-prospects.md`; do not audit it again unless he asks.
- `no-reply@sc.connectforhealthco.com` (Connect for Health Colorado, the marketplace plan) -> 🍏 Constitution/🏥 Healthcare, keep in the inbox; a red star when it asks for an action or a review (the 2027 enrollment confirmation asked for a review of the monthly costs, 2026-10-28), no star for a plain notice. Codified 2026-11-09 from the brief's rule table.
- `xcelenergy@email.opower.com` "Energy Action Day" (pre_peak_time opower stream, distinct from the Home Energy Report rule below in spirit) -> unsubscribe (URL only) + trash. Unsubscribed 2026-07-24.
- `gustonoreply@gusto.com` severance installment paydays (Zero Home Corporation): file the paystub PDF (Forni downloads it to ~/Downloads) to Drive folder `Compensation` (id `16YgL6ZhzIwkIo7vMn2HLW0Rz3v6Go7L_`) as `YYYY-MM-DD - Severance Paystub.pdf`, link it in a comment on the MyUI+ severance reporting task, then label Vocation + Financial and archive. 2026-07-24.
- Sale-payout / income mail (e.g. `support@buybackboss.com` order and payment notices for an item Forni sold) -> 📑 Admin/🛒 Purchases. Archive, mark read. Confirmed 2026-09-19: not a purchase in the literal sense, but Purchases is the transaction-record home Forni wants for it.
- Google Drive share notices (someone shared a Drive folder or file with Forni) -> keep in the inbox, unread. Never archive one or mark it read by rule, the weekly brief included: Forni goes through each share himself. A label is fine; the disposition is always keep. Codified 2026-11-16, after the W47 brief archived one.
- Colorado DOR "new device login" notices (Revenue Online security alerts, distinct from the `dor_taxreminder` withholding reminder above) and Denver eBiz Tax Center login/device-access confirmations (`do-not-reply@denvergov.org`, distinct from the "Tax Return(s)/Charge Form(s) Now Available" OPT notice above) -> trash on sight. Confirmed 2026-09-19.

## What Earns a Sender Rule

- **A standing rule is for an automated or bulk sender, never for a person writing by hand.** Newsletters, notifications, receipts, and a business's regular mailing (a running store's newsletter, for one) earn a sender or domain rule, so keep proposing those. A message a person wrote to Forni, a friend, a family member, a client, a neighbor, is read and judged each time, so never propose a rule for that sender, in the weekly brief's rule table or anywhere else. When it is unclear whether a human wrote it, propose nothing. Codified 2026-11-16.

## Topic Rules

- **Home buying (purchase, mortgage, title, closing) is NOT Home Improvement.** Home purchase correspondence goes under 🍏 Constitution/💰 Financial + 🤗 Community/🌇 Denver. The 🛠️ Craft/🏡 Home Improvement label is for actual improvement work (renovations, fixtures, tools), not the transaction of buying the home. Senders this applies to: NEO Home Loans, Trelora (<greg@trelora.com>), CTM eContracts, Land Title Guarantee Company, seller (Matt Bigelow), inspection vendors, HO6 insurance for the unit.

## Subject Rules

- **Pure marketing promos default to unsubscribe + trash, not archive.** A bare newsletter/offer with an unsubscribe header and no personal value gets the unsubscribe sent and the message trashed. Only keep (label + archive) when the sender is genuinely wanted, or when the "promo" is actually a receipt (see Black+Blum in Sender Rules). Confirmed 2026-07-17.

## Star Semantics

- **Star semantics (governing rule, applies to BOTH personal and work inboxes; supersedes the green/yellow definitions in triage-rules.md).** The star answers "who has the ball":
  - 🟡 **YELLOW_STAR** = waiting on *us* — we owe the next move (a reply or an action we're responsible for).
  - 🟢 **GREEN_STAR** = waiting on *someone else*, kept in inbox to track / keep in scope.
  - 🔴 **RED_STAR** = same as yellow (waiting on us) but urgent or overdue.
  - **No star + archive** when nothing needs tracking.
  - **Always strip every star when archiving** (archived = unstarred). This holds for every archive by any path, triage or not; the `archive-star-gate` hook refuses a gws archive that leaves a star. Pass the full star set in `removeLabelIds` on archive: `STARRED`, `YELLOW_STAR`, `GREEN_STAR`, `RED_STAR`, `BLUE_STAR`. (In Forni's Google Workspace accounts these colored-star IDs are exposed as **system labels** and work in both `addLabelIds` and `removeLabelIds` via gws — confirmed in use. This differs from consumer Gmail, where colored stars are undocumented `^ss_` IDs; do not "simplify" this rule to `STARRED`-only.)
  - **Blue is never used.** Star with the color id alone and never add `STARRED` or `BLUE_STAR`: Gmail turns a colorless star blue, so a bare `STARRED` lands as a blue star. A blue star found on mail is recolored to the right one and `BLUE_STAR` removed.

## Domain Rules

- Precedence: apply exact sender rules first; apply these wildcard domain rules second for known high-confidence automations.
- `*@gusto.com` -> 🛠️ Craft/💼 Vocation; if about getting paid, also 🍏 Constitution/💰 Financial. Archive.
- `*@getsentry.com` (Sentry) -> 🛠️ Craft/🧑‍💻 Development. Weekly reports: mark read, archive. Individual issue alerts: GREEN_STAR, keep in inbox.
- `*@email.claude.com` (Claude Team) -> 🛠️ Craft/🧑‍💻 Development. Archive.
- `*@billerpayments.com` (DHMP/Denver Health) -> 🍏 Constitution/🏥 Healthcare. Archive.
- Anthem Blue Cross (`*@anthem.com`) -> 🍏 Constitution/🏥 Healthcare + 📑 Admin/🧾 Bills. Autopay, archive.
