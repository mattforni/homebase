# Atelic Label Map

The label taxonomy for the practice mailbox, `matt@atelic.me`. The personal
account has its own tree in [label-map.md](label-map.md), and the two never mix:
a label id is only meaningful against the account it came from. Label ids
resolve at runtime via `gws gmail users labels list`. Built 2026-09-02 against
the mailbox's first 130 messages.

Everything in this mailbox is the practice, so the top level cuts by what the
mail is about rather than by pillar. Always route to the most specific sublabel
that fits. Every label in this account is set to **show if unread**, so the
sidebar stays quiet until something lands.

## Label Hierarchy

### Customers (🏪)

- `🏪 Customers` (parent) for client work with no engagement sublabel yet
- `🏪 Customers/🩺 WAMM`
- `🏪 Customers/🪟 SkySpec`

One sublabel per engagement, named as the engagement is named under `Clients/`
in the Atelic repo, with an emoji that says what the business does. A customer's
own growth surfaces (their Search Console, Business Profile, Analytics) go here,
never under `📈 Growth`. A signed agreement carries both this label and
`⚖️ Legal`.

### Leads (👑)

- `👑 Leads` (parent) for a prospect in the funnel, lifecycle `Lead` in HubSpot
- `👑 Leads/📥 Inbound` for website form inquiries and unprompted arrivals
- `👑 Leads/📤 Outbound` for cold first touches, bumps, visits, and their replies

The two sublabels are symmetrical on purpose: they name the direction a lead
arrived from. Neither is called Outreach, because outreach is the whole motion
in `Outreach/README.md`, touches and all, not one half of the funnel. A lead
that signs becomes a customer, and the thread that closed it gets relabeled.

### Network (🤝)

Referral sources, introductions, and the warm circle: HubSpot lifecycle `Other`.
Not the funnel. A thank you after a research call, an intro from Carl or Stacy,
and a recruiter who is really a relationship all land here rather than in Leads.

### Money (💰)

Invoices, payments, receipts, subscription billing, banking, payroll, and tax
correspondence for the entity. What `OPERATING.md` governs. Vendor billing goes
here even when the same vendor's product mail goes to Tooling.

### Legal (⚖️)

Executed agreements, DocuSign envelopes, entity filings, registered agent
notices, and anything `ENTITY.md` or `Legal/` governs.

### Tooling (🛠️)

Vendor and platform notices only: account setup, invitations, changelogs,
security alerts, deprecations. Google Workspace, Linear, HubSpot, Cloudflare,
Vercel, GCP. Keep it narrow; it was the mailbox's junk drawer until 2026-09-02
and the money, growth, and legal labels exist to keep it that way.

### Growth (📈)

The practice's own search, analytics, and profile surfaces: atelic.me and
mattforni.com Search Console, Bing Webmaster Tools, the practice's own
Analytics, and the monthly funnel report. A customer's equivalent goes under
their customer label instead.

### Fractional (💼)

Work arriving for Forni himself rather than for the practice: job boards,
applications, recruiters, and their confirmations at the practice address
(Wellfound, Fractional Jobs). The ledger of record is the Pinole work API
(`pinole work postings`, `pinole work activities`); this label is retrieval only.

### TPF (⚒️)

The Product Forge archive, including the forwarded thread set that came across
on 2026-08-20. Historical: the practice pitches, sends, and signs as Atelic.

## Routing Notes

- **The mailbox is the routing signal.** Work landing here is practice work, so
  its tasks are Linear issues and never Todoist tasks.
- **Tooling versus Money.** The same vendor sends both. A changelog is Tooling,
  a receipt is Money.
- **Growth versus the customer.** Ask whose site the alert is about. Ours is
  Growth, theirs is their customer label.
- **Leads versus Network.** Ask whether they are being sold to. In the funnel is
  Leads, warm circle is Network.

## Created Filters

| Criteria | Action | Added |
|---|---|---|
| `from:forms@atelic.me` + `subject:[Canary]` | label `🛠️ Tooling`, skip inbox, mark read | 2026-09-02 |
| `from:forms@atelic.me` + not `subject:([Canary])` | label `👑 Leads/📥 Inbound`, stays in the inbox | 2026-09-02 |

The forms address is split on purpose. Every client site's contact handler
sends as `forms@atelic.me`, but a real submission is addressed to the client's
own inbox, so the only forms mail that reaches this mailbox is the synthetic
`[Canary]` monitor ping, which is Tooling and wants no attention. Anything else
arriving from that address is a genuine inquiry that reached the practice, so it
stays in the inbox as an inbound lead rather than being filed and marked read.
