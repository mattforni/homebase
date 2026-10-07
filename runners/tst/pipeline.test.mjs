import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeCycleIssues, LinearError } from "../lib/linear.mjs";
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
    NEW_RUN_DAYS,
} from "../lib/pipeline.mjs";

/*
 * The gate on what the Pipeline mail says needs Forni and how the funnel is
 * doing (ATE-630). Every portal here is invented and small: the names, the
 * ids and the urls are made up, because this repository is public and the
 * portal is not. Each test names the one rule it holds, since these are the
 * joins a wrong answer would otherwise deliver to Monday's inbox as fact.
 *
 *   node --test runners/tst/pipeline.test.mjs
 *
 * These live beside runners/lib and not inside it: that directory is copied
 * flat into every runner's image, and a directory in it breaks the copy.
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

test("a send long after their last message starts a new run of outreach, and a reply ends only the run it answers", () => {
    const day = (n) => new Date(ms("2026-06-01T15:00:00Z") + n * 86400000).toISOString();
    const portal = portalOf({
        companies: [company("1"), company("2")],
        contacts: [
            // A first touch, their reply, an answer the next day, then silence.
            // A fresh first touch a day past the window, a bump, and a reply to that.
            contact("a", "1",
                [touch(day(0)), touch(day(3)), touch(day(2 + NEW_RUN_DAYS + 1), { opens: 1 }), touch(day(2 + NEW_RUN_DAYS + 8)), touch(day(2 + NEW_RUN_DAYS + 10))],
                [reply(day(2)), reply(day(2 + NEW_RUN_DAYS + 9))]),
            // The same fresh send, a day inside the window: still the conversation.
            contact("b", "2", [touch(day(0)), touch(day(2 + NEW_RUN_DAYS - 1))], [reply(day(2))]),
        ],
    });
    const sends = outreachSends(portal).filter((s) => s.company === "1").sort((a, b) => a.day.localeCompare(b.day));
    assert.deepEqual(sends.map((s) => [s.day, s.opened, s.responded]), [
        [day(0).slice(0, 10), false, true],
        [day(2 + NEW_RUN_DAYS + 1).slice(0, 10), true, false],
        [day(2 + NEW_RUN_DAYS + 8).slice(0, 10), false, true],
    ], "the answer on day 3 and the one after the second reply are conversation; each reply credits its own run's last send");
    assert.deepEqual(outreachSends(portal).filter((s) => s.company === "2").map((s) => s.day), [day(0).slice(0, 10)]);
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

test("a real reply on a thread no send shares is still credited, to the latest outreach send before it", () => {
    const portal = portalOf({
        companies: [company("1")],
        contacts: [contact("a", "1", [touch("2026-10-06T15:00:00Z", { thread: "t1" })], [reply("2026-10-06T20:00:00Z", { thread: "t9" })])],
    });
    assert.deepEqual(outreachSends(portal).map((s) => s.responded), [true]);
    const two = portalOf({
        companies: [company("1")],
        contacts: [contact("a", "1", [touch("2026-09-29T15:00:00Z", { thread: "t1" }), touch("2026-10-06T15:00:00Z", { thread: "t2" })], [reply("2026-10-07T20:00:00Z", { thread: "t9" })])],
    });
    assert.deepEqual(outreachSends(two).map((s) => [s.day, s.responded]), [["2026-09-29", false], ["2026-10-06", true]]);
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

test("an open deal is exactly one line, whichever companies it sits on", () => {
    const portal = portalOf({
        companies: [company("1"), company("2")],
        stages: { opportunity: [row("1"), row("2")] },
        deals: [
            // One deal on two companies is one proposal, named by its first.
            { id: "d1", name: "Joint rebuild", stage: "Proposal", amount: 9000, closed: false, won: false, companies: ["1", "2"] },
            // A deal whose company is outside the funnel rows is still money on the table.
            { id: "d2", name: "Referral build", stage: "Scoping", amount: 4000, closed: false, won: false, companies: ["77"] },
            { id: "d3", name: "No company at all", stage: "Scoping", amount: 100, closed: false, won: false, companies: [] },
        ],
    });
    assert.deepEqual(tier(needsOf(portal, []).needs, "proposal").map((l) => [l.who, l.amount, l.owed, l.url]), [
        ["Company 1", 9000, "Proposal", url("1")],
        ["Referral build", 4000, "Scoping", null],
        ["No company at all", 100, "Scoping", null],
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
                row("4", { next: "wait", task: { due: "2026-10-08", reading: "due", subject: "Talk with Marta in person" } }),
            ],
        },
    });
    assert.deepEqual(tier(needsOf(portal, []).needs, "warm_sql").map((l) => [l.who, l.owed, l.due]), [
        ["Company 4", "Talk with Marta in person", "2026-10-08"],
        ["Company 3", "last message on the record is theirs, check the thread", ""],
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

test("a warm line says a reply is owed only when the model's owed.reply names the company", () => {
    const portal = portalOf({
        companies: [company("3"), company("5")],
        stages: { sql: [row("3", { next: "reply" }), row("5", { next: "reply" })] },
    });
    const draft = { flags: [], owed: { reply: [{ person: "Cy", company: "Company 3", contact_url: null, company_url: url("3"), note: "asked for a visit" }] } };
    const out = fold(draft, portal, { monday: "2026-10-05", nowMs: ms("2026-10-06T04:00:00Z"), linear: [] });
    assert.deepEqual(tier(out.needs, "warm_sql").map((l) => [l.who, l.owed]), [
        ["Company 3", "last message on the record is theirs, check the thread; reply owed to Cy: asked for a visit"],
        // The portal alone logged an inbound message here; the mailbox did not call it a reply owed.
        ["Company 5", "last message on the record is theirs, check the thread"],
    ]);
    assert.ok(!/reply owed/.test(tier(out.needs, "warm_sql")[1].owed));
});

test("a customer with a Linear project keeps its due HubSpot tasks, said once when a task repeats an issue", () => {
    const portal = portalOf({
        companies: [company("1", { lifecyclestage: "customer", linear_project: "Westbrook" })],
        stages: { customer: [row("1")] },
        deals: [{ id: "d1", amount: 7500, closed: true, won: true, close: "2026-08-20", engagement_phase: "", companies: ["1"] }],
        tasks: [
            { id: "t1", subject: "Call about the invoice", due: "2026-10-07", reading: "due", companies: ["1"], contacts: [] },
            { id: "t2", subject: "Audit the tag container", due: "2026-10-08", reading: "due", companies: ["1"], contacts: [] },
            { id: "t3", subject: "W41: audit the tag container", due: "2026-10-01", reading: "stale", companies: ["1"], contacts: [] },
            { id: "t6", subject: "Company 1: audit the tag container", due: "2026-10-02", reading: "stale", companies: ["1"], contacts: [] },
            { id: "t4", subject: "Someday, the renewal", due: "", reading: "undated", companies: ["1"], contacts: [] },
            { id: "t5", subject: "Renewal check in", due: "2026-12-01", reading: "parked", companies: ["1"], contacts: [] },
        ],
    });
    const linear = [issue("EXA-2", "Westbrook", "W41: audit the tag container", { dueDate: "2026-10-08" })];
    assert.deepEqual(tier(needsOf(portal, linear).needs, "paying_build").map((l) => [l.ref, l.owed, l.due]), [
        [undefined, "Call about the invoice", "2026-10-07"],
        ["EXA-2", "audit the tag container", "2026-10-08"],
    ], "the three tasks that repeat the issue's title, whole, bare, or under the customer's own prefix, are the issue; undated and parked tasks are not due");
});

test("a SQL whose only next step is a drafted touch gets no warm line, since the counts carry it", () => {
    const portal = portalOf({
        companies: ["1", "2", "3", "4", "5"].map((id) => company(id)),
        stages: {
            sql: [
                row("1", { next: "bump" }),
                row("2", { next: "first" }),
                row("3", { next: "visit" }),
                row("4", { next: "decide" }),
                row("5", { next: "bump", task: { due: "2026-10-08", reading: "due", subject: "Send the references" } }),
            ],
        },
    });
    assert.deepEqual(tier(needsOf(portal, []).needs, "warm_sql").map((l) => [l.who, l.owed]), [
        ["Company 5", "Send the references"],
        ["Company 3", "visit or call due"],
        ["Company 4", "close or keep, past the clock"],
    ]);
});

test("a Customer's open deal says where it stands, never its client task", () => {
    const task = { due: "2026-10-09", reading: "due", subject: "Send the monthly page" };
    const portal = portalOf({
        companies: [company("1", { lifecyclestage: "customer" }), company("2", { lifecyclestage: "opportunity" })],
        stages: { customer: [row("1", { task })], opportunity: [row("2", { task })] },
        deals: [
            { id: "d1", name: "Care plan", stage: "Proposal", amount: 600, closed: false, won: false, companies: ["1"] },
            { id: "d2", name: "Rebuild", stage: "Proposal", amount: 500, closed: false, won: false, companies: ["2"] },
        ],
    });
    assert.deepEqual(tier(needsOf(portal, []).needs, "proposal").map((l) => [l.who, l.owed, l.due]), [
        ["Company 1", "Proposal", ""],
        ["Company 2", "Send the monthly page", "2026-10-09"],
    ]);
});

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
        // Company 1 has a project and a task due this week: both are its lines. Its parked task is not.
        [undefined, "Send the access list", "2026-10-09"],
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
    assert.equal(trimTitle("W41: Westbrook: audit GA4", ["Westbrook"]), "audit GA4");
    assert.equal(trimTitle("Westbrook - [W41] follow ups", ["Westbrook"]), "follow ups");
    assert.equal(trimTitle("Skylight photos for the writeup", ["Westbrook"]), "Skylight photos for the writeup");
    assert.equal(trimTitle("Westbrook:", ["Westbrook"]), "Westbrook:", "a title that is only the prefix stays whole");
    assert.equal(trimTitle("2026-W41 audit GA4", []), "audit GA4");
});

test("a title that merely starts with a W and a digit is not a week tag", () => {
    assert.equal(trimTitle("W3C validation fixes", ["Westbrook"]), "W3C validation fixes");
    assert.equal(trimTitle("W9 for the bookkeeper", ["Westbrook"]), "W9 for the bookkeeper");
    assert.equal(trimTitle("w41 audit", []), "w41 audit", "the tag is a capital W");
    assert.equal(trimTitle("W41", []), "W41", "a tag with nothing after it is the title");
});

/* ---------- nobody twice ---------- */

const person = (who, id, contactId, extra = {}) => ({ person: who, company: `Company ${id}`, contact_url: `https://app.example.test/record/0-1/${contactId}`, company_url: url(id), ...extra });
const twoTiers = () => [
    { key: "proposal", lines: [{ who: "Company 1", owed: "Walk the proposal", due: "2026-10-12", url: url("1") }] },
    { key: "warm_sql", lines: [{ who: "Company 3", owed: "second touch due", due: "", url: url("3") }] },
];

test("a reply owed on a company with a named line is added to that line, which keeps its own words", () => {
    const owed = { reply: [
        person("Ana", "1", "a", { note: "asked whether the price holds through November" }),
        person("Bo", "2", "b", { note: "wants a call" }),
        person("Ada", "1", "a2", { note: "wants the second quote" }),
    ] };
    const tiers = [
        { key: "paying_build", lines: [
            { who: "Company 1", owed: "audit the tag container", due: "2026-10-08", url: url("1"), ref: "EXA-2", ref_url: "u" },
            { who: "Company 1", owed: "this week's follow ups", due: "", url: url("1"), ref: "EXA-3", ref_url: "u" },
        ] },
        { key: "proposal", lines: [{ who: "Company 1", owed: "Walk the proposal", due: "2026-10-12", url: url("1") }] },
    ];
    const out = settleOwed(owed, tiers);
    assert.deepEqual(out.owed.reply.map((n) => n.person), ["Bo"], "the two at Company 1 are on its line now");
    assert.equal(out.tiers[0].lines[0].owed,
        "audit the tag container; reply owed to Ana: asked whether the price holds through November; reply owed to Ada: wants the second quote",
        "the ticket's title is kept, both replies are joined, and they land on the company's first line");
    assert.equal(out.tiers[0].lines[0].ref, "EXA-2");
    assert.equal(out.tiers[0].lines[1].owed, "this week's follow ups");
    assert.equal(out.tiers[1].lines[0].owed, "Walk the proposal");
    assert.equal(tiers[0].lines[0].owed, "audit the tag container", "the tiers handed in are not changed");
});

test("two different records are never the same company, and a deal's name is never a company's", () => {
    const tiers = [
        { key: "warm_sql", lines: [{ who: "Marigold Dental", owed: "visit or call due", due: "", url: url("1") }] },
        { key: "paying_build", lines: [{ who: "Cedar Roofing", owed: "a task", due: "", url: null }] },
    ];
    const owed = {
        reply: [
            // The same name on another record: a second office, a duplicate, a namesake.
            { person: "Ida", company: "Marigold Dental", contact_url: null, company_url: url("9"), note: "wrong office" },
            // No url on the line, so the name decides.
            { person: "Odo", company: "cedar roofing", contact_url: null, company_url: url("2"), note: "asked for dates" },
        ],
    };
    const out = settleOwed(owed, tiers);
    assert.deepEqual(out.owed.reply.map((n) => n.person), ["Ida"]);
    assert.equal(out.tiers[0].lines[0].owed, "visit or call due");
    assert.equal(out.tiers[1].lines[0].owed, "a task; reply owed to Odo: asked for dates");

    // A proposal named for its deal, because its company is outside the funnel rows.
    const portal = portalOf({ deals: [{ id: "d1", name: "Harbor Lane", stage: "Scoping", amount: 4000, closed: false, won: false, companies: ["77"] }] });
    const draft = { flags: [], owed: { reply: [{ person: "Una", company: "Harbor Lane", contact_url: null, company_url: null, note: "a different Harbor Lane" }] } };
    const folded = fold(draft, portal, { monday: "2026-10-05", nowMs: ms("2026-10-06T04:00:00Z"), linear: [] });
    assert.deepEqual(folded.owed.reply.map((n) => n.person), ["Una"]);
    assert.equal(tier(folded.needs, "proposal")[0].owed, "Scoping");
    assert.deepEqual(Object.keys(tier(folded.needs, "proposal")[0]).sort(), ["amount", "due", "owed", "url", "who"], "and the line carries no field the renderer does not read");
});

test("a visit or a close at a company with a named line is added to the line, never dropped", () => {
    const owed = {
        reply: [person("Bo", "2", "b")],
        visit: [person("Bea", "2", "b2"), person("Cy", "3", "c"), person("Cal", "3", "c2"), person("Flo", "6", "f"), { person: "Di", company: "company 1", contact_url: null, company_url: null }],
        decide: [person("Ana", "1", "a"), person("Gus", "7", "g")],
    };
    const out = settleOwed(owed, twoTiers());
    assert.deepEqual(out.owed.visit.map((n) => n.person), ["Bea", "Flo"], "Bea's company has no named line, so she stays counted");
    assert.deepEqual(out.owed.decide.map((n) => n.person), ["Gus"]);
    assert.equal(out.tiers[0].lines[0].owed, "Walk the proposal; visit owed; close or keep", "Di matched on the name alone");
    assert.equal(out.tiers[1].lines[0].owed, "second touch due; visit owed", "two people at one company add the words once");
});

test("second touches and first touches are never removed, since their drafts fire either way", () => {
    const owed = {
        reply: [person("Bo", "2", "b")],
        bump: [person("Bo", "2", "b"), person("Cy", "3", "c"), person("Ana", "1", "a")],
        first_touch: [person("Dee", "3", "d"), person("Eli", "5", "e")],
        decide: null,
    };
    const out = settleOwed(owed, twoTiers());
    assert.deepEqual(out.owed.bump.map((n) => n.person), ["Bo", "Cy", "Ana"]);
    assert.deepEqual(out.owed.first_touch.map((n) => n.person), ["Dee", "Eli"]);
    assert.deepEqual(out.owed.decide, []);
    assert.deepEqual(out.tiers.map((t) => t.lines[0].owed), ["Walk the proposal", "second touch due"], "and they add nothing to a line");
});

/* ---------- the Linear read ---------- */

const answer = (body, status = 200) => ({ ok: status === 200, status, text: async () => JSON.stringify(body) });

test("the Linear read pages through the active cycle and sends the key bare", async () => {
    const calls = [];
    const pages = [
        { data: { issues: { nodes: [{ identifier: "EXA-1", title: "One", url: "u1", priority: 2, dueDate: "2026-10-08", project: { name: "Westbrook" } }], pageInfo: { hasNextPage: true, endCursor: "c1" } } } },
        { data: { issues: { nodes: [{ identifier: "EXA-2", title: "Two", url: "u2", priority: null, dueDate: null, project: null }], pageInfo: { hasNextPage: false } } } },
    ];
    const { issues, truncated } = await activeCycleIssues({ key: "lin_test", fetchImpl: async (endpoint, init) => { calls.push(init); return answer(pages[calls.length - 1]); } });
    assert.equal(truncated, false);
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
    await assert.rejects(activeCycleIssues({ key: "k", fetchImpl: async () => answer({ errors: [{ message: "Query too complex" }] }) }), /^Error: Linear refused the query$/);
});

test("no word of what Linear sends back can reach the mail, on any failure", async () => {
    const leak = "LEAK lin_api_SECRETSECRET";
    const failures = [
        { ok: false, status: 500, text: async () => leak },
        { ok: true, status: 200, text: async () => `<html>${leak}</html>` },
        answer({ errors: [{ message: leak }] }),
        answer({ data: { note: leak } }),
    ];
    for (const failure of failures) {
        await assert.rejects(activeCycleIssues({ key: "k", fetchImpl: async () => failure }), (error) => error instanceof LinearError && !/LEAK|SECRET/.test(error.message));
    }
    // The command line says a failure that is not this file's own as one fixed phrase.
    const run = spawnSync(process.execPath, [new URL("../lib/linear.mjs", import.meta.url).pathname, "issues"], { encoding: "utf8", env: { ...process.env, LINEAR_API_KEY: "" } });
    assert.equal(run.status, 1);
    assert.equal(run.stderr.trim(), "no LINEAR_API_KEY in the environment");
    assert.equal(run.stdout, "");
});

const oneCustomer = () => portalOf({
    companies: [company("1", { lifecyclestage: "customer", linear_project: "Westbrook" })],
    stages: { customer: [row("1")] },
});

test("a Linear read reused from an earlier pull is said under Left for You, and the saved file is read once", () => {
    const out = fold({ flags: [{ lead: "An older flag." }], owed: {} }, oneCustomer(), { monday: "2026-10-05", nowMs: ms("2026-10-06T04:00:00Z"), linear: [], linearReused: "written 2026-10-05" });
    assert.deepEqual(out.flags.map((f) => f.lead), ["The Linear read is from an earlier pull (written 2026-10-05), so the customer lines may be behind.", "An older flag."]);
    const nobody = fold({ flags: [], owed: {} }, portalOf({}), { monday: "2026-10-05", nowMs: ms("2026-10-06T04:00:00Z"), linear: [], linearReused: "written 2026-10-05" });
    assert.deepEqual(nobody.flags, [], "with no customer there is no line for the read's age to matter to");
    const fresh = fold({ flags: [], owed: {} }, portalOf({}), { monday: "2026-10-05", nowMs: ms("2026-10-06T04:00:00Z"), linear: [] });
    assert.deepEqual(fresh.flags, [], "a fresh read says nothing");

    // The command line, as the entrypoint calls it on a skip pulls run.
    const dir = mkdtempSync(join(tmpdir(), "pipeline-test-"));
    const write = (file, value) => { writeFileSync(join(dir, file), JSON.stringify(value)); return join(dir, file); };
    const run = spawnSync(process.execPath, [
        new URL("../lib/pipeline.mjs", import.meta.url).pathname, "fold",
        write("draft.json", { flags: [], owed: {} }), write("portal.json", oneCustomer()), "2026-10-05",
        write("linear.json", { issues: [], truncated: true }), "", "written 2026-10-05",
    ], { encoding: "utf8" });
    rmSync(dir, { recursive: true, force: true });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout).flags.map((f) => f.lead), [
        "The Linear read stopped at 0 issues, so a customer line may be missing.",
        "The Linear read is from an earlier pull (written 2026-10-05), so the customer lines may be behind.",
    ]);
});

test("a Linear read that stops at the page cap says so, and the mail is told", async () => {
    let n = 0;
    const page = () => { n += 1; return answer({ data: { issues: { nodes: [{ identifier: `EXA-${n}`, title: "t", url: "u" }], pageInfo: { hasNextPage: true, endCursor: `c${n}` } } } }); };
    const read = await activeCycleIssues({ key: "k", fetchImpl: async () => page() });
    assert.equal(read.truncated, true);
    assert.equal(read.issues.length, 5);
    const out = fold({ flags: [], owed: {} }, portalOf({}), { monday: "2026-10-05", nowMs: ms("2026-10-06T04:00:00Z"), linear: read.issues, linearTruncated: true });
    assert.equal(out.flags[0].lead, "The Linear read stopped at 5 issues, so a customer line may be missing.");
});
