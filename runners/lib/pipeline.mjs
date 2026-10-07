// What the Pipeline mail says needs Forni and how the funnel is doing, worked
// out of the portal sweep and the Linear read in code (ATE-630, 2026-10-07).
//
//   node pipeline.mjs fold <draft.json> <portal.json> <monday YYYY-MM-DD> [linear.json] [why linear is missing] [when a reused linear.json was written]
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

// How long after a company's last inbound message a new send stops being part
// of that conversation and is outreach again: a fresh first touch months
// after a thread went quiet. A starting point, like the flag's numbers.
export const NEW_RUN_DAYS = 30;

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
 * - Outreach is the first touch and the bumps: a run of sends that ends at
 *   the first real inbound reply to it. Everything Forni sends after that
 *   reply is a conversation, and counting it made a week of answers look like
 *   a week of outreach with a fine open rate (review, 2026-10-07). A send
 *   more than NEW_RUN_DAYS after the company's last inbound message starts a
 *   new run and counts again; cutting at the first reply anywhere in the
 *   lookback meant a fresh first touch after a dead conversation never did.
 * - A send to a company already at Opportunity or Customer is out (above).
 * - A company's day is tracked when any copy that day carried tracking and
 *   opened when a tracked copy shows an open.
 * - The reply that ends a run is credited to exactly one send, the latest
 *   send of that run: the latest on the reply's own thread when a send
 *   shares it, and otherwise the latest of any, since a real reply that
 *   arrived on a thread id no send carries (a new message, a forwarded one)
 *   is still an answer to the outreach. One reply marking every earlier send
 *   on the thread credited a first touch and its bump alike, and changed a
 *   past week's numbers after the fact.
 */
export function outreachSends(portal) {
    const companies = portal.companies || {};
    const byCompany = new Map();
    for (const c of Object.values(portal.contacts || {})) {
        if (!companies[c.company_id]) continue;
        if (!byCompany.has(c.company_id)) byCompany.set(c.company_id, []);
        const events = byCompany.get(c.company_id);
        for (const t of c.touches || []) {
            const ts = typeof t.ts === "number" ? t.ts : Date.parse(`${t.date}T18:00:00Z`);
            if (!Number.isNaN(ts)) events.push({ send: { ...t, ts, day: typeof t.ts === "number" ? denverDay(t.ts) : t.date }, ts });
        }
        for (const r of c.replies || []) if (typeof r.ts === "number") events.push({ reply: r, ts: r.ts });
    }
    const sends = [];
    for (const [id, events] of byCompany) {
        const outreach = [];
        const credited = new Set();
        // The run in flight, and when they last wrote: a reply closes the run
        // and opens a conversation, which lasts until NEW_RUN_DAYS of silence
        // from them.
        let run = [];
        let lastInbound = null;
        for (const event of events.sort((a, b) => a.ts - b.ts)) {
            if (event.reply) {
                const threaded = event.reply.thread ? run.filter((t) => t.thread === event.reply.thread) : [];
                const pool = threaded.length > 0 ? threaded : run;
                if (pool.length > 0) credited.add(pool[pool.length - 1]);
                run = [];
                lastInbound = event.ts;
                continue;
            }
            if (lastInbound !== null && event.ts - lastInbound <= NEW_RUN_DAYS * MS_DAY) continue;
            if (pastOutreach(companies[id], event.ts)) continue;
            lastInbound = null;
            run.push(event.send);
            outreach.push(event.send);
        }
        const days = new Map();
        for (const t of outreach) {
            const day = days.get(t.day) || { company: id, day: t.day, week: isoWeek(t.day), tracked: false, opened: false, responded: false };
            day.tracked = day.tracked || t.tracked === true;
            day.opened = day.opened || (t.tracked === true && (t.opens || 0) > 0);
            day.responded = day.responded || credited.has(t);
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

// What the sweep reads as the next touch, in words. The portal's read of a
// reply is worded as what it is, a direction logged on a record: whether a
// reply is owed is decided by the mailbox thread, which is the model's
// `owed.reply`, and only that can put "reply owed" on a line (settleOwed).
//
// A second touch and a first touch are not here on purpose. They are the
// drafted kinds: the routine writes them and the mail counts them under Cold
// Touches, so a SQL whose only next step is one of those gets no warm line,
// or it would be listed twice, once as a line and once in a count.
const NEXT_WORDS = {
    reply: "last message on the record is theirs, check the thread",
    decide: "close or keep, past the clock",
    visit: "visit or call due",
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

// The lines whose `who` is a deal's name because no company row was there to
// name them. Kept beside the lines rather than on them, so the draft carries
// no field the renderer does not read; settleOwed asks it so that a company
// which happens to share a deal's name is never matched to that line.
const DEAL_NAMED = new WeakSet();

/**
 * Open proposals: exactly one line per open deal, the larger first and then
 * the sooner due. A deal is named by its first company the sweep knows; a
 * deal on two companies is still one proposal and one line, and a deal whose
 * company is outside the funnel rows is named by the deal itself, since
 * money on the table is not something to leave off for want of a row. A deal
 * whose company has been closed with a reason is left out. What is owed is
 * that company's nearest open task, parked or not, since a proposal's task
 * is the date Forni said he would reach back out; with no task the line says
 * where the deal stands. A Customer's open deal always says where it stands:
 * a Customer's nearest task is client work, and it read as what an upsell
 * proposal owed. Two deals open at one company are each led by the
 * deal's own name, which with the money is what tells them apart.
 */
function proposalLines(portal, rows) {
    const placed = dealsOf(portal).filter((d) => !d.closed).map((deal) => {
        const id = (deal.companies || []).find((co) => portal.companies?.[co]) || null;
        return { deal, id, company: id ? portal.companies[id] : null };
    }).filter(({ company }) => !company?.disqualification_reason);
    const perCompany = new Map();
    for (const { id } of placed) if (id) perCompany.set(id, (perCompany.get(id) || 0) + 1);
    const lines = placed.map(({ deal, id, company }) => {
        const task = (id && company.lifecyclestage !== "customer" && rows.get(id)?.task) || null;
        const owed = task?.subject || deal.stage || "an open deal";
        const line = {
            who: company?.name || deal.name || "An open deal", amount: deal.amount ?? null,
            owed: company && perCompany.get(id) > 1 && deal.name ? `${deal.name}: ${owed}` : owed,
            due: task?.due || "", url: company?.url || null,
        };
        if (!company) DEAL_NAMED.add(line);
        return line;
    });
    return lines.sort((a, b) => ((b.amount || 0) - (a.amount || 0)) || dueOrder(a, b));
}

/**
 * Warm SQLs: a live SQL company with something owed this week that is not a
 * drafted touch: a task due or overdue, a visit, a close, or an inbound
 * message the record shows as the last word. A name parked past this week
 * stays out, as it did in the old mail, and so does one that is only waiting
 * on them or only owed a second or a first touch, which the counts carry.
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

/**
 * The company's open HubSpot tasks, as lines with no ticket. `due` keeps only
 * the ones due this week or overdue; without it every task not parked past
 * this week is a line, the undated included.
 */
function taskLines(portal, company, { due = false } = {}) {
    const own = new Set(company.contacts || []);
    return (portal.tasks || [])
        .filter((t) => t.subject && (due ? ["due", "stale"].includes(t.reading) : t.reading !== "parked"))
        .filter((t) => (t.companies || []).includes(company.id) || (t.contacts || []).some((id) => own.has(id)))
        .map((t) => ({ who: company.name, owed: t.subject, due: t.due || "", url: company.url, priority: 0 }));
}

/**
 * The three customer tiers. A Customer company's lines are the open issues of
 * the active cycle in the Linear project its `linear_project` property names,
 * and with them its open HubSpot tasks due this week or overdue, since a hold
 * Forni set on the record is owed whether or not a ticket exists; a task
 * whose subject repeats an issue's title is the same work and is said once.
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
            const issues = linear.filter((issue) => (issue.project || "").trim().toLowerCase() === project.toLowerCase());
            // Both sides are trimmed the same way before they are compared: a
            // task filed as "<Customer>: audit the tag container" and an issue
            // titled "W41: audit the tag container" are one piece of work.
            const trimmed = (text) => norm(trimTitle(text, [company.name, project]));
            const titles = new Set(issues.map((issue) => trimmed(issue.title)));
            lines = [
                ...issues.map((issue) => ({
                    who: company.name, owed: trimTitle(issue.title, [company.name, project]), due: issue.dueDate || "",
                    url: company.url, ref: issue.identifier, ref_url: issue.url, priority: issue.priority,
                })),
                ...taskLines(portal, company, { due: true }).filter((line) => !titles.has(trimmed(line.owed))),
            ];
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

// What a visit or a close adds to a named line when the company already has one.
const FOLDED_WORDS = { visit: "visit owed", decide: "close or keep" };

/**
 * The model's owed names settled against the named lines, so the mail says
 * each thing once and loses nothing. A company with a named line is worked
 * on that line, so what else the model owes there is added to it:
 *
 * - A reply owed is appended as "; reply owed to <person>: <note>", then
 *   leaves `owed.reply`, which would otherwise print it a second time.
 * - A visit or a close is appended as "; visit owed" or "; close or keep",
 *   then leaves its count.
 * - Second touches and first touches are left exactly as the model sent them.
 *
 * A fold adds and never replaces: the line keeps its own words (the ticket's
 * title, the task's subject), several replies at one company each add
 * theirs, and the same words are never added twice. The line it lands on is
 * the company's first, in the tiers' own order, which is its most senior.
 * Matched on the record's url when the name and the line both carry one,
 * and two different records are never the same company whatever they are
 * called; the name decides only when one side has no url, and never against
 * a line that is named for a deal. Returns the settled `owed` and the tiers
 * with what was folded in.
 */
export function settleOwed(owed, tiers) {
    const settled = tiers.map((t) => ({
        ...t,
        lines: (t.lines || []).map((l) => {
            const copy = { ...l };
            if (DEAL_NAMED.has(l)) DEAL_NAMED.add(copy);
            return copy;
        }),
    }));
    const lines = settled.flatMap((t) => t.lines);
    const lineOf = (n) => lines.find((l) => {
        const theirs = norm(n.company_url);
        const ours = norm(l.url);
        if (theirs && ours) return theirs === ours;
        return !DEAL_NAMED.has(l) && norm(n.company) !== "" && norm(l.who) === norm(n.company);
    });
    const add = (line, words) => {
        const held = String(line.owed || "").split("; ").filter(Boolean);
        if (!held.includes(words)) line.owed = [...held, words].join("; ");
    };
    const out = {};
    for (const [kind, list] of Object.entries(owed || {})) out[kind] = [...(list || [])];
    out.reply = (out.reply || []).filter((n) => {
        const line = lineOf(n);
        if (!line) return true;
        const to = String(n.person || "").trim();
        const note = String(n.note || "").trim();
        add(line, `reply owed${to ? ` to ${to}` : ""}${note ? `: ${note}` : ""}`);
        return false;
    });
    for (const [kind, words] of Object.entries(FOLDED_WORDS)) {
        if (!out[kind]) continue;
        out[kind] = out[kind].filter((n) => {
            const line = lineOf(n);
            if (line) add(line, words);
            return !line;
        });
    }
    return { owed: out, tiers: settled };
}

// ---------- the fold ----------

/**
 * The draft as the renderer reads it: `needs` and `health` added, `owed`
 * settled against the named lines, and a flag (which the mail prints under Left for You) when
 * the customer lines did not come from Linear.
 */
export function fold(draft, portal, { monday, nowMs = Date.now(), linear = null, linearError = "", linearTruncated = false, linearReused = "" } = {}) {
    const built = needsOf(portal, linear);
    const flags = [...(draft.flags || [])];
    if (linear === null && built.customers > 0) {
        flags.unshift({ lead: `The Linear read did not run${linearError ? ` (${linearError})` : ""}, so the customer lines are open HubSpot tasks.` });
    } else if (built.unmapped.length > 0) {
        flags.unshift({ lead: `No linear_project on ${built.unmapped.join(", ")}, so ${built.unmapped.length === 1 ? "its" : "their"} lines are open HubSpot tasks.` });
    }
    // A read saved by an earlier pull is the cycle as it stood then. The
    // lines are still worth having, and the mail says how old they are, when
    // there is a customer for it to matter to, as with the line above.
    if (linear !== null && linearReused && built.customers > 0) {
        flags.unshift({ lead: `The Linear read is from an earlier pull (${linearReused}), so the customer lines may be behind.` });
    }
    if (linear !== null && linearTruncated) {
        flags.unshift({ lead: `The Linear read stopped at ${linear.length} issues, so a customer line may be missing.` });
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
    const [command, draftPath, portalPath, monday, linearPath, linearError, linearReused] = process.argv.slice(2);
    if (command !== "fold" || !draftPath || !portalPath || !/^\d{4}-\d{2}-\d{2}$/.test(monday || "")) {
        console.error("usage: node pipeline.mjs fold <draft.json> <portal.json> <monday YYYY-MM-DD> [linear.json] [why linear is missing] [when a reused linear.json was written]");
        process.exit(2);
    }
    const read = (path) => JSON.parse(readFileSync(path, "utf8"));
    let linear = null;
    let linearTruncated = false;
    let why = linearError || "";
    if (linearPath) {
        try {
            const saved = read(linearPath);
            if (!Array.isArray(saved.issues)) throw new Error("no issues array");
            linear = saved.issues;
            linearTruncated = saved.truncated === true;
        } catch (error) {
            why = why || "the saved Linear read could not be parsed";
        }
    }
    const out = fold(read(draftPath), read(portalPath), { monday, linear, linearError: why, linearTruncated, linearReused: linearReused || "" });
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}
