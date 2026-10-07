import assert from "node:assert/strict";
import { test } from "node:test";
import { activeCycleIssues } from "../linear.mjs";
import {
    FIRST_TOUCH_TARGET,
    FLAG_DROP,
    FLAG_MIN_TRACKED,
    fold,
    healthOf,
    isoWeek,
    needsOf,
    outreachSends,
    settleOwed,
    trimTitle,
} from "../pipeline.mjs";

/*
 * The gate on what the Pipeline mail says needs Forni and how the funnel is
 * doing (ATE-630). Every portal here is invented and small: the names, the
 * ids and the urls are made up, because this repository is public and the
 * portal is not. Each test names the one rule it holds, since these are the
 * joins a wrong answer would otherwise deliver to Monday's inbox as fact.
 *
 *   node --test runners/lib/tst/
 */

const ms = (iso) => Date.parse(iso);
const url = (id) => `https://app.example.test/record/0-2/${id}`;

/** A send, as the sweep writes one onto a contact. */
const touch = (iso, extra = {}) => ({ ts: ms(iso), date: iso.slice(0, 10), tracked: true, opens: 0, thread: "", ...extra });
const reply = (iso, extra = {}) => ({ ts: ms(iso), date: iso.slice(0, 10), thread: "", ...extra });
const contact = (id, company, touches = [], replies = []) => ({ contact_id: id, company_id: company, touches, replies });
const company = (id, extra = {}) => ({ id, name: `Company ${id}`, url: url(id), lifecyclestage: "lead", contacts: [], ...extra });

function portalOf({ companies = [], contacts = [], stages = {}, deals, tasks = [] }) {
    return {
        companies: Object.fromEntries(companies.map((c) => [c.id, c])),
        contacts: Object.fromEntries(contacts.map((c) => [c.contact_id, c])),
        funnel: { stages: Object.entries(stages).map(([key, rows]) => ({ key, companies: rows })) },
        ...(deals === undefined ? {} : { deals }),
        tasks,
    };
}

/* ---------- the weeks ---------- */

test("an ISO week belongs to the year its Thursday is in", () => {
    assert.equal(isoWeek("2026-10-07"), "2026-W41");
    assert.equal(isoWeek("2026-12-31"), "2026-W53");
    assert.equal(isoWeek("2027-01-03"), "2026-W53");
    assert.equal(isoWeek("2027-01-04"), "2027-W01");
    assert.equal(isoWeek("2024-12-30"), "2025-W01");
});

test("a send is bucketed by its Denver day, so Sunday evening stays in its own week", () => {
    const portal = portalOf({
        companies: [company("1"), company("2")],
        contacts: [
            // 23:30 on Sunday 10-04 in Denver, already Monday in UTC.
            contact("a", "1", [touch("2026-10-05T05:30:00Z")]),
            // 00:30 on Monday 10-05 in Denver.
            contact("b", "2", [touch("2026-10-05T06:30:00Z")]),
        ],
    });
    const weeks = Object.fromEntries(outreachSends(portal).map((s) => [s.company, s.week]));
    assert.deepEqual(weeks, { 1: "2026-W40", 2: "2026-W41" });
});

test("the weeks end on the run's own, oldest first, across a year boundary, with one extra behind the four drawn", () => {
    const portal = portalOf({
        companies: [company("1")],
        contacts: [contact("a", "1", [touch("2026-12-30T18:00:00Z", { opens: 2 })])],
    });
    const health = healthOf(portal, "2027-01-04", ms("2027-01-05T05:00:00Z"));
    // Five are handed over: the four the table draws and the one behind them
    // that the oldest drawn row reads its change against.
    assert.deepEqual(health.weeks.map((w) => w.week), ["2026-W50", "2026-W51", "2026-W52", "2026-W53", "2027-W01"]);
    assert.deepEqual(health.weeks[3], { week: "2026-W53", tracked: 1, opened: 1, rate: 100, responded: 0, respond_rate: 0 });
    assert.equal(health.weeks[4].rate, null, "a week with no tracked send has no rate");
});

/* ---------- what a send is ---------- */

test("an untracked send is in neither the numerator nor the denominator", () => {
    const portal = portalOf({
        companies: [company("1"), company("2")],
        contacts: [
            contact("a", "1", [touch("2026-10-06T18:00:00Z", { tracked: false, opens: null })]),
            contact("b", "2", [touch("2026-10-06T18:00:00Z", { opens: 3 })]),
        ],
    });
    const week = healthOf(portal, "2026-10-05", ms("2026-10-07T18:00:00Z")).weeks.at(-1);
    assert.deepEqual([week.tracked, week.opened, week.rate], [1, 1, 100]);
});

test("two addresses at one company on one day are one send, tracked and opened if either was", () => {
    const portal = portalOf({
        companies: [company("1")],
        contacts: [
            contact("a", "1", [touch("2026-10-06T15:00:00Z", { tracked: false, opens: null })]),
            contact("b", "1", [touch("2026-10-06T16:00:00Z", { opens: 1 }), touch("2026-10-07T16:00:00Z")]),
        ],
    });
    const sends = outreachSends(portal).sort((a, b) => a.day.localeCompare(b.day));
    assert.equal(sends.length, 2, "one for each day, not one for each message");
    assert.deepEqual([sends[0].tracked, sends[0].opened], [true, true]);
    assert.deepEqual([sends[1].tracked, sends[1].opened], [true, false]);
});

test("outreach is a company's sends up to its first real reply, and nothing after it", () => {
    const portal = portalOf({
        companies: [company("1"), company("2")],
        contacts: [
            // A first touch, a bump, their reply, then two answers inside the conversation.
            contact("a", "1",
                [touch("2026-09-29T15:00:00Z"), touch("2026-10-06T15:00:00Z", { opens: 2 }), touch("2026-10-07T15:00:00Z", { opens: 9 }), touch("2026-10-08T15:00:00Z", { opens: 9 })],
                [reply("2026-10-06T20:00:00Z")]),
            // They wrote first: nothing Forni sent this company was outreach.
            contact("b", "2", [touch("2026-10-06T15:00:00Z", { opens: 4 })], [reply("2026-10-01T20:00:00Z")]),
        ],
    });
    assert.deepEqual(outreachSends(portal).map((s) => `${s.company}|${s.day}`), ["1|2026-09-29", "1|2026-10-06"]);
    const week = healthOf(portal, "2026-10-05", ms("2026-10-09T18:00:00Z")).weeks.at(-1);
    assert.deepEqual([week.tracked, week.opened, week.responded], [1, 1, 1], "the two answers and their eighteen opens are not in the week");
});

test("one reply is credited to exactly one send, the latest outreach send before it", () => {
    const portal = portalOf({
        companies: [company("1"), company("2"), company("3")],
        contacts: [
            // A first touch and its bump on one thread, then the reply: the bump drew it.
            contact("a", "1", [touch("2026-09-29T15:00:00Z", { thread: "t1" }), touch("2026-10-06T15:00:00Z", { thread: "t1" })], [reply("2026-10-06T20:00:00Z", { thread: "t1" })]),
            // The bump went out on a fresh thread and they answered the first touch's.
            contact("b", "2", [touch("2026-09-29T15:00:00Z", { thread: "t2" }), touch("2026-10-06T15:00:00Z", { thread: "t3" })], [reply("2026-10-07T20:00:00Z", { thread: "t2" })]),
            // No thread ids on the record at all: the latest send before the reply.
            contact("c", "3", [touch("2026-09-29T15:00:00Z"), touch("2026-10-06T15:00:00Z")], [reply("2026-10-07T15:00:00Z")]),
        ],
    });
    const responded = Object.fromEntries(outreachSends(portal).map((s) => [`${s.company}|${s.day}`, s.responded]));
    assert.deepEqual(responded, {
        "1|2026-09-29": false, "1|2026-10-06": true,
        "2|2026-09-29": true, "2|2026-10-06": false,
        "3|2026-09-29": false, "3|2026-10-06": true,
    });
    // A past week does not change after the fact: W40 holds no response for company 1.
    const weeks = healthOf(portal, "2026-10-05", ms("2026-10-09T18:00:00Z")).weeks;
    assert.deepEqual(weeks.slice(-2).map((w) => w.responded), [1, 2]);
});

test("a reply on a thread no outreach send is on credits nothing", () => {
    const portal = portalOf({
        companies: [company("1")],
        contacts: [contact("a", "1", [touch("2026-10-06T15:00:00Z", { thread: "t1" })], [reply("2026-10-06T20:00:00Z", { thread: "t9" })])],
    });
    assert.deepEqual(outreachSends(portal).map((s) => s.responded), [false]);
});

test("a send to a company already at Opportunity or Customer is not outreach", () => {
    const portal = portalOf({
        companies: [
            company("1", { lifecyclestage: "opportunity", hs_v2_date_entered_opportunity: "2026-10-06T00:00:00Z" }),
            company("2", { lifecyclestage: "customer" }),
        ],
        contacts: [
            contact("a", "1", [touch("2026-10-05T18:00:00Z"), touch("2026-10-07T18:00:00Z")]),
            contact("b", "2", [touch("2026-10-05T18:00:00Z")]),
        ],
    });
    assert.deepEqual(outreachSends(portal).map((s) => `${s.company}|${s.day}`), ["1|2026-10-05"]);
});

/* ---------- the flag ---------- */

/** Four weeks of sends, each `[tracked, opened]`, the last one the week before the run's. */
function weeksPortal(counts) {
    const companies = [];
    const contacts = [];
    counts.forEach(([tracked, opened], w) => {
        const day = new Date(ms("2026-09-08T18:00:00Z") + w * 7 * 86400000).toISOString();
        for (let i = 0; i < tracked; i += 1) {
            const id = `${w}-${i}`;
            companies.push(company(id));
            contacts.push(contact(id, id, [touch(day, { opens: i < opened ? 1 : 0 })]));
        }
    });
    return portalOf({ companies, contacts });
}

test("the flag speaks at the threshold and stays quiet a point short of it", () => {
    const now = ms("2026-10-06T04:00:00Z");
    // Three weeks at 60%, then a complete week of ten tracked sends.
    const prior = [[10, 6], [10, 6], [10, 6]];
    const at = 60 - FLAG_DROP;
    const dropped = healthOf(weeksPortal([...prior, [20, (20 * at) / 100]]), "2026-10-05", now);
    assert.match(dropped.flag, /^W40 opened at 45% on 20 tracked sends, 15 below the 60% of the three weeks before it\.$/);
    const held = healthOf(weeksPortal([...prior, [50, 23]]), "2026-10-05", now);
    assert.equal(held.weeks.at(-2).rate, 46);
    assert.equal(held.flag, null, "fourteen below is not a flag");
});

test("the flag needs enough tracked sends to mean anything", () => {
    const now = ms("2026-10-06T04:00:00Z");
    const thin = healthOf(weeksPortal([[10, 6], [10, 6], [10, 6], [FLAG_MIN_TRACKED - 1, 0]]), "2026-10-05", now);
    assert.equal(thin.flag, null);
    const enough = healthOf(weeksPortal([[10, 6], [10, 6], [10, 6], [FLAG_MIN_TRACKED, 0]]), "2026-10-05", now);
    assert.ok(enough.flag);
});

test("the weeks before are pooled, so a week of one or two sends cannot swing the flag", () => {
    const now = ms("2026-10-06T04:00:00Z");
    // Two thin weeks at 100% and a real one at 50%: a mean of the three rates
    // would say 83% and flag a week at 70%; pooled they opened 12 of 22, 55%.
    const thin = [[1, 1], [1, 1], [20, 10]];
    assert.equal(healthOf(weeksPortal([...thin, [20, 14]]), "2026-10-05", now).flag, null);
    assert.match(healthOf(weeksPortal([...thin, [20, 8]]), "2026-10-05", now).flag, /15 below the 55% of the three weeks before it/);
    // And three weeks that together hold too few sends are nothing to compare with.
    assert.equal(healthOf(weeksPortal([[3, 3], [3, 3], [3, 3], [20, 0]]), "2026-10-05", now).flag, null);
});

test("on a Monday run the week judged is the one that just ended, never the one still running", () => {
    // The current week reads 0% on ten sends an hour old; the complete week before it held.
    const portal = weeksPortal([[10, 6], [10, 6], [10, 6], [10, 6], [10, 0]]);
    assert.equal(healthOf(portal, "2026-10-05", ms("2026-10-06T04:00:00Z")).flag, null);
    assert.ok(healthOf(portal, "2026-10-05", ms("2026-10-13T04:00:00Z")).flag, "a replay after the Sunday judges it");
});

/* ---------- the named lines ---------- */

const row = (id, extra = {}) => ({ id, name: `Company ${id}`, url: url(id), next: "", task: null, deal: null, ...extra });
const tier = (needs, key) => needs.tiers.find((t) => t.key === key).lines;

test("proposals are every open deal, the larger first and then the sooner due", () => {
    const portal = portalOf({
        companies: [company("1"), company("2"), company("3"), company("4", { disqualification_reason: "NO_BUDGET" })],
        stages: {
            opportunity: [
                row("1", { task: { due: "2026-10-20", reading: "parked", subject: "Reach back out to Odette" } }),
                row("2", { task: { due: "2026-10-12", reading: "parked", subject: "Swing by" } }),
                row("3"),
            ],
        },
        deals: [
            { id: "d1", stage: "Proposal", amount: 1750, closed: false, won: false, companies: ["1"] },
            { id: "d2", stage: "Proposal", amount: 1750, closed: false, won: false, companies: ["2"] },
            { id: "d3", stage: "Scoping", amount: 10000, closed: false, won: false, companies: ["3"] },
            { id: "d4", stage: "Closed Lost", amount: 90000, closed: true, won: false, companies: ["3"] },
            { id: "d5", stage: "Proposal", amount: 50000, closed: false, won: false, companies: ["4"] },
        ],
    });
    assert.deepEqual(tier(needsOf(portal, []).needs, "proposal"), [
        { who: "Company 3", amount: 10000, owed: "Scoping", due: "", url: url("3") },
        { who: "Company 2", amount: 1750, owed: "Swing by", due: "2026-10-12", url: url("2") },
        { who: "Company 1", amount: 1750, owed: "Reach back out to Odette", due: "2026-10-20", url: url("1") },
    ]);
});

test("a company with two deals open gets a line for each, told apart by the deal's name", () => {
    const portal = portalOf({
        companies: [company("1")],
        stages: { opportunity: [row("1", { task: { due: "2026-10-12", reading: "due", subject: "Walk the proposal" } })] },
        deals: [
            { id: "d1", name: "Site rebuild", stage: "Proposal", amount: 8000, closed: false, won: false, companies: ["1"] },
            { id: "d2", name: "Monthly care", stage: "Proposal", amount: 600, closed: false, won: false, companies: ["1"] },
        ],
    });
    assert.deepEqual(tier(needsOf(portal, []).needs, "proposal").map((l) => [l.amount, l.owed]), [
        [8000, "Site rebuild: Walk the proposal"],
        [600, "Monthly care: Walk the proposal"],
    ]);
});

test("a warm SQL is listed when something is owed this week, and a parked or waiting one is not", () => {
    const portal = portalOf({
        companies: ["1", "2", "3", "4"].map((id) => company(id)),
        stages: {
            sql: [
                row("1", { next: "wait" }),
                row("2", { next: "parked", task: { due: "2026-11-09", reading: "parked", subject: "Reach back out" } }),
                row("3", { next: "reply" }),
                row("4", { next: "wait", task: { due: "2026-10-08", reading: "due", subject: "Talk with Jonah in person" } }),
            ],
        },
    });
    assert.deepEqual(tier(needsOf(portal, []).needs, "warm_sql").map((l) => [l.who, l.owed, l.due]), [
        ["Company 4", "Talk with Jonah in person", "2026-10-08"],
        ["Company 3", "reply owed; theirs is the last message on the record", ""],
    ]);
});

const customers = () => portalOf({
    companies: [
        company("1", { lifecyclestage: "customer", linear_project: "Westbrook", contacts: ["a"] }),
        company("2", { lifecyclestage: "customer", linear_project: "thistle lane " }),
        company("3", { lifecyclestage: "customer", linear_project: "Alder" }),
        company("4", { lifecyclestage: "customer", contacts: ["d"] }),
    ],
    stages: { customer: [row("1"), row("2"), row("3"), row("4")] },
    deals: [
        { id: "d1", amount: 7500, closed: true, won: true, close: "2026-08-20", engagement_phase: "", companies: ["1"] },
        { id: "d2", amount: 0, closed: true, won: true, close: "2026-09-01", engagement_phase: "build", companies: ["2"] },
        { id: "d3", amount: 9000, closed: true, won: true, close: "2026-09-17", engagement_phase: "operate", companies: ["3"] },
        { id: "d4", amount: 500, closed: true, won: true, close: "2026-09-20", engagement_phase: "", companies: ["4"] },
    ],
    tasks: [
        { id: "t1", subject: "Send the access list", due: "2026-10-09", reading: "due", companies: ["1"], contacts: [] },
        { id: "t2", subject: "Renewal check in", due: "2026-12-01", reading: "parked", companies: ["1"], contacts: [] },
        { id: "t3", subject: "Confirm the launch date", due: "2026-10-06", reading: "due", companies: [], contacts: ["d"] },
    ],
});
const issue = (identifier, project, title, extra = {}) => ({ identifier, project, title, url: `https://tracker.example.test/${identifier}`, priority: 0, dueDate: "", ...extra });

test("a customer's lines are its Linear project's issues, sorted by due date and then priority, in the tier its deals put it", () => {
    const linear = [
        issue("EXA-3", "Westbrook", "Westbrook: no date, low", { priority: 4 }),
        issue("EXA-2", "Westbrook", "W41: audit the tag container", { dueDate: "2026-10-08" }),
        issue("EXA-1", "Westbrook", "[2026-W41] Westbrook - no date, urgent", { priority: 1 }),
        issue("EXA-4", "Thistle Lane", "Countersign", { dueDate: "2026-10-13" }),
        issue("EXA-5", "Alder", "Monthly page", { dueDate: "2026-10-10" }),
        issue("EXA-9", "Internal", "Not a customer's"),
    ];
    const { needs, unmapped } = needsOf(customers(), linear);
    assert.deepEqual(tier(needs, "paying_build").map((l) => [l.ref, l.owed, l.due]), [
        ["EXA-2", "audit the tag container", "2026-10-08"],
        ["EXA-1", "no date, urgent", ""],
        ["EXA-3", "no date, low", ""],
        // Company 4 names no project, so its open HubSpot task stands in, with no ticket.
        [undefined, "Confirm the launch date", "2026-10-06"],
    ].sort((a, b) => (a[2] || "9999").localeCompare(b[2] || "9999")));
    assert.deepEqual(tier(needs, "trade_build").map((l) => l.ref), ["EXA-4"]);
    assert.deepEqual(tier(needs, "operate").map((l) => l.ref), ["EXA-5"]);
    assert.deepEqual(tier(needs, "paying_build")[1], {
        who: "Company 1", owed: "audit the tag container", due: "2026-10-08", url: url("1"),
        ref: "EXA-2", ref_url: "https://tracker.example.test/EXA-2",
    });
    assert.deepEqual(unmapped, ["Company 4"]);
    assert.equal(needs.first_touch_target, FIRST_TOUCH_TARGET);
});

test("without Linear the customer lines are the open HubSpot tasks, and the mail is told", () => {
    const draft = { flags: [{ lead: "An older flag." }], owed: {} };
    const out = fold(draft, customers(), { monday: "2026-10-05", nowMs: ms("2026-10-06T04:00:00Z"), linear: null, linearError: "no LINEAR_API_KEY in the environment" });
    assert.deepEqual(tier(out.needs, "paying_build").map((l) => [l.who, l.owed, l.due, l.ref]), [
        ["Company 4", "Confirm the launch date", "2026-10-06", undefined],
        ["Company 1", "Send the access list", "2026-10-09", undefined],
    ]);
    assert.deepEqual(out.flags.map((f) => f.lead), [
        "The Linear read did not run (no LINEAR_API_KEY in the environment), so the customer lines are open HubSpot tasks.",
        "An older flag.",
    ]);
    const mapped = fold(draft, customers(), { monday: "2026-10-05", nowMs: ms("2026-10-06T04:00:00Z"), linear: [] });
    assert.equal(mapped.flags[0].lead, "No linear_project on Company 4, so its lines are open HubSpot tasks.");
});

test("a title loses its week tag and its customer's name, and nothing else", () => {
    assert.equal(trimTitle("W41: SkySpec: audit GA4", ["SkySpec"]), "audit GA4");
    assert.equal(trimTitle("SkySpec - [W41] follow ups", ["SkySpec"]), "follow ups");
    assert.equal(trimTitle("Skylight photos for the writeup", ["SkySpec"]), "Skylight photos for the writeup");
    assert.equal(trimTitle("SkySpec:", ["SkySpec"]), "SkySpec:", "a title that is only the prefix stays whole");
    assert.equal(trimTitle("2026-W41 audit GA4", []), "audit GA4");
});

test("a title that merely starts with a W and a digit is not a week tag", () => {
    assert.equal(trimTitle("W3C validation fixes", ["SkySpec"]), "W3C validation fixes");
    assert.equal(trimTitle("W9 for the bookkeeper", ["SkySpec"]), "W9 for the bookkeeper");
    assert.equal(trimTitle("w41 audit", []), "w41 audit", "the tag is a capital W");
    assert.equal(trimTitle("W41", []), "W41", "a tag with nothing after it is the title");
});

/* ---------- nobody twice ---------- */

const person = (who, id, contactId, extra = {}) => ({ person: who, company: `Company ${id}`, contact_url: `https://app.example.test/record/0-1/${contactId}`, company_url: url(id), ...extra });
const twoTiers = () => [
    { key: "proposal", lines: [{ who: "Company 1", owed: "Walk the proposal", due: "2026-10-12", url: url("1") }] },
    { key: "warm_sql", lines: [{ who: "Company 3", owed: "second touch due", due: "", url: url("3") }] },
];

test("a reply owed on a company with a named line folds into that line and is not lost", () => {
    const owed = { reply: [person("Ana", "1", "a", { note: "asked whether the price holds through November" }), person("Bo", "2", "b", { note: "wants a call" })] };
    const tiers = twoTiers();
    const out = settleOwed(owed, tiers);
    assert.deepEqual(out.owed.reply.map((n) => n.person), ["Bo"], "Ana's reply is on the proposal's line now");
    assert.deepEqual(out.tiers[0].lines[0], { who: "Company 1", owed: "reply owed to Ana: asked whether the price holds through November", due: "2026-10-12", url: url("1") });
    assert.equal(tiers[0].lines[0].owed, "Walk the proposal", "the tiers handed in are not changed");
});

test("second touches and first touches are never removed, since their drafts fire either way", () => {
    const owed = {
        reply: [person("Bo", "2", "b")],
        bump: [person("Bo", "2", "b"), person("Cy", "3", "c"), person("Ana", "1", "a")],
        first_touch: [person("Dee", "3", "d"), person("Eli", "5", "e")],
        visit: [person("Bea", "2", "b2"), person("Cy", "3", "c"), person("Flo", "6", "f"), { person: "Di", company: "company 1", contact_url: null, company_url: null }],
        decide: null,
    };
    const out = settleOwed(owed, twoTiers()).owed;
    assert.deepEqual(out.bump.map((n) => n.person), ["Bo", "Cy", "Ana"]);
    assert.deepEqual(out.first_touch.map((n) => n.person), ["Dee", "Eli"]);
    assert.deepEqual(out.visit.map((n) => n.person), ["Flo"], "a visit on a named company, or at a company owed a reply, is worked on that line");
    assert.deepEqual(out.decide, []);
});

/* ---------- the Linear read ---------- */

const answer = (body, status = 200) => ({ ok: status === 200, status, text: async () => JSON.stringify(body) });

test("the Linear read pages through the active cycle and sends the key bare", async () => {
    const calls = [];
    const pages = [
        { data: { issues: { nodes: [{ identifier: "EXA-1", title: "One", url: "u1", priority: 2, dueDate: "2026-10-08", project: { name: "Westbrook" } }], pageInfo: { hasNextPage: true, endCursor: "c1" } } } },
        { data: { issues: { nodes: [{ identifier: "EXA-2", title: "Two", url: "u2", priority: null, dueDate: null, project: null }], pageInfo: { hasNextPage: false } } } },
    ];
    const issues = await activeCycleIssues({ key: "lin_test", fetchImpl: async (endpoint, init) => { calls.push(init); return answer(pages[calls.length - 1]); } });
    assert.deepEqual(issues, [
        { identifier: "EXA-1", title: "One", url: "u1", priority: 2, dueDate: "2026-10-08", project: "Westbrook" },
        { identifier: "EXA-2", title: "Two", url: "u2", priority: 0, dueDate: "", project: "" },
    ]);
    assert.equal(calls[0].headers.Authorization, "lin_test");
    assert.equal(JSON.parse(calls[1].body).variables.after, "c1");
    assert.match(JSON.parse(calls[0].body).query, /isActive: \{ eq: true \}/);
});

test("a failed Linear read never carries the response body, which travels into the mail", async () => {
    const echo = { ok: false, status: 401, text: async () => JSON.stringify({ error: "invalid key lin_api_SECRETSECRET" }) };
    await assert.rejects(activeCycleIssues({ key: "lin_api_SECRETSECRET", fetchImpl: async () => echo }), (error) => !/SECRET/.test(error.message));
});

test("the Linear read fails loudly on a missing key, a bad status, and an error that arrives as a 200", async () => {
    await assert.rejects(activeCycleIssues({ key: "" }), /no LINEAR_API_KEY/);
    await assert.rejects(activeCycleIssues({ key: "k", fetchImpl: async () => answer({ message: "nope" }, 401) }), /^Error: Linear answered 401$/);
    await assert.rejects(activeCycleIssues({ key: "k", fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<html>gateway</html>" }) }), /not JSON/);
    await assert.rejects(activeCycleIssues({ key: "k", fetchImpl: async () => answer({ errors: [{ message: "Query too complex" }] }) }), /Query too complex/);
});
