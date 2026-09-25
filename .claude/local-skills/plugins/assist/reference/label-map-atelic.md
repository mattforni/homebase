# Atelic Label Map

The label taxonomy for the practice mailbox, `matt@atelic.me`. The personal
account has its own tree in [label-map.md](label-map.md), and the two never mix:
a label id is only meaningful against the account it came from. Label ids
resolve at runtime via `gws gmail users labels list`. Built 2026-09-02 against
the mailbox's first 130 messages; restructured 2026-09-19 under the Pipeline and
Admin parents.

Everything in this mailbox is the practice, so the top level cuts by what the
mail is about rather than by pillar. Always route to the most specific sublabel
that fits. Every label in this account is set to **show if unread**, so the
sidebar stays quiet until something lands.

## Label Hierarchy

### Pipeline (💵)

The commercial pipeline, one parent holding every stage a relationship moves
through on its way to paid work. The stages mirror HubSpot, which stays the
record of where anyone stands; the labels are retrieval only.

- `💵 Pipeline/👑 Leads` (parent) for a prospect in the pipeline, lifecycle
  `Lead` in HubSpot
- `💵 Pipeline/👑 Leads/📥 Inbound` for website form inquiries and unprompted
  arrivals
- `💵 Pipeline/👑 Leads/📤 Outbound` for cold first touches, bumps, visits, and
  their replies
- `💵 Pipeline/👑 Leads/🥵 Warm` for leads the practice already knows, the
  HubSpot `warm` cohort
- `💵 Pipeline/🌱 Opportunities` (parent) for a lead past discovery with a deal
  open, one sublabel per opportunity: `🌱 Opportunities/🎒 Outdoors Geek`
- `💵 Pipeline/💵 Customers` (parent) for client work with no engagement sublabel
  yet, one sublabel per engagement: `💵 Customers/🩺 WAMM`,
  `💵 Customers/🪟 SkySpec`

Inbound and Outbound are symmetrical on purpose: they name the direction a lead
arrived from. Neither is called Outreach, because outreach is the whole motion
in `Outreach/README.md`, touches and all, not one half of the pipeline.

A thread moves down the pipeline with its relationship. When a deal opens, the
thread gets relabeled from Leads to an Opportunities sublabel, and when it signs,
to a Customers sublabel, named as the folder under `Customers/` in the Atelic
repo, with an emoji that says what the business does. A customer's own growth
surfaces (their Search Console, Business Profile, Analytics) go under their
customer sublabel, never under `📈 Growth`. A signed agreement carries both the
customer label and `📑 Admin/⚖️ Legal`.

### Network (🤝)

Referral sources, introductions, and the warm circle: HubSpot lifecycle `Other`.
Not the pipeline. A thank you after a research call, an intro from Carl or Stacy,
and a recruiter who is really a relationship all land here rather than in Leads.

### Money (💰)

Invoices, payments, receipts, subscription billing, banking, payroll, and tax
payments for the entity; a notice from the agency itself is Government. What `OPERATING.md` governs. Vendor billing goes
here even when the same vendor's product mail goes to Tooling.

### Admin (📑)

The entity's paperwork, grouped under one parent.

- `📑 Admin/⚖️ Legal` for executed agreements, DocuSign envelopes, and anything
  `ENTITY.md` or `Legal/` governs
- `📑 Admin/🏛️ Government` for correspondence with agencies: the Secretaries of
  State, Colorado Revenue Online, Denver eBiz, the IRS, and the USPS receipts
  and tracking for filings mailed to them (a money order and documents to the
  Wyoming Secretary of State, 2026-09-19, is Government, not Money)
- `📑 Admin/🪪 Insurance` for business insurance quotes, policies, and
  certificates

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
- **Pipeline versus Network.** Ask whether they are being sold to. In the
  pipeline is Pipeline, warm circle is Network.
- **Government versus Money.** Ask who is on the other end. An agency is
  Government even when the mail is a receipt; a bank or a vendor is Money.

## Created Filters

| Criteria | Action | Added |
|---|---|---|
| `from:forms@atelic.me` + `subject:[Canary]` | label `🛠️ Tooling`, skip inbox, mark read | 2026-09-02 |
| `from:forms@atelic.me` + not `subject:([Canary])` | label `💵 Pipeline/👑 Leads/📥 Inbound`, stays in the inbox | 2026-09-02 |

The forms address is split on purpose. Every client site's contact handler
sends as `forms@atelic.me`, but a real submission is addressed to the client's
own inbox, so the only forms mail that reaches this mailbox is the synthetic
`[Canary]` monitor ping, which is Tooling and wants no attention. Anything else
arriving from that address is a genuine inquiry that reached the practice, so it
stays in the inbox as an inbound lead rather than being filed and marked read.
