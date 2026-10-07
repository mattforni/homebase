// What the Pipeline mail says needs Forni and how the funnel is doing, worked
// out of the portal sweep and the Linear read in code (ATE-630, 2026-10-07).
//
//   node pipeline.mjs fold <draft.json> <portal.json> <monday YYYY-MM-DD> [linear.json] [why linear is missing]
//       Prints the draft with `needs` and `health` added, `owed` settled
//       against the named lines, and a flag when the Linear read did not run. The entrypoint calls it after the funnel merge.
//
// The order of the mail was the model's until this file. It sorted the week
// into five kinds of touch and the mail drew whatever it sent, so the order
// moved with the prompt and the numbers with the model's arithmetic. The
// order is Forni's and fixed (the renderer holds it); the lines under it are
// records, so they are read here, where a wrong join fails a test rather than
// reading as authoritative in Monday's inbox. Same reasoning as hubspot.mjs:
// the model's job is the sentence, this file's job is the facts.
//
// Everything below the dispatch at the foot is a pure function of its
// arguments, so the tests hand it small portals and read what comes back.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ---------- the constants ----------

// The week's standing number of first touches, which the mail reads the count
// against. The Atelic repo's Outreach/README.md (The Weekly Scoreboard) is
// where the number is decided; this is its copy, and it moves when that does.
export const FIRST_TOUCH_TARGET = 15;

// The table shows this many send weeks, the current one included, and the
// runner hands the renderer one more behind them, which is never drawn: it
// is what the oldest row shown reads its change against.
export const HEALTH_WEEKS = 4;
export const HEALTH_HANDED = HEALTH_WEEKS + 1;

// When the open rate earns a sentence. A starting point (ATE-630), not a
// finding: fewer than ten tracked sends is too few to read a rate off, and
// fifteen below the mean of the three weeks before is about the size of the
// W38 to W39 fall that was real. Tune them once a few months of weeks exist.
export const FLAG_MIN_TRACKED = 10;
export const FLAG_DROP = 15;
export const FLAG_PRIOR_WEEKS = 3;

const MS_DAY = 86400000;

// ---------- the dates ----------

// A send belongs to its Denver day, for the reason hubspot.mjs gives: a UTC
// date would hand Sunday evening's sends to the following week. Assembled
// from parts rather than a locale's pattern, as there.
const DENVER_PARTS = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
});
export const denverDay = (ms) => {
    const p = Object.fromEntries(DENVER_PARTS.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
};

// Calendar arithmetic on a YYYY-MM-DD, done in UTC so no offset can move it.
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * MS_DAY).toISOString().slice(0, 10);
export const mondayOf = (day) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

// The ISO week a day falls in: the week belongs to the year its Thursday is
// in, and week one is the week holding January 4, which is how 2026-12-31
// reads as 2026-W53 and 2027-01-03 with it.
export const isoWeek = (day) => {
    const monday = mondayOf(day);
    const year = Number(addDays(monday, 3).slice(0, 4));
    const first = mondayOf(`${year}-01-04`);
    const n = Math.round((Date.parse(`${monday}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / (7 * MS_DAY)) + 1;
    return `${year}-W${String(n).padStart(2, "0")}`;
};

// ---------- health: the send weeks ----------

/**
 * True when the company was already an Opportunity or a Customer the moment
 * the send went out: that send is a proposal follow up or client work, not
 * outreach. Read off HubSpot's own entered dates, which the sweep carries and
 * the groom stamps. A company at one of those stages with no entered date at
 * all (created straight into the stage) is taken as past outreach throughout,
 * the one place this falls back from "at send time" to "now".
 */
function pastOutreach(company, sentMs) {
    const entered = [company.hs_v2_date_entered_opportunity, company.hs_v2_date_entered_customer]
        .map((v) => (v ? Date.parse(v) : Number.NaN))
        .filter((v) => !Number.isNaN(v));
    if (entered.length === 0) return ["opportunity", "customer"].includes(company.lifecyclestage);
    return entered.some((v) => v <= sentMs);
}

/**
 * Every outreach send in the sweep, one per company per day, which is the
 * practice's rule for what a send is (the same first touch to two addresses
 * an hour apart is one send). What goes in and what stays out:
 *
 * - The sweep's companies are the funnel alone, so lifecycle Other never
 *   reaches here, and its noise list has already dropped calendar traffic and
 *   autoresponders from both the sends and the replies.
 * - Outreach is the first touch and the bumps: a company's sends up to its
 *   first real inbound reply. Everything Forni sends after that reply is a
 *   conversation, and counting it made a week of answers look like a week of
 *   outreach with a fine open rate (review, 2026-10-07).
 * - A send to a company already at Opportunity or Customer is out (above).
 * - A company's day is tracked when any copy that day carried tracking and
 *   opened when a tracked copy shows an open.
 * - That first reply is credited to exactly one send, the latest outreach
 *   send before it, on its own thread when the record carries thread ids and
 *   the latest of any when it does not. One reply marking every earlier send
 *   on the thread credited a first touch and its bump alike, and changed a
 *   past week's numbers after the fact.
 */
export function outreachSends(portal) {
    const companies = portal.companies || {};
    const byCompany = new Map();
    for (const c of Object.values(portal.contacts || {})) {
        if (!companies[c.company_id]) continue;
        if (!byCompany.has(c.company_id)) byCompany.set(c.company_id, { touches: [], replies: [] });
        const held = byCompany.get(c.company_id);
        for (const t of c.touches || []) {
            const ts = typeof t.ts === "number" ? t.ts : Date.parse(`${t.date}T18:00:00Z`);
            if (!Number.isNaN(ts)) held.touches.push({ ...t, ts, day: typeof t.ts === "number" ? denverDay(t.ts) : t.date });
        }
        for (const r of c.replies || []) if (typeof r.ts === "number") held.replies.push(r);
    }
    const sends = [];
    for (const [id, held] of byCompany) {
        const first = held.replies.sort((a, b) => a.ts - b.ts)[0] || null;
        const outreach = held.touches
            .sort((a, b) => a.ts - b.ts)
            .filter((t) => (first === null || t.ts < first.ts) && !pastOutreach(companies[id], t.ts));
        let credited = null;
        if (first !== null) {
            const threaded = first.thread ? outreach.filter((t) => t.thread === first.thread) : [];
            const pool = threaded.length > 0 ? threaded : outreach.filter((t) => !t.thread || !first.thread);
            credited = pool[pool.length - 1] || null;
        }
        const days = new Map();
        for (const t of outreach) {
            const day = days.get(t.day) || { company: id, day: t.day, week: isoWeek(t.day), tracked: false, opened: false, responded: false };
            day.tracked = day.tracked || t.tracked === true;
            day.opened = day.opened || (t.tracked === true && (t.opens || 0) > 0);
            day.responded = day.responded || t === credited;
            days.set(t.day, day);
        }
        sends.push(...days.values());
    }
    return sends;
}

const rate = (part, whole) => (whole > 0 ? Math.round((part * 100) / whole) : null);

/** One week's row. Only tracked sends are counted at all: an untracked send has no open to read, so it is in neither the numerator nor the denominator, of either rate. */
function weekRow(week, sends) {
    const tracked = sends.filter((s) => s.week === week && s.tracked);
    const opened = tracked.filter((s) => s.opened).length;
    const responded = tracked.filter((s) => s.responded).length;
    return { week, tracked: tracked.length, opened, rate: rate(opened, tracked.length), responded, respond_rate: rate(responded, tracked.length) };
}

/**
 * The sentence the table earns when the open rate has turned: the latest
 * complete week against the three before it, pooled (their opens over their
 * tracked sends), so a week of two sends cannot swing the comparison the way
 * it would in a mean of three rates. The current week is complete only on a
 * replay after its Sunday, so on a Monday run the week judged is the one that
 * just ended. Null when the judged week or the pool behind it is too thin to
 * read: each has to clear the same floor of tracked sends.
 */
export function healthFlag(rows, monday, nowMs) {
    const complete = denverDay(nowMs) >= addDays(monday, 7) ? isoWeek(monday) : isoWeek(addDays(monday, -7));
    const at = rows.findIndex((r) => r.week === complete);
    if (at < 0) return null;
    const judged = rows[at];
    if (judged.tracked < FLAG_MIN_TRACKED || judged.rate === null) return null;
    const prior = rows.slice(Math.max(0, at - FLAG_PRIOR_WEEKS), at);
    const tracked = prior.reduce((sum, r) => sum + r.tracked, 0);
    if (prior.length < FLAG_PRIOR_WEEKS || tracked < FLAG_MIN_TRACKED) return null;
    const before = rate(prior.reduce((sum, r) => sum + r.opened, 0), tracked);
    if (before - judged.rate < FLAG_DROP) return null;
    const label = `W${Number(judged.week.split("-W")[1])}`;
    return `${label} opened at ${judged.rate}% on ${judged.tracked} tracked sends, ${before - judged.rate} below the ${before}% of the three weeks before it.`;
}

/**
 * The send weeks, oldest first, the week of `monday` last, and the flag. One
 * more week is handed over than the table draws (HEALTH_HANDED), so the
 * oldest row drawn has a week beneath it to read its change against.
 */
export function healthOf(portal, monday, nowMs) {
    const sends = outreachSends(portal);
    // Enough weeks that the judged week has its three behind it whichever
    // week that turns out to be, and never fewer than are handed over.
    const span = Math.max(HEALTH_HANDED, 2 + FLAG_PRIOR_WEEKS);
    const rows = Array.from({ length: span }, (_, i) => weekRow(isoWeek(addDays(monday, -7 * (span - 1 - i))), sends));
    return { weeks: rows.slice(-HEALTH_HANDED), flag: healthFlag(rows, monday, nowMs) };
}

// ---------- needs: the named lines ----------

const dueOrder = (a, b) => (a.due || "9999").localeCompare(b.due || "9999");
// Linear's priority runs 1 (urgent) to 4 (low) with 0 for none, which sorts last.
const priorityRank = (p) => (p >= 1 && p <= 4 ? p : 5);

const NEXT_WORDS = {
    reply: "reply owed; theirs is the last message on the record",
    decide: "close or keep, past the clock",
    visit: "visit or call due",
    bump: "second touch due",
    first: "first touch due",
};

/** A stage's company rows, as the sweep lists them, keyed by nothing: the caller filters. */
const stageRows = (portal, key) => (portal.funnel?.stages || []).find((s) => s.key === key)?.companies || [];

/**
 * Every deal the sweep read, or, for a portal.json written before the sweep
 * carried them (a reused pull), the one deal each Opportunity row holds.
 */
function dealsOf(portal) {
    if (Array.isArray(portal.deals)) return portal.deals;
    return stageRows(portal, "opportunity").filter((row) => row.deal)
        .map((row) => ({ ...row.deal, closed: false, won: false, companies: [row.id] }));
}

/**
 * Open proposals: one line per open deal on a live funnel company, the
 * larger first and then the sooner due. What is owed is the company's nearest
 * open task, parked or not, since a proposal's task is the date Forni said
 * he would reach back out; with no task the line says where the deal stands.
 * A company with two deals open gets two lines, each led by its deal's own
 * name, since the company and the task are the same on both and the name and
 * the money are what tell them apart.
 */
function proposalLines(portal, rows) {
    const open = dealsOf(portal).filter((d) => !d.closed);
    const perCompany = new Map();
    for (const deal of open) for (const id of deal.companies || []) perCompany.set(id, (perCompany.get(id) || 0) + 1);
    const lines = [];
    for (const deal of open) {
        for (const id of deal.companies || []) {
            const company = portal.companies?.[id];
            if (!company || company.disqualification_reason) continue;
            const task = rows.get(id)?.task || null;
            const owed = task?.subject || deal.stage || "an open deal";
            lines.push({
                who: company.name, amount: deal.amount ?? null,
                owed: perCompany.get(id) > 1 && deal.name ? `${deal.name}: ${owed}` : owed,
                due: task?.due || "", url: company.url,
            });
        }
    }
    return lines.sort((a, b) => ((b.amount || 0) - (a.amount || 0)) || dueOrder(a, b));
}

/**
 * Warm SQLs: a live SQL company with something owed this week, either a task
 * due or overdue or a touch the sweep reads as owed. A name parked past this
 * week stays out, as it did in the old mail, and so does one that is only
 * waiting on them.
 */
function warmLines(portal) {
    const lines = [];
    for (const row of stageRows(portal, "sql")) {
        const due = row.task && ["due", "stale"].includes(row.task.reading) ? row.task : null;
        const next = NEXT_WORDS[row.next] || "";
        if (!due && !next) continue;
        lines.push({ who: row.name, owed: due?.subject || next, due: due?.due || "", url: row.url });
    }
    return lines.sort(dueOrder);
}

/**
 * An issue's title as what is owed: a leading week tag ("W41: ...",
 * "[2026-W41] ...") and a leading "<Customer>:" go, since the line already
 * opens on the customer and sits in a mail that names its week. A week tag is
 * the ISO form or a capital W and two digits, standing alone before more
 * words; anything looser ate real titles, "W3C validation fixes" down to "C
 * validation fixes" and a W9 with it (review, 2026-10-07).
 */
export function trimTitle(title, names) {
    const week = /^\s*[[(]?(?:\d{4}-W\d{2}|W\d{2})[\])]?(?:\s*[:.·,\u2013\u2014-]\s*|\s+)(?=\S)/;
    let out = String(title || "").replace(week, "");
    for (const name of names.filter(Boolean)) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out = out.replace(new RegExp(`^\\s*${escaped}\\s*[:·,\\u2013\\u2014-]\\s*`, "i"), "");
    }
    out = out.replace(week, "").trim();
    return out || String(title || "").trim();
}

/** The company's open HubSpot tasks, as lines with no ticket: the customer lines when Linear cannot supply them. A task parked past this week stays out. */
function taskLines(portal, company) {
    const own = new Set(company.contacts || []);
    return (portal.tasks || [])
        .filter((t) => t.subject && t.reading !== "parked")
        .filter((t) => (t.companies || []).includes(company.id) || (t.contacts || []).some((id) => own.has(id)))
        .map((t) => ({ who: company.name, owed: t.subject, due: t.due || "", url: company.url, priority: 0 }));
}

/**
 * The three customer tiers. A Customer company's lines are the open issues of
 * the active cycle in the Linear project its `linear_project` property names.
 * The won deal's `engagement_phase` says build or operate (build when unset),
 * and the company is paying when its won deals sum to more than nothing and a
 * trade otherwise. When Linear did not answer, or the company names no
 * project, its open HubSpot tasks stand in, and `unmapped` names it so the
 * mail can say so.
 */
function customerTiers(portal, linear) {
    const tiers = { paying_build: [], trade_build: [], operate: [] };
    const unmapped = [];
    const rows = stageRows(portal, "customer");
    const deals = dealsOf(portal);
    for (const row of rows) {
        const company = portal.companies?.[row.id];
        if (!company || company.disqualification_reason) continue;
        const won = deals.filter((d) => d.won && (d.companies || []).includes(row.id))
            .sort((a, b) => (b.close || "").localeCompare(a.close || ""));
        const phase = won.find((d) => d.engagement_phase)?.engagement_phase === "operate" ? "operate" : "build";
        const paying = won.reduce((sum, d) => sum + (Number(d.amount) || 0), 0) > 0;
        const project = (company.linear_project || "").trim();
        let lines;
        if (linear && project) {
            lines = linear.filter((issue) => (issue.project || "").trim().toLowerCase() === project.toLowerCase())
                .map((issue) => ({
                    who: company.name, owed: trimTitle(issue.title, [company.name, project]), due: issue.dueDate || "",
                    url: company.url, ref: issue.identifier, ref_url: issue.url, priority: issue.priority,
                }));
        } else {
            if (linear) unmapped.push(company.name);
            lines = taskLines(portal, company);
        }
        tiers[phase === "operate" ? "operate" : paying ? "paying_build" : "trade_build"].push(...lines);
    }
    for (const key of Object.keys(tiers)) {
        tiers[key] = tiers[key]
            .sort((a, b) => dueOrder(a, b) || (priorityRank(a.priority) - priorityRank(b.priority)))
            .map(({ priority, ...line }) => line);
    }
    return { tiers, unmapped, customers: rows.length };
}

/**
 * The named tiers in the mail's own keys. `linear` is the issue list, or null
 * when the read did not run. The renderer orders the tiers; within one, the
 * order here is the order drawn.
 */
export function needsOf(portal, linear) {
    const rows = new Map((portal.funnel?.stages || []).flatMap((s) => s.companies || []).map((row) => [row.id, row]));
    const customers = customerTiers(portal, linear);
    return {
        needs: {
            first_touch_target: FIRST_TOUCH_TARGET,
            tiers: [
                { key: "paying_build", lines: customers.tiers.paying_build },
                { key: "trade_build", lines: customers.tiers.trade_build },
                { key: "operate", lines: customers.tiers.operate },
                { key: "proposal", lines: proposalLines(portal, rows) },
                { key: "warm_sql", lines: warmLines(portal) },
            ],
        },
        unmapped: customers.unmapped,
        customers: customers.customers,
    };
}

// ---------- owed: nobody listed twice ----------

const norm = (v) => String(v || "").trim().toLowerCase();

// The kinds whose every name carries a payload the runner fires. A name is
// never taken out of these: the draft lands in Drafts either way, so removing
// the name made "3 drafts ready" disagree with four drafts and undercounted
// first touches against the week's target (review, 2026-10-07).
const DRAFTED_KINDS = new Set(["bump", "first_touch"]);

/**
 * The model's owed names settled against the named lines, so the mail says
 * each thing once and loses nothing:
 *
 * - A reply owed on a company that already has a named line is folded into
 *   that line as what is owed, the model's note and the person it is owed to,
 *   since a reply outranks a task's subject or a deal's stage; then it leaves
 *   `owed.reply`, which would otherwise print it a second time.
 * - A visit or a close on such a company, or on a person still owed a reply,
 *   leaves its count: the named line is where that name is worked.
 * - Second touches and first touches are left exactly as the model sent them.
 *
 * Matched on the record's url, and on the company's name for a row with no
 * url. Returns the settled `owed` and the tiers with any folded reply.
 */
export function settleOwed(owed, tiers) {
    const settled = tiers.map((t) => ({ ...t, lines: (t.lines || []).map((l) => ({ ...l })) }));
    const lines = settled.flatMap((t) => t.lines);
    const lineOf = (n) => lines.find((l) => (norm(n.company_url) && norm(l.url) === norm(n.company_url)) || (norm(n.company) && norm(l.who) === norm(n.company)));
    const out = {};
    for (const [kind, list] of Object.entries(owed || {})) out[kind] = [...(list || [])];
    out.reply = (out.reply || []).filter((n) => {
        const line = lineOf(n);
        if (!line) return true;
        const to = String(n.person || "").trim();
        const note = String(n.note || "").trim();
        line.owed = `reply owed${to ? ` to ${to}` : ""}${note ? `: ${note}` : ""}`;
        return false;
    });
    const replied = new Set(out.reply.flatMap((n) => [norm(n.contact_url), norm(n.company_url)]).filter(Boolean));
    for (const kind of Object.keys(out)) {
        if (kind === "reply" || DRAFTED_KINDS.has(kind)) continue;
        out[kind] = out[kind].filter((n) => !lineOf(n) && !replied.has(norm(n.contact_url)) && !(norm(n.company_url) && replied.has(norm(n.company_url))));
    }
    return { owed: out, tiers: settled };
}

// ---------- the fold ----------

/**
 * The draft as the renderer reads it: `needs` and `health` added, `owed`
 * settled against the named lines, and a flag (which the mail prints under Left for You) when
 * the customer lines did not come from Linear.
 */
export function fold(draft, portal, { monday, nowMs = Date.now(), linear = null, linearError = "" } = {}) {
    const built = needsOf(portal, linear);
    const flags = [...(draft.flags || [])];
    if (linear === null && built.customers > 0) {
        flags.unshift({ lead: `The Linear read did not run${linearError ? ` (${linearError})` : ""}, so the customer lines are open HubSpot tasks.` });
    } else if (built.unmapped.length > 0) {
        flags.unshift({ lead: `No linear_project on ${built.unmapped.join(", ")}, so ${built.unmapped.length === 1 ? "its" : "their"} lines are open HubSpot tasks.` });
    }
    const settled = settleOwed(draft.owed, built.needs.tiers);
    return {
        ...draft,
        needs: { ...built.needs, tiers: settled.tiers },
        health: healthOf(portal, monday, nowMs),
        owed: settled.owed,
        flags,
    };
}

// ---------- dispatch ----------

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
    const [command, draftPath, portalPath, monday, linearPath, linearError] = process.argv.slice(2);
    if (command !== "fold" || !draftPath || !portalPath || !/^\d{4}-\d{2}-\d{2}$/.test(monday || "")) {
        console.error("usage: node pipeline.mjs fold <draft.json> <portal.json> <monday YYYY-MM-DD> [linear.json] [why linear is missing]");
        process.exit(2);
    }
    const read = (path) => JSON.parse(readFileSync(path, "utf8"));
    let linear = null;
    let why = linearError || "";
    if (linearPath) {
        try {
            const issues = read(linearPath).issues;
            if (!Array.isArray(issues)) throw new Error("no issues array");
            linear = issues;
        } catch (error) {
            why = why || `unreadable ${linearPath}`;
        }
    }
    const out = fold(read(draftPath), read(portalPath), { monday, linear, linearError: why });
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}
