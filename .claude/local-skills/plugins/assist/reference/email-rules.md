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
- `cdle_ui-alerts@state.co.us` and any CDLE / Colorado Division of Unemployment Insurance correspondence (`*@state.co.us` UI notices: inactive-claim notices, reopen confirmations, determination letters, payment/certification alerts) -> label all three: 📑 Admin/🏛️ Government (Label_8590681278241891702) + 🍏 Constitution/💰 Financial (Label_13) + 🛠️ Craft/💼 Vocation (Label_8835009841782117271) + GREEN_STAR, and keep in inbox; NEVER auto archive CDLE mail (amended 2026-08-03; the original 2026-07-21 disposition was archive). Forni reviews each notice himself and archives by hand after review, stripping stars on archive. He also declined a CDLE filter (2026-08-03): these notices are deadline bearing (a MyUI+ questionnaire decides without his input if the window lapses), so nothing may route them past the inbox. Forni will receive many of these while the CO unemployment claim is active. The notices link to a portal (ColoradoUI.gov / MyUI+) and often don't name the document; the actual PDF is a download (lands in ~/Downloads as `<correspondenceID>.pdf` or `OpenFileDialog.pdf`). Standing obligation: the claim goes inactive if weekly certifications lapse; if a notice indicates inactivity, surface it as actionable (reopen at MyUI+). Working record: `~/Eudaimonia/Constitution/Financial/FY27-unemployment.md`. Codified 2026-07-21.
- `do-not-reply@denvergov.org` "Denver Tax Return(s)/Charge Form(s) Now Available" -> the monthly **Denver OPT (Occupational Privilege Tax)** notice for RELIABLY YOURS LLC. It is a **$0 return** filed by hand in the eBiz Tax Center each month payroll is paused (the notice never names the period; only the portal does). How-to and filing log: RYLLC README "Denver OPT". Defer (create a follow-up to file), label 🍏 Constitution/💰 Financial/💸 Taxes, and **keep in inbox (with a star) until the $0 return is filed, then archive and clear stars** (do not archive the notice while filing is still pending). Only the paired "Received: Denver OPT Return (Period Ending ...)" confirmation is archive-on-sight: label Taxes, archive.

- `rino@movementgyms.com` (Movement RiNo booking confirmations) -> trash on sight. Forni declined a skip-inbox filter and does not want these kept; no email-level unsubscribe exists (transactional). Killing them at the source means Movement account notification settings. 2026-07-24.
- `marketing@movementgyms.com` (Movement marketing) -> unsubscribed 2026-07-24 via portal link + trash. If more arrive, the unsubscribe did not stick; re-unsubscribe and trash.
- `info@atlasptco.ccsend.com` (Atlas Physical Therapy newsletter, Constant Contact) -> unsubscribed 2026-07-24 + trash. Audited for Atelic prospect fit 2026-07-24: weak to medium (strong existing web presence, only narrow booking-funnel gaps); Forni chose not to add to HubSpot. Do not re-audit unless he asks.
- `xcelenergy@email.opower.com` "Energy Action Day" (pre_peak_time opower stream, distinct from the Home Energy Report rule below in spirit) -> unsubscribe (URL only) + trash. Unsubscribed 2026-07-24.
- `gustonoreply@gusto.com` severance installment paydays (Zero Home Corporation): file the paystub PDF (Forni downloads it to ~/Downloads) to Drive folder `Compensation` (id `16YgL6ZhzIwkIo7vMn2HLW0Rz3v6Go7L_`) as `YYYY-MM-DD - Severance Paystub.pdf`, link it in a comment on the MyUI+ severance reporting task, then label Vocation + Financial and archive. 2026-07-24.
- Sale-payout / income mail (e.g. `support@buybackboss.com` order and payment notices for an item Forni sold) -> 📑 Admin/🛒 Purchases. Archive, mark read. Confirmed 2026-09-19: not a purchase in the literal sense, but Purchases is the transaction-record home Forni wants for it.
- Colorado DOR "new device login" notices (Revenue Online security alerts, distinct from the `dor_taxreminder` withholding reminder above) and Denver eBiz Tax Center login/device-access confirmations (`do-not-reply@denvergov.org`, distinct from the "Tax Return(s)/Charge Form(s) Now Available" OPT notice above) -> trash on sight. Confirmed 2026-09-19.

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
  - **Always strip every star when archiving** (archived = unstarred). Pass the full star set in `removeLabelIds` on archive: `STARRED`, `YELLOW_STAR`, `GREEN_STAR`, `RED_STAR`. (In Forni's Google Workspace accounts these colored-star IDs are exposed as **system labels** and work in both `addLabelIds` and `removeLabelIds` via gws — confirmed in use. This differs from consumer Gmail, where colored stars are undocumented `^ss_` IDs; do not "simplify" this rule to `STARRED`-only.)

## Domain Rules

- Precedence: apply exact sender rules first; apply these wildcard domain rules second for known high-confidence automations.
- `*@gusto.com` -> 🛠️ Craft/💼 Vocation; if about getting paid, also 🍏 Constitution/💰 Financial. Archive.
- `*@getsentry.com` (Sentry) -> 🛠️ Craft/🧑‍💻 Development. Weekly reports: mark read, archive. Individual issue alerts: GREEN_STAR, keep in inbox.
- `*@email.claude.com` (Claude Team) -> 🛠️ Craft/🧑‍💻 Development. Archive. Also add link to Notion AI Research page (3326231ededc809caebdd0c8dc22297d) under "# Claude Team Emails" heading. Link title = email subject.
- `*@billerpayments.com` (DHMP/Denver Health) -> 🍏 Constitution/🏥 Healthcare. Archive.
- Anthem Blue Cross (`*@anthem.com`) -> 🍏 Constitution/🏥 Healthcare + 📑 Admin/🧾 Bills. Autopay, archive.

## Created Filters

- `from:prime@amazon.com` -> label `📑 Admin/🛒 Purchases` (Label_36), skip inbox, mark read. Covers Prime membership change confirmations (renewal, cancellation). Created 2026-07-19 (filter id `ANe1BmgLdzmPdmLA1kKHrY5Ce3ATguMnHizDC8hwO5SrnA`). Supersedes the `prime@amazon.com` sender rule for future mail.
- `from:invoice+statements+acct_1KZOA5IV1bWPnvOA@stripe.com` -> label `📑 Admin/🛒 Purchases` (Label_36), skip inbox, mark read. Mill Industries receipts (sent via Stripe; keyed on Mill's Stripe account id so other merchants' Stripe receipts are unaffected). Created 2026-07-19 (filter id `ANe1BmhzwjKUgvTRe6iUswZbobYCISVCcr2Tq6e5GQur1g`).

- `from:mcinfo@ups.com` -> label `📑 Admin/🛒 Purchases` (Label_36), skip inbox, **leave unread** (Forni wants them unread in the label so he can still notice deliveries). Created 2026-07-22 (filter id `ANe1BmhcvGLrUpeRN2yfGNvcjBy7tSEwy2Y4b8MJOg3icg`).

- `from:climatebase.org` -> label `🛠️ Craft/🌦️ Climate` (Label_3939245566499170881), skip inbox, leave unread. Covers all Climatebase mail on the domain (newsletter via `climateweeknetwork@`, account mail via `alerts@`, any job alerts), per Forni's "everything from Climatebase" directive. Created 2026-08-03 (filter id `ANe1BmgW_Dr0M3-yRaocBulO8kS8ira5qkrjpZrK27V7vw`).
