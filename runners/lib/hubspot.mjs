// The HubSpot pull the runners share: one client, one set of joins, two
// commands.
//
//   node hubspot.mjs week <after-epoch> <before-epoch> > atelic.json
//       The retro's three finished tables for one ISO week: what outreach went
//       out and what came back (ATE-471). Unchanged since it lived at
//       runners/retro/hubspot.mjs; moved here 2026-09-15 (ATE-551) so the
//       pipeline sweep below could reuse the client and the joins rather than
//       grow a second copy of them.
//   node hubspot.mjs sweep <monday YYYY-MM-DD> <out-dir>
//       The pipeline runner's portal sweep for the week that starts on that
//       Monday: every funnel company and contact, every logged email with its
//       opens, every open task, and the recent meetings and notes, with the
//       day counts and the section each name falls into worked out here.
//       Writes portal.json and portal.md into the directory.
//
// The arithmetic lives here rather than in a prompt on purpose. The joins
// below have traps that a model asked to eyeball a pile of JSON would get
// wrong quietly, and the report would read as authoritative anyway. The
// model's job is the sentence underneath; this file's job is the numbers.
//
// The week bounds are Denver midnights as Unix seconds, computed once by the
// entrypoint. HubSpot filters on hs_timestamp take epoch milliseconds; a date
// string with a Z suffix would put the boundary at UTC midnight, six hours
// early in Denver, and hand Sunday evening's sends to the following week.
//
// Credentials: HUBSPOT_SERVICE_KEY, which Cloud Run injects from the vault.
// Without it, and only then, this falls back to shelling out to the `hs` shim,
// so the same file runs on a laptop where the key lives in the Keychain.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---------- shared: the client, the dates, the joins ----------

// hs_timestamp comes back as a UTC instant; the date a send belongs to is the
// Denver one, for the same reason the bounds are. Assembled from parts rather
// than a locale's default pattern, because lastSend is compared as a string
// and the en-CA shortcut to YYYY-MM-DD has flipped to M/d/yyyy under one ICU
// release before.
const DENVER_PARTS = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
});
const denverDate = (ts) => {
    if (!ts) return "";
    const p = Object.fromEntries(DENVER_PARTS.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
};

const KEY = process.env.HUBSPOT_SERVICE_KEY || "";
const ACCOUNT = process.env.HS_ACCOUNT || "hs-pat-atelic";
const SELF_COMPANY = process.env.ATELIC_COMPANY_ID || "342531943133";
const PORTAL = process.env.ATELIC_PORTAL_ID || "246648548";

async function api(path, body) {
    if (KEY) {
        const res = await fetch(`https://api.hubapi.com/${path}`, {
            method: body ? "POST" : "GET",
            headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`HubSpot ${res.status} on ${path}: ${text.slice(0, 300)}`);
        return JSON.parse(text);
    }
    const args = ["api", path, "--account=" + ACCOUNT];
    if (body) args.push("-X", "POST", "--data", JSON.stringify(body));
    return JSON.parse(execFileSync("hs", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
}

const EMAIL_PROPS = [
    "hs_timestamp", "hs_email_subject", "hs_email_direction",
    "hs_email_click_count", "hs_email_open_count", "hs_not_tracking_opens_or_clicks", "hs_email_thread_id",
];

// Calendar traffic and auto responders land on the timeline as ordinary email
// engagements, and counting them turns a courtesy into a touch and an out of
// office into a reply. Both happened in W35: Galvant read as three sends
// because a forwarded cancellation and an invite acceptance were among them,
// and Urban Sanctuary read as answered on an out of office. This is a denylist
// and will need tending; the alternative, guessing from the sender, misses the
// ones Forni's own calendar sends on his behalf.
const NOISE = [
    /^(accepted|declined|tentative|cancelled|canceled|invitation|updated invitation|automatic reply|auto|out of office):/i,
    /^(re|fwd|fw):\s*(accepted|declined|tentative|cancelled|canceled|invitation|updated invitation|automatic reply):/i,
    /^out of office\b/i,
    /^\d+\s*min(ute)?s?\s+meeting\b/i,
];
const isNoise = (p) => NOISE.some((re) => re.test((p.hs_email_subject || "").trim()));

// A touch is one outreach at one company, not one message. The same first
// touch can go to two addresses an hour apart and pick up a reply to an auto
// responder on the way, which is how Urban Sanctuary read as three touches on
// what Forni correctly remembered as one email. Stripping the reply prefixes
// collapses all of that back to the thing he actually did.
const normSubject = (s) => (s || "").replace(/^((re|fwd|fw)\s*:\s*)+/i, "").trim().toLowerCase();

const searchAll = async (obj, body) => {
    const out = [];
    let after;
    do {
        const page = await api(`crm/v3/objects/${obj}/search`, { ...body, limit: 100, ...(after ? { after } : {}) });
        out.push(...(page.results || []));
        after = page.paging?.next?.after;
    } while (after);
    return out;
};

const batch = async (obj, ids, properties) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 100) {
        const page = await api(`crm/v3/objects/${obj}/batch/read`, {
            properties, inputs: ids.slice(i, i + 100).map((id) => ({ id: String(id) })),
        });
        out.push(...(page.results || []));
    }
    return out;
};

const assoc = async (from, to, ids) => {
    const map = new Map();
    for (let i = 0; i < ids.length; i += 100) {
        const page = await api(`crm/v4/associations/${from}/${to}/batch/read`, {
            inputs: ids.slice(i, i + 100).map((id) => ({ id: String(id) })),
        });
        for (const r of page.results || []) {
            map.set(String(r.from.id), (r.to || []).map((t) => String(t.toObjectId)));
        }
    }
    return map;
};

// ---------- week: the retro's tables ----------

async function week(argv) {
const [AFTER_EPOCH, BEFORE_EPOCH] = argv.map(Number);
if (!Number.isInteger(AFTER_EPOCH) || !Number.isInteger(BEFORE_EPOCH) || AFTER_EPOCH >= BEFORE_EPOCH) {
    console.error("usage: node hubspot.mjs week <after-epoch-seconds> <before-epoch-seconds>");
    process.exit(2);
}
const AFTER_MS = String(AFTER_EPOCH * 1000);
const BEFORE_MS = String(BEFORE_EPOCH * 1000);

// How far back the prior history reaches. HubSpot search returns at most
// 10,000 results for any one query, so an unbounded filter with no sort would
// drop an arbitrary slice once the timeline grew past that; bounding it and
// sorting newest first means the slice that falls off is the oldest.
// A malformed override fails here rather than reaching HubSpot as NaN, and a
// negative one is refused because it would move the lower bound past the upper
// and silently empty the prior history.
const LOOKBACK_DAYS = Number(process.env.ATELIC_LOOKBACK_DAYS || 365);
if (!Number.isInteger(LOOKBACK_DAYS) || LOOKBACK_DAYS <= 0) {
    console.error(`ATELIC_LOOKBACK_DAYS must be a positive integer, got ${JSON.stringify(process.env.ATELIC_LOOKBACK_DAYS)}`);
    process.exit(2);
}
const LOOKBACK_MS = String((AFTER_EPOCH - LOOKBACK_DAYS * 86400) * 1000);

const rawWeek = await searchAll("emails", {
    filterGroups: [{ filters: [
        { propertyName: "hs_timestamp", operator: "GTE", value: AFTER_MS },
        { propertyName: "hs_timestamp", operator: "LT", value: BEFORE_MS },
    ] }],
    properties: EMAIL_PROPS,
    sorts: [{ propertyName: "hs_timestamp", direction: "ASCENDING" }],
});
// Both directions, deliberately. An earlier week's inbound message is what
// makes this week's outbound a reply rather than a bump, so filtering this
// query to EMAIL would leave `answered` blind to every thread answered before
// Monday and misclassify exactly the case it exists to catch.
const rawPrior = await searchAll("emails", {
    filterGroups: [{ filters: [
        { propertyName: "hs_timestamp", operator: "GTE", value: LOOKBACK_MS },
        { propertyName: "hs_timestamp", operator: "LT", value: AFTER_MS },
    ] }],
    properties: EMAIL_PROPS,
    sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
});

const week = rawWeek.filter((e) => !isNoise(e.properties));
const prior = rawPrior.filter((e) => !isNoise(e.properties));

const weekIds = week.map((e) => e.id);
const aCoWeek = await assoc("emails", "companies", weekIds);
const aCtWeek = await assoc("emails", "contacts", weekIds);
const aCoPrior = await assoc("emails", "companies", prior.map((e) => e.id));
const aCtPrior = await assoc("emails", "contacts", prior.map((e) => e.id));

const ctIds = [...new Set([...aCtWeek.values(), ...aCtPrior.values()].flat())];
const contacts = new Map((await batch("contacts", ctIds,
    ["firstname", "lastname", "hs_lead_status", "associatedcompanyid"])).map((c) => [c.id, c.properties]));

// Trap one: a send is reliably associated to a contact and unreliably to a
// company. In 2026-W35, 23 of 23 outgoing sends carried a contact link and only
// 18 carried a company one, so a report joined on companies drops five sends
// and the companies behind them. The contact's own company is the fallback,
// and only a fallback: taken as a union it pulls in every contact whose
// company field points at Atelic itself and inflates every number.
const companiesFor = (eid, aCo, aCt) => {
    const direct = (aCo.get(eid) || []).filter((c) => c !== SELF_COMPANY);
    if (direct.length) return [...new Set(direct)];
    const viaContact = (aCt.get(eid) || [])
        .map((ct) => contacts.get(ct)?.associatedcompanyid)
        .filter((c) => c && String(c) !== SELF_COMPANY)
        .map(String);
    return [...new Set(viaContact)];
};

const priorSeen = new Set();
const priorTouches = new Map();
// Opens span every touch the Touches column counts, prior weeks included, so
// the two columns describe the same sends. Keyed like the touches, a copy of
// a touch keeps its best count, and a key with no tracked copy stays unread.
const priorOpens = new Map();
for (const e of prior) {
    // A touch is something Forni sent. Inbound rides along in `prior` only so
    // that `answered` can see it.
    if (e.properties.hs_email_direction !== "EMAIL") continue;
    // Same fallback the week's sends get: a company link is no more reliable on
    // an old send than a new one, and without this the lifetime count silently
    // undercounts exactly the sends the fallback exists to find.
    for (const c of companiesFor(e.id, aCoPrior, aCtPrior)) {
        const key = `${c}|${normSubject(e.properties.hs_email_subject)}`;
        if (e.properties.hs_not_tracking_opens_or_clicks !== "true") {
            priorOpens.set(key, Math.max(priorOpens.get(key) ?? 0, Number(e.properties.hs_email_open_count || 0)));
        }
        if (priorSeen.has(key)) continue;
        priorSeen.add(key);
        priorTouches.set(c, (priorTouches.get(c) || 0) + 1);
    }
}

// A thread that has ever carried an inbound message makes the next outbound a
// reply rather than a bump. They are different work and the five and five
// target only counts the latter.
const answered = new Set([...week, ...prior]
    .filter((e) => e.properties.hs_email_direction === "INCOMING_EMAIL" && e.properties.hs_email_thread_id)
    .map((e) => e.properties.hs_email_thread_id));

const rows = new Map();
const row = (cid) => {
    if (!rows.has(cid)) rows.set(cid, {
        sends: 0, first: 0, bump: 0, reply: 0,
        replied: false, contacts: new Set(), lastSend: "", touchRefs: [],
    });
    return rows.get(cid);
};

const touchIndex = new Map();

for (const e of week) {
    const p = e.properties;
    const cids = companiesFor(e.id, aCoWeek, aCtWeek);
    if (p.hs_email_direction === "INCOMING_EMAIL") {
        for (const c of cids) row(c).replied = true;
        continue;
    }
    if (p.hs_email_direction !== "EMAIL") continue;
    for (const c of cids) {
        const r = row(c);
        for (const ct of aCtWeek.get(e.id) || []) r.contacts.add(ct);
        const key = `${c}|${normSubject(p.hs_email_subject)}`;
        const tracked = p.hs_not_tracking_opens_or_clicks !== "true";

        // A copy of a touch already counted folds into it. Clicks take the
        // best copy, because the touch was clicked if any copy of it was, and
        // tracking counts if any copy carried it.
        if (touchIndex.has(key)) {
            const t = touchIndex.get(key);
            t.clicks = Math.max(t.clicks, Number(p.hs_email_click_count || 0));
            if (tracked) t.opens = Math.max(t.opens ?? 0, Number(p.hs_email_open_count || 0));
            t.tracked = t.tracked || tracked;
            r.lastSend = denverDate(p.hs_timestamp) > r.lastSend
                ? denverDate(p.hs_timestamp) : r.lastSend;
            continue;
        }
        const t = { clicks: Number(p.hs_email_click_count || 0), opens: tracked ? Number(p.hs_email_open_count || 0) : null, tracked };
        touchIndex.set(key, t);
        r.touchRefs.push(t);
        r.sends += 1;
        r.lastSend = denverDate(p.hs_timestamp);

        // Reply is tested first: a message into a thread they have answered is
        // a reply even when it is this company's first send of the week, which
        // is what Galvant is. Only then does first outrank bump.
        if (answered.has(p.hs_email_thread_id)) r.reply += 1;
        else if (!priorTouches.get(c) && r.sends === 1) r.first += 1;
        else r.bump += 1;
    }
}

// Fold each company's touches now that every copy has been merged into one.
for (const r of rows.values()) {
    r.clicks = r.touchRefs.reduce((n, t) => n + t.clicks, 0);
    r.tracked = r.touchRefs.filter((t) => t.tracked).length;
}
for (const [cid, r] of rows) {
    const prior = [...priorOpens].filter(([k]) => k.startsWith(`${cid}|`)).map(([, n]) => n);
    const week = r.touchRefs.filter((t) => t.opens !== null && t.opens !== undefined).map((t) => t.opens);
    r.opens = prior.length + week.length ? [...prior, ...week].reduce((n, x) => n + x, 0) : null;
}

const companies = new Map((await batch("companies", [...rows.keys()],
    ["name", "lifecyclestage", "fit", "disqualification_reason"])).map((c) => [c.id, c.properties]));

// An opportunity is not measured in touches. What matters is which stage its
// deal sits at and how much is on the table, so the opportunities table reads
// the deal and the lead columns are dropped for it entirely.
const STAGES = Object.fromEntries((await api("crm/v3/pipelines/deals")).results
    .flatMap((pl) => pl.stages.map((st) => [st.id, st.label])));
// Open deals, plus any deal that closed inside the week. Open only was how
// SkySpec rendered with a blank stage and no money in the week it signed
// (W38): its deal went Closed Won on 09-17 and dropped out of the query, when
// a win is the one row the week most needs to show.
const openDeals = (await searchAll("deals", {
    filterGroups: [
        { filters: [{ propertyName: "hs_is_closed", operator: "NEQ", value: "true" }] },
        { filters: [{ propertyName: "closedate", operator: "BETWEEN", value: AFTER_MS, highValue: BEFORE_MS }] },
    ],
    properties: ["dealname", "dealstage", "amount", "build_price", "operate_price", "operate_length", "trade_credit", "hs_is_closed", "hs_is_closed_won"],
}));
const dealCompanies = await assoc("deals", "companies", openDeals.map((d) => d.id));
// One deal per company, ranked rather than first seen: a deal won inside the
// week, then an open one, then one lost inside the week. Search order would
// otherwise let a second open deal hide the win the query was widened to
// catch, or a loss hide a deal still in play. Ties keep the first seen.
const dealRank = (p) => (p.hs_is_closed_won === "true" ? 0 : p.hs_is_closed !== "true" ? 1 : 2);
const dealByCompany = new Map();
for (const d of openDeals) {
    for (const c of dealCompanies.get(d.id) || []) {
        const held = dealByCompany.get(c);
        if (!held || dealRank(d.properties) < dealRank(held)) dealByCompany.set(c, d.properties);
    }
}

// A company is as far along as its warmest contact. Concatenating every
// contact's status reads as a data error, which is exactly how it read the
// first time: Skylight Specialists showed CONNECTED/QUALIFIED because Bradley
// had not caught up with Danny and Josh.
const LADDER = ["NEW", "CONTACTED", "ENGAGED", "CONNECTED", "QUALIFIED"];
const FUNNEL = new Set(["lead", "marketingqualifiedlead", "salesqualifiedlead", "opportunity", "customer"]);
const CLOSED = new Set(["UNQUALIFIED"]);
const warmest = (ids) => {
    const seen = [...ids].map((c) => contacts.get(c)?.hs_lead_status).filter(Boolean);
    const open = seen.filter((s) => !CLOSED.has(s));
    if (open.length) return open.sort((a, b) => LADDER.indexOf(b) - LADDER.indexOf(a))[0];
    return seen[0] || "";
};

const tables = { opportunities: [], open_leads: [], closed_leads: [] };
const counted = new Map();
for (const [cid, r] of rows) {
    const c = companies.get(cid) || {};
    const stage = c.lifecyclestage || "";
    // Every funnel stage the operating model names, Lead through Customer, so
    // the retro can show the whole pipeline; Other stays out, since it is the
    // warm network rather than the funnel.
    if (!FUNNEL.has(stage)) continue;
    const status = warmest(r.contacts);
    const deal = dealByCompany.get(cid);
    // No lead status on any contact means the company is not in the motion,
    // which is exactly what clearing the status is for. It also keeps rows
    // that only ever received mail (Forni's PT, his lawyers) out of a table
    // about outreach.
    if (!status && !deal) continue;
    const kinds = [];
    if (r.first) kinds.push(r.first > 1 ? `${r.first} first` : "first");
    if (r.bump) kinds.push(r.bump > 1 ? `${r.bump} bumps` : "bump");
    if (r.reply) kinds.push(r.reply > 1 ? `${r.reply} replies` : "reply");
    counted.set(cid, r);
    const entry = {
        company: c.name || `(company ${cid})`,
        lifecycle: stage,
        status: status || "none",
        kind: kinds.join(", ") || "none",
        sends: r.sends,
        touches: (priorTouches.get(cid) || 0) + r.sends,
        // A send that carried no tracking cannot be read, which is not the
        // same as a zero. It reports as a dash, the record's own way of saying
        // the question does not apply here.
        clicks: r.tracked ? String(r.clicks) : "-",
        opens: r.opens === null ? "-" : String(r.opens),
        tracked: `${r.tracked}/${r.sends}`,
        replied: r.replied ? "yes" : "no",
        last_send: r.lastSend,
    };
    // Closed is decided by the contact's status, never by the presence of a
    // Disqualification Reason: a reason can sit stale on a company whose
    // contact is live again, which is how EZEC read as closed while a thread
    // with it was still moving.
    const closed = CLOSED.has(status);
    if (stage === "opportunity" || stage === "customer") {
        // Money carries its sign. A trade credit is money not collected, so it
        // reads as negative and the renderer colours it accordingly; without
        // the sign the column looked like another thing being earned.
        const money = (v) => {
            if (v === null || v === undefined || v === "") return "-";
            const n = Number(v);
            return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US")}`;
        };
        const build = deal?.build_price;
        const operate = deal?.operate_price;
        const months = deal?.operate_length;
        // Total is the engagement's whole value, the build plus the operate
        // retainer over its term. Deals priced before those fields existed
        // carry only `amount`, so that stands in rather than showing nothing.
        // An operate price with no term cannot be totalled: multiplying by a
        // missing term would quietly report the build alone, a number lower
        // than the deal. Fall back to `amount`, and to nothing if there is
        // none, rather than showing a figure that is wrong.
        const totalable = build && (!operate || months);
        const total = totalable
            ? Number(build || 0) + Number(operate || 0) * Number(months || 0)
            : (operate && months
                ? Number(operate) * Number(months)
                : (deal?.amount ? Number(deal.amount) : null));
        // What is actually collectable. An engagement partly paid in goods is
        // worth its total to the business and less than that to the bank
        // account, and the retro wants the second number.
        const trade = deal?.trade_credit ? Number(deal.trade_credit) : 0;
        const cash = total === null ? null : total - trade;
        tables.opportunities.push({
            company: entry.company,
            lifecycle: stage,
            stage: deal ? (STAGES[deal.dealstage] || deal.dealstage) : "-",
            build: money(build),
            // The term rides with the operate figure rather than taking a
            // column of its own; the table is already wide.
            operate: (operate && months) ? `${money(operate)} x${months}` : money(operate),
            trade: trade ? money(-trade) : "-",
            total: money(total),
            cash: money(cash),
            last_send: entry.last_send,
        });
    }
    else if (closed) { entry.reason = c.disqualification_reason || "-"; tables.closed_leads.push(entry); }
    else tables.open_leads.push(entry);
}
// Leads sort by how far along they are, then by when they were last touched,
// so the table reads as a funnel rather than as a mailbox.
const depth = (s) => { const i = LADDER.indexOf(s); return i < 0 ? -1 : i; };
for (const t of [tables.open_leads, tables.closed_leads]) {
    t.sort((a, b) => depth(b.status) - depth(a.status) || b.last_send.localeCompare(a.last_send));
}
tables.opportunities.sort((a, b) => b.last_send.localeCompare(a.last_send));

// Totals count the rows the tables actually show. Built from every row in
// `rows` they included the companies the table loop skips on lifecycle stage
// and on missing lead status, which is how mail to Forni's PT and his lawyers
// reached the First Sends and Follow Ups coverage numbers while being absent
// from every table under them.
const all = [...counted.values()];
const totals = {
    companies: tables.opportunities.length + tables.open_leads.length + tables.closed_leads.length,
    sends: all.reduce((n, r) => n + r.sends, 0),
    first: all.reduce((n, r) => n + r.first, 0),
    bumps: all.reduce((n, r) => n + r.bump, 0),
    replies_sent: all.reduce((n, r) => n + r.reply, 0),
    tracked: all.reduce((n, r) => n + r.tracked, 0),
    clicks: all.reduce((n, r) => n + r.clicks, 0),
};

// The same logged against target shape the movement coverage table uses, so
// the outreach week is read the same way the training week is. Both rows are
// what the target names, and the renderer grades each against it.
const TARGET_FIRST = Number(process.env.ATELIC_TARGET_FIRST || 5);
const TARGET_BUMPS = Number(process.env.ATELIC_TARGET_BUMPS || 5);
const coverage = [
    { measure: "First Sends", logged: String(totals.first), target: String(TARGET_FIRST) },
    { measure: "Follow Ups", logged: String(totals.bumps), target: String(TARGET_BUMPS) },
];

console.log(JSON.stringify({ ...tables, coverage, totals }, null, 2));
}

// ---------- sweep: the pipeline runner's portal read ----------
//
// Everything the plumber's method reads out of the portal in steps 2 and 3,
// pulled once and worked into the shape the roster sorts by. The day counts
// and the section each name lands in are computed here, and labelled as the
// pull's suggestion: the model reads the mailbox and the thread before it
// agrees, and the roster line says when it did not.

const MS_DAY = 86400000;
const LADDER_OPEN = ["NEW", "CONTACTED", "ENGAGED", "CONNECTED", "QUALIFIED"];
const CLOSED_STATUSES = new Set(["UNQUALIFIED"]);
const FUNNEL = new Set(["lead", "marketingqualifiedlead", "salesqualifiedlead", "opportunity", "customer"]);
const COMPANY_PROPS = [
    "name", "domain", "website", "lifecyclestage", "fit", "gravity", "refresh", "owner", "wiring",
    "vertical", "segment", "source", "door", "niche", "tags", "disqualification_reason",
    "address", "city", "phone", "description", "notes_last_contacted",
];
const CONTACT_PROPS = [
    "firstname", "lastname", "email", "phone", "jobtitle", "hs_lead_status", "lifecyclestage",
    "associatedcompanyid", "notes_last_contacted", "hs_email_last_send_date",
    "hs_email_last_open_date", "hs_email_last_reply_date",
];
const SWEEP_EMAIL_PROPS = [
    ...EMAIL_PROPS, "hs_email_status", "hs_email_text",
    "hs_email_from_email", "hs_email_to_email", "hs_email_sender_email",
];
const TASK_PROPS = ["hs_task_subject", "hs_task_body", "hs_timestamp", "hs_task_status", "hs_task_type", "hs_task_priority"];
const MEETING_PROPS = ["hs_meeting_title", "hs_meeting_body", "hs_meeting_start_time", "hs_meeting_outcome", "hs_internal_meeting_notes", "hs_timestamp"];
const NOTE_PROPS = ["hs_note_body", "hs_timestamp"];

// HubSpot bodies arrive as HTML. The model reads them as text, with the links
// kept because a meeting body's Granola link is the point of pulling it.
const plain = (html, max) => {
    const t = (html || "")
        .replace(/<a\s[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => ` ${inner.replace(/<[^>]+>/g, "").trim()} (${href}) `)
        .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
        .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
    return max && t.length > max ? t.slice(0, max) + " […]" : t;
};

// Denver midnight of a YYYY-MM-DD as epoch ms, found by trying the two
// offsets the zone ever has rather than hard coding one of them.
const denverMidnight = (day) => {
    const utc = Date.parse(`${day}T00:00:00Z`);
    for (const h of [6, 7]) {
        const ms = utc + h * 3600000;
        if (denverDate(ms) === day && denverDate(ms - 1) !== day) return ms;
    }
    throw new Error(`cannot place Denver midnight for ${day}`);
};

const contactUrl = (id) => `https://app.hubspot.com/contacts/${PORTAL}/record/0-1/${id}`;
const companyUrl = (id) => `https://app.hubspot.com/contacts/${PORTAL}/record/0-2/${id}`;
const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const table = (headers, rows) => [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
].join("\n");

async function sweep(argv) {
    const [monday, outDir] = argv;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(monday || "") || !outDir) {
        console.error("usage: node hubspot.mjs sweep <monday YYYY-MM-DD> <out-dir>");
        process.exit(2);
    }
    const mondayMs = denverMidnight(monday);
    const sundayEndMs = mondayMs + 7 * MS_DAY;
    const sunday = denverDate(sundayEndMs - 1);
    // Day counts are measured from the day the roster is built. A rerun later
    // in the same week counts from that day; a rerun for a past week counts
    // from its Monday, so a replay does not drift.
    const refMs = Math.min(Math.max(Date.now(), mondayMs), sundayEndMs - 1);
    const refDay = denverDate(refMs);
    const daysSince = (ts) => (ts ? Math.floor((refMs - Date.parse(ts)) / MS_DAY) : null);
    const lookbackMs = String(mondayMs - Number(process.env.SWEEP_LOOKBACK_DAYS || 120) * MS_DAY);
    const recentMs = String(mondayMs - 60 * MS_DAY);
    const log = (s) => process.stderr.write(`sweep: ${s}\n`);

    // ----- companies in the funnel -----
    const companyRows = (await searchAll("companies", {
        filterGroups: [{ filters: [{ propertyName: "lifecyclestage", operator: "IN", values: [...FUNNEL] }] }],
        properties: COMPANY_PROPS,
        sorts: [{ propertyName: "fit", direction: "DESCENDING" }],
    })).filter((c) => c.id !== SELF_COMPANY);
    const companies = new Map(companyRows.map((c) => [c.id, { id: c.id, ...c.properties, name: c.properties.name || c.properties.domain || `(company ${c.id})`, contacts: [] }]));
    log(`${companies.size} funnel companies`);

    // ----- contacts: anyone with a Lead Status, plus everyone on a funnel company -----
    const statusRows = await searchAll("contacts", {
        filterGroups: [{ filters: [{ propertyName: "hs_lead_status", operator: "HAS_PROPERTY" }] }],
        properties: CONTACT_PROPS,
    });
    const coToCt = await assoc("companies", "contacts", [...companies.keys()]);
    const wanted = new Set([...statusRows.map((c) => c.id), ...[...coToCt.values()].flat()]);
    const contactRows = await batch("contacts", [...wanted], CONTACT_PROPS);
    const contacts = new Map(contactRows.map((c) => [c.id, { id: c.id, ...c.properties }]));
    // The association is the join; associatedcompanyid is the fallback, since
    // it lags and is not proof (the plumber's own rule for reading it back).
    const ctToCo = new Map();
    for (const [co, cts] of coToCt) for (const ct of cts) if (!ctToCo.has(ct)) ctToCo.set(ct, co);
    for (const c of contacts.values()) {
        c.company_id = ctToCo.get(c.id) || (c.associatedcompanyid ? String(c.associatedcompanyid) : "");
        c.in_funnel = companies.has(c.company_id);
        if (c.in_funnel) companies.get(c.company_id).contacts.push(c.id);
    }
    log(`${contacts.size} contacts, ${[...contacts.values()].filter((c) => c.in_funnel).length} on funnel companies`);

    // ----- emails, both directions, with opens -----
    const emailRows = (await searchAll("emails", {
        filterGroups: [{ filters: [{ propertyName: "hs_timestamp", operator: "GTE", value: lookbackMs }] }],
        properties: SWEEP_EMAIL_PROPS,
        sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
    })).filter((e) => !isNoise(e.properties));
    const emToCt = await assoc("emails", "contacts", emailRows.map((e) => e.id));
    log(`${emailRows.length} emails since ${denverDate(Number(lookbackMs))}`);

    // ----- open tasks -----
    const taskRows = await searchAll("tasks", {
        filterGroups: [{ filters: [{ propertyName: "hs_task_status", operator: "IN", values: ["NOT_STARTED", "IN_PROGRESS", "WAITING", "DEFERRED"] }] }],
        properties: TASK_PROPS,
        sorts: [{ propertyName: "hs_timestamp", direction: "ASCENDING" }],
    });
    const tkToCt = await assoc("tasks", "contacts", taskRows.map((t) => t.id));
    const tkToCo = await assoc("tasks", "companies", taskRows.map((t) => t.id));
    const tasks = taskRows.map((t) => {
        const due = t.properties.hs_timestamp;
        const dueMs = due ? Date.parse(due) : null;
        return {
            id: t.id, subject: t.properties.hs_task_subject || "", body: plain(t.properties.hs_task_body, 1500),
            due: denverDate(due), status: t.properties.hs_task_status, type: t.properties.hs_task_type || "",
            priority: t.properties.hs_task_priority || "",
            reading: dueMs === null ? "undated" : dueMs < refMs - 7 * MS_DAY ? "stale" : dueMs < sundayEndMs ? "due" : "parked",
            contacts: tkToCt.get(t.id) || [], companies: tkToCo.get(t.id) || [],
        };
    });
    log(`${tasks.length} open tasks`);

    // ----- meetings and notes, the last sixty days -----
    const meetingRows = await searchAll("meetings", {
        filterGroups: [{ filters: [{ propertyName: "hs_timestamp", operator: "GTE", value: recentMs }] }],
        properties: MEETING_PROPS,
        sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
    });
    const mtToCt = await assoc("meetings", "contacts", meetingRows.map((m) => m.id));
    const mtToCo = await assoc("meetings", "companies", meetingRows.map((m) => m.id));
    const meetings = meetingRows.map((m) => ({
        id: m.id, date: denverDate(m.properties.hs_meeting_start_time || m.properties.hs_timestamp),
        title: m.properties.hs_meeting_title || "", outcome: m.properties.hs_meeting_outcome || "",
        body: plain(m.properties.hs_meeting_body, 1500), notes: plain(m.properties.hs_internal_meeting_notes, 600),
        contacts: mtToCt.get(m.id) || [], companies: mtToCo.get(m.id) || [],
    }));
    const noteRows = await searchAll("notes", {
        filterGroups: [{ filters: [{ propertyName: "hs_timestamp", operator: "GTE", value: recentMs }] }],
        properties: NOTE_PROPS,
        sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
    });
    const ntToCt = await assoc("notes", "contacts", noteRows.map((n) => n.id));
    const ntToCo = await assoc("notes", "companies", noteRows.map((n) => n.id));
    const notes = noteRows.map((n) => ({
        id: n.id, date: denverDate(n.properties.hs_timestamp), body: plain(n.properties.hs_note_body, 600),
        contacts: ntToCt.get(n.id) || [], companies: ntToCo.get(n.id) || [],
    }));
    log(`${meetings.length} meetings, ${notes.length} notes since ${denverDate(Number(recentMs))}`);

    // ----- the join: every contact's touches, replies, opens, and section -----
    const perContact = new Map();
    const touchesOf = (id) => {
        if (!perContact.has(id)) perContact.set(id, { touches: [], replies: [] });
        return perContact.get(id);
    };
    const copyKey = new Map();
    for (const e of [...emailRows].reverse()) {
        const p = e.properties;
        const day = denverDate(p.hs_timestamp);
        for (const ct of emToCt.get(e.id) || []) {
            if (!contacts.has(ct)) continue;
            const t = touchesOf(ct);
            if (p.hs_email_direction === "INCOMING_EMAIL") {
                t.replies.push({
                    id: e.id, date: day, ts: Date.parse(p.hs_timestamp), subject: p.hs_email_subject || "", from: p.hs_email_from_email || p.hs_email_sender_email || "",
                    snippet: plain(p.hs_email_text, 500), thread: p.hs_email_thread_id || "",
                });
                continue;
            }
            if (p.hs_email_direction !== "EMAIL") continue;
            // A second copy of the same touch the same day folds into the first,
            // keeping the best open and click counts.
            const key = `${ct}|${day}|${normSubject(p.hs_email_subject)}`;
            const tracked = p.hs_not_tracking_opens_or_clicks !== "true";
            const opens = tracked ? Number(p.hs_email_open_count || 0) : null;
            const clicks = tracked ? Number(p.hs_email_click_count || 0) : null;
            if (copyKey.has(key)) {
                const prev = copyKey.get(key);
                if (opens !== null) prev.opens = Math.max(prev.opens ?? 0, opens);
                if (clicks !== null) prev.clicks = Math.max(prev.clicks ?? 0, clicks);
                prev.tracked = prev.tracked || tracked;
                continue;
            }
            const touch = { id: e.id, date: day, ts: Date.parse(p.hs_timestamp), subject: p.hs_email_subject || "", tracked, opens, clicks, thread: p.hs_email_thread_id || "", status: p.hs_email_status || "" };
            copyKey.set(key, touch);
            t.touches.push(touch);
        }
    }

    const taskIndex = new Map();
    for (const t of tasks) {
        for (const ct of t.contacts) taskIndex.set(ct, [...(taskIndex.get(ct) || []), t]);
    }
    const byCompany = (list) => {
        const m = new Map();
        for (const x of list) for (const co of x.companies) m.set(co, [...(m.get(co) || []), x]);
        return m;
    };
    const tasksByCompany = byCompany(tasks);
    const meetingsByCompany = byCompany(meetings);
    const notesByCompany = byCompany(notes);

    const reads = [];
    for (const c of contacts.values()) {
        const co = companies.get(c.company_id);
        // The warm network (lifecycle Other) belongs on neither list.
        if (!co) continue;
        const status = c.hs_lead_status || "";
        const { touches, replies } = perContact.get(c.id) || { touches: [], replies: [] };
        const lastTouch = touches[touches.length - 1] || null;
        const lastReply = replies[replies.length - 1] || null;
        const lastSend = lastTouch?.date || "";
        const lastReplyDay = lastReply?.date || "";
        const dSend = lastTouch ? daysSince(`${lastSend}T12:00:00Z`) : null;
        const dFirst = touches[0] ? daysSince(`${touches[0].date}T12:00:00Z`) : null;
        const opens = touches.reduce((n, t) => n + (t.opens || 0), 0);
        const tracked = touches.filter((t) => t.tracked).length;
        const ownTasks = [...(taskIndex.get(c.id) || []), ...(tasksByCompany.get(c.company_id) || []).filter((t) => !t.contacts.includes(c.id))];
        const due = ownTasks.filter((t) => t.reading === "due" || t.reading === "stale");
        const parked = ownTasks.filter((t) => t.reading === "parked");

        let section, why;
        // The company's Disqualification Reason is the whole closed test (Closing a
        // Prospect in Atelic's Tools/hubspot.md); a contact's status alone never closes.
        if (co.disqualification_reason) { section = "closed"; why = co.disqualification_reason; }
        else if (!status) { section = "not_in_motion"; why = "no Lead Status"; }
        else if (CLOSED_STATUSES.has(status)) { section = "closed"; why = `${status} with no reason on the company; set one`; }
        else if (lastReply && (!lastTouch || lastReply.ts >= lastTouch.ts)) { section = "replies_owed"; why = `their ${lastReplyDay} reply is the last message on the record`; }
        else if (due.length) { section = "tasks_due"; why = `task due ${due[0].due}: ${due[0].subject}`; }
        else if (parked.length) { section = "parked"; why = `task parked to ${parked[0].due}; silent until then`; }
        else if (status === "NEW") {
            section = co.lifecyclestage === "lead" && !co.disqualification_reason ? "first_touch" : "new_off_queue";
            why = co.fit ? `fit ${co.fit}` : "unscored";
        }
        else if (status !== "CONTACTED") { section = "conversation"; why = `${status}, last send ${lastSend || "none"}, their last reply ${lastReplyDay || "none"}`; }
        else if (!lastSend) { section = "unlogged_send"; why = "CONTACTED with no logged send; propose the backfill"; }
        else if (dSend < 6) { section = "waiting"; why = `sent ${dSend} days ago; nothing due yet`; }
        else if (touches.length === 1) { section = "bumps_due"; why = `one touch, day ${dSend}, ${tracked ? `${opens} opens` : "untracked"}`; }
        else if (touches.length === 2) { section = "visits_due"; why = `two touches, last on day ${dSend}, ${dFirst} days since the first`; }
        else { section = "closes_due"; why = `${touches.length} touches, ${dFirst} days since the first, silent ${dSend}`; }

        reads.push({
            contact_id: c.id, name: `${c.firstname || ""} ${c.lastname || ""}`.trim() || "(no name)", email: c.email || "", phone: c.phone || "",
            title: c.jobtitle || "", status, contact_url: contactUrl(c.id),
            company_id: co.id, company: co.name || "", domain: co.domain || "", company_url: companyUrl(co.id),
            lifecycle: co.lifecyclestage, fit: co.fit ? Number(co.fit) : null, tags: co.tags || "", vertical: co.vertical || "",
            door: co.door || "", segment: co.segment || "", disqualification: co.disqualification_reason || "",
            address: [co.address, co.city].filter(Boolean).join(", "), company_phone: co.phone || "",
            touches, replies, last_send: lastSend, days_since_send: dSend, days_since_first: dFirst,
            opens, tracked_sends: tracked, last_reply: lastReplyDay,
            last_contacted: denverDate(c.notes_last_contacted),
            tasks: ownTasks.map((t) => t.id), section, why,
        });
    }

    const order = (a, b) => (b.opens - a.opens) || ((b.fit || 0) - (a.fit || 0)) || ((b.days_since_send || 0) - (a.days_since_send || 0));
    const pick = (s) => reads.filter((r) => r.section === s).sort(order);
    const firstTouch = reads.filter((r) => r.section === "first_touch").sort((a, b) => ((b.fit || 0) - (a.fit || 0)));
    const sections = {
        replies_owed: pick("replies_owed"), tasks_due: pick("tasks_due"), bumps_due: pick("bumps_due"),
        visits_due: pick("visits_due"), closes_due: pick("closes_due"), first_touch: firstTouch,
        conversation: pick("conversation"), parked: pick("parked"), waiting: pick("waiting"),
        unlogged_send: pick("unlogged_send"), new_off_queue: pick("new_off_queue"),
    };

    // ----- the counts line -----
    const leads = [...companies.values()].filter((c) => c.lifecyclestage === "lead");
    const nextUp = leads.filter((c) => c.fit && !c.disqualification_reason);
    const nextUpNew = nextUp.filter((c) => c.contacts.some((id) => contacts.get(id)?.hs_lead_status === "NEW"));
    const inFlight = reads.filter((r) => r.status === "CONTACTED" && !r.last_reply && r.tracked_sends > 0);
    const counts = {
        built: refDay, week: { monday, sunday },
        next_up: nextUp.length, next_up_with_new: nextUpNew.length,
        unscored: leads.filter((c) => !c.fit).length,
        funnel_companies: companies.size,
        tasks: {
            due_this_week: tasks.filter((t) => t.reading === "due").length,
            parked_later: tasks.filter((t) => t.reading === "parked").length,
            stale: tasks.filter((t) => t.reading === "stale").length,
            undated: tasks.filter((t) => t.reading === "undated").length,
        },
        top_opened: inFlight.filter((r) => r.opens >= 2).sort((a, b) => b.opens - a.opens).slice(0, 5)
            .map((r) => ({ name: r.name, company: r.company, opens: r.opens, days_since_send: r.days_since_send })),
        sections: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.length])),
    };

    // ----- the files -----
    mkdirSync(outDir, { recursive: true });
    const nameOf = (id) => { const c = contacts.get(id); return c ? `${c.firstname || ""} ${c.lastname || ""}`.trim() : `contact ${id}`; };
    const coName = (id) => companies.get(id)?.name || `company ${id}`;
    const json = {
        counts, sections, tasks, meetings, notes,
        companies: Object.fromEntries([...companies.values()].map((c) => [c.id, { ...c, url: companyUrl(c.id) }])),
        contacts: Object.fromEntries(reads.map((r) => [r.contact_id, r])),
    };
    writeFileSync(join(outDir, "portal.json"), JSON.stringify(json, null, 2));

    const lineFor = (r) => [
        `[${r.name}](${r.contact_url})`, `[${r.company}](${r.company_url})`, r.status, r.fit ?? "unscored",
        r.last_send || "none", r.days_since_send ?? "", r.touches.length, r.tracked_sends ? String(r.opens) : "untracked",
        r.last_reply || "", r.why,
    ];
    const headers = ["Contact", "Company", "Status", "Fit", "Last send", "Days", "Touches", "Opens", "Their last reply", "Read"];
    const sectionMd = (title, list, note) => `## ${title}\n\n${note ? note + "\n\n" : ""}${list.length ? table(headers, list.map(lineFor)) : "None."}\n`;
    const touchesMd = (r) => r.touches.map((t) => `- sent ${t.date} "${t.subject}" ${t.tracked ? `(${t.opens} opens, ${t.clicks} clicks)` : "(untracked)"} thread ${t.thread || "?"}`).join("\n");
    const repliesMd = (r) => r.replies.map((x) => `- reply ${x.date} from ${x.from} "${x.subject}"\n\n  > ${x.snippet.replace(/\n/g, "\n  > ")}`).join("\n");
    const detailMd = (r) => `### ${r.name}, ${r.company} (${r.section})\n\n${r.email || "no email"}${r.phone ? ", " + r.phone : ""}; ${r.title || "no title"}. Company: ${r.lifecycle}, fit ${r.fit ?? "unscored"}${r.tags ? ", tags " + r.tags : ""}${r.vertical ? ", " + r.vertical : ""}${r.door ? ", door " + r.door : ""}${r.address ? "; " + r.address : ""}${r.company_phone ? "; " + r.company_phone : ""}. Contact [record](${r.contact_url}), company [record](${r.company_url}).\n\n${touchesMd(r) || "- no logged sends"}\n${repliesMd(r) ? repliesMd(r) + "\n" : ""}`;

    const active = reads.filter((r) => !["closed", "not_in_motion"].includes(r.section)).sort((a, b) => a.company.localeCompare(b.company));
    const md = [
        `# Portal sweep for ${monday} to ${sunday}, read on ${refDay}`,
        "",
        "Pulled from the Atelic portal by the runner before the model started. Every section is the pull's suggestion from the record; the mailbox and the thread decide. Days count from the build day.",
        "",
        "## Counts",
        "",
        `- Next Up (lifecycle Lead, fit known, no Disqualification Reason): ${counts.next_up}, of which ${counts.next_up_with_new} still have a contact at NEW.`,
        `- Unscored (lifecycle Lead, fit unknown): ${counts.unscored}. Funnel companies in all: ${counts.funnel_companies}.`,
        `- Open tasks: ${counts.tasks.due_this_week} due this week or earlier, ${counts.tasks.parked_later} parked later, ${counts.tasks.stale} stale (more than a week past due), ${counts.tasks.undated} undated.`,
        `- Sections: ${Object.entries(counts.sections).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
        `- Top opened sends in flight: ${counts.top_opened.length ? counts.top_opened.map((t) => `${t.name} (${t.company}) ${t.opens} opens, day ${t.days_since_send}`).join("; ") : "none at two or more opens"}.`,
        "",
        sectionMd("Replies Owed", sections.replies_owed, "Their reply is the last message on the HubSpot record. The reply text is in the detail below; read the thread in the mailbox pull before drafting."),
        sectionMd("Tasks Due", sections.tasks_due, "An open task due this week or earlier, or stale. The task body is under Open Tasks."),
        sectionMd("Bumps Due", sections.bumps_due, "One logged touch, six or more days ago, no reply."),
        sectionMd("Visits Due", sections.visits_due, "Two touches, no reply."),
        sectionMd("Closes Due", sections.closes_due, "Three or more touches, no reply. Forni decides the close."),
        sectionMd("First Touch Candidates", sections.first_touch, "Contact at NEW on a Next Up company, ordered by fit."),
        sectionMd("In Conversation", sections.conversation, "ENGAGED or beyond with Forni's message the last on the record; a reply is theirs to make."),
        sectionMd("Parked", sections.parked, "A task due later than this week suppresses the cadence."),
        sectionMd("Waiting", sections.waiting, "Sent fewer than six days ago."),
        sectionMd("Sends Never Logged", sections.unlogged_send, "CONTACTED with no email on the record: the send happened and was not logged. Propose the backfill rather than guessing the day count."),
        sectionMd("NEW but Off the Queue", sections.new_off_queue, "A NEW contact on a company that is disqualified, unscored, or past lead."),
        "Every active name's logged sends and replies in full, and the closed list, are in portal-detail.md beside this file, one `### Name, Company` heading per contact; read a name's block there when drafting for it.",
        "",
        "## Open Tasks",
        "",
        tasks.length ? tasks.map((t) => `### ${t.due || "undated"} (${t.reading}): ${t.subject}\n\n${t.contacts.map(nameOf).join(", ") || "no contact"}; ${t.companies.map(coName).join(", ") || "no company"}; ${t.status}${t.type ? ", " + t.type : ""}${t.priority ? ", " + t.priority : ""}.\n\n${t.body || "(no body)"}\n`).join("\n") : "None.",
        "",
        "## Meetings, Last Sixty Days",
        "",
        meetings.length ? meetings.map((m) => `### ${m.date}: ${m.title}\n\n${m.contacts.map(nameOf).join(", ") || "no contact"}; ${m.companies.map(coName).join(", ") || "no company"}${m.outcome ? "; " + m.outcome : ""}.\n\n${m.body || "(no body)"}${m.notes ? "\n\nInternal notes: " + m.notes : ""}\n`).join("\n") : "None.",
        "",
        "## Notes, Last Sixty Days",
        "",
        notes.length ? notes.map((n) => `### ${n.date}\n\n${n.contacts.map(nameOf).join(", ") || "no contact"}; ${n.companies.map(coName).join(", ") || "no company"}.\n\n${n.body || "(empty)"}\n`).join("\n") : "None.",
        "",
    ].join("\n");
    writeFileSync(join(outDir, "portal.md"), md);
    writeFileSync(join(outDir, "portal-detail.md"), [
        `# Portal detail for ${monday} to ${sunday}`,
        "",
        "Every active name's logged sends and replies, one block per contact, alphabetical by company. Read a block when drafting for that name; portal.md carries the sections and the counts.",
        "",
        "## Every Active Name, With Touches and Replies",
        "",
        active.map(detailMd).join("\n"),
        "## Closed and Not in the Motion",
        "",
        table(["Contact", "Company", "Status", "Read"], reads.filter((r) => ["closed", "not_in_motion"].includes(r.section)).map((r) => [r.name, r.company, r.status || "(none)", r.disqualification || r.why])),
        "",
    ].join("\n"));

    // The domains the site pull walks and the mailbox pull searches. Sites:
    // the names the model will draft for. Mail: every funnel domain and
    // address, since a reply the extension missed can sit under any of them.
    const siteRows = [...sections.bumps_due, ...sections.visits_due, ...sections.replies_owed, ...sections.tasks_due, ...sections.first_touch.slice(0, Number(process.env.SWEEP_FIRST_TOUCH_SITES || 8))];
    const seenSite = new Set();
    const sites = [];
    for (const r of siteRows) {
        const d = (r.domain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
        if (!d || seenSite.has(d)) continue;
        seenSite.add(d);
        sites.push(`${d}|${r.company}|${r.section}`);
    }
    writeFileSync(join(outDir, "sites.txt"), sites.join("\n") + (sites.length ? "\n" : ""));
    const mailTerms = new Set();
    for (const c of companies.values()) if (c.domain) mailTerms.add(c.domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""));
    for (const r of reads) if (r.email) mailTerms.add(r.email.toLowerCase());
    writeFileSync(join(outDir, "mail-terms.txt"), [...mailTerms].sort().join("\n") + "\n");
    log(`wrote portal.json, portal.md, portal-detail.md, ${sites.length} sites, ${mailTerms.size} mail terms`);
    console.log(JSON.stringify(counts));
}

// ---------- dispatch ----------

const [command, ...rest] = process.argv.slice(2);
if (command === "week") await week(rest);
else if (command === "sweep") await sweep(rest);
else {
    console.error("usage: node hubspot.mjs week <after-epoch> <before-epoch> | sweep <monday> <out-dir>");
    process.exit(2);
}
