// The shaping behind the inbox, Linear and Todoist pulls, on invented records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NEVER_ARCHIVE, addressOf, addressesFromEnv, shapeMessage } from "../inbox.mjs";

test("the address inside a From header comes out bare and lowercased", () => {
    assert.equal(addressOf("Blue Spruce Maids <Info@BlueSpruceMaids.com>"), "info@bluesprucemaids.com");
    assert.equal(addressOf("someone@example.com"), "someone@example.com");
});

test("unemployment insurance mail is never archived by the runner", () => {
    assert.equal(NEVER_ARCHIVE.test("cdle_ui-alerts@state.co.us Your claim"), true);
    assert.equal(NEVER_ARCHIVE.test("MyUI+ <noreply@example.com> Questionnaire"), true);
    assert.equal(NEVER_ARCHIVE.test("Claude <claude@atelic.me> 2026-W43 Recruiter"), true);
    assert.equal(NEVER_ARCHIVE.test("Blue Spruce Maids <info@bluesprucemaids.com> Cleaning"), false);
});

test("a Drive share notice is never archived by the runner", () => {
    assert.equal(NEVER_ARCHIVE.test('Pat Example (via Google Drive) <drive-shares-dm-noreply@google.com> Pat Example shared a folder with you'), true);
    assert.equal(NEVER_ARCHIVE.test("Google Drive <drive-shares-noreply@google.com> Invented Plans"), true);
    assert.equal(NEVER_ARCHIVE.test('someone@example.com Document shared with you: "Invented Notes"'), true);
    assert.equal(NEVER_ARCHIVE.test("Google <no-reply@accounts.google.com> Security alert"), false);
});
import { shapeIssue } from "../linear.mjs";
import { completed, completedRow, filterDate, priorityWord, scheduleFilter, shapeTask } from "../todoist.mjs";

/*
 * The completed count reads the activity log, because the completed tasks
 * listing never holds a checked off occurrence of a recurring task (W47:
 * the listing said 3 for a week the log put at 23). Invented events, in the
 * log's own snake case shape, newest first.
 */
const completion = (id, at, content, recurring) => ({
    object_type: "item", object_id: id, event_type: "completed", event_date: at, parent_project_id: "p1",
    extra_data: { content, labels: ["🧠 Sharp"], priority: 4, is_recurring: recurring },
});

test("a completion event becomes a completed row, and one outside the window does not", () => {
    const projects = new Map([["p1", "🧘 Contemplation"]]);
    const since = Date.parse("2026-11-09T00:00:00-07:00");
    const until = Date.parse("2026-11-16T00:00:00-07:00");
    const row = completedRow(completion("t1", "2026-11-12T13:39:19.870000Z", "🧘 Invented Practice", true), since, until, projects);
    assert.deepEqual(row, {
        id: "t1", content: "🧘 Invented Practice", project: "🧘 Contemplation", labels: ["🧠 Sharp"],
        priority: "p1", completedAt: "2026-11-12T13:39:19.870000Z", recurring: true,
    });
    assert.equal(completedRow(completion("t2", "2026-11-16T07:00:00Z", "the next week", false), since, until, projects), null, "Monday midnight Denver is the next week");
    assert.equal(completedRow(completion("t3", "2026-11-09T06:59:59Z", "the week before", false), since, until, projects), null, "and Sunday night before it is the last one");
});

test("the completed walk pages the log back to the window's start and counts every check off", async () => {
    const pages = [
        { results: [
            completion("late", "2026-11-16T15:00:00Z", "after the window", true),
            completion("r1", "2026-11-15T20:09:38Z", "🧘 Invented Recurring", true),
            completion("r1", "2026-11-14T05:45:25Z", "🧘 Invented Recurring", true),
        ], next_cursor: "c2" },
        { results: [
            completion("o1", "2026-11-11T15:36:58Z", "🔑 Invented One Off", false),
            completion("early", "2026-11-08T22:00:00Z", "before the window", false),
        ], next_cursor: "c3" },
        { results: [completion("never", "2026-11-01T12:00:00Z", "a page that must not be read", false)], next_cursor: null },
    ];
    const asked = [];
    const realFetch = globalThis.fetch;
    const realToken = process.env.TODOIST_API_TOKEN;
    process.env.TODOIST_API_TOKEN = "invented";
    globalThis.fetch = async (url) => {
        const u = new URL(url);
        asked.push(u);
        const page = pages[asked.length - 1];
        return { ok: true, json: async () => page };
    };
    try {
        const rows = await completed("2026-11-16", new Map());
        assert.deepEqual(rows.map((r) => r.id), ["r1", "r1", "o1"], "a recurring task checked off twice is two rows");
        assert.equal(asked.length, 2, "the walk stops once a page reaches past the window's start");
        assert.equal(asked[0].pathname, "/api/v1/activities");
        assert.equal(asked[0].searchParams.get("object_event_types"), '["item:completed"]');
        assert.equal(asked[0].searchParams.has("date_from"), false, "never a date_from, which the plan's history can refuse");
        assert.equal(asked[1].searchParams.get("cursor"), "c2");
    } finally {
        globalThis.fetch = realFetch;
        if (realToken === undefined) delete process.env.TODOIST_API_TOKEN; else process.env.TODOIST_API_TOKEN = realToken;
    }
});

test("the Schedule filter's relative bound becomes the named Monday", () => {
    assert.match(scheduleFilter("2026-10-26"), /due before: 10\/26\/2026$/);
    assert.match(scheduleFilter(undefined), /due before: next monday$/);
});

test("a message keeps its headers, its user labels by name, and a link that opens in the right account", () => {
    const names = new Map([["Label_1", "📑 Admin"], ["Label_2", "🍏 Constitution/🧖 Personal Care"]]);
    const msg = {
        id: "m1", threadId: "t1", internalDate: "1760900000000", snippet: "Your cleaning is Thursday",
        labelIds: ["INBOX", "UNREAD", "CATEGORY_UPDATES", "Label_2", "YELLOW_STAR"],
        payload: { headers: [{ name: "From", value: "Blue Spruce Maids <info@bluesprucemaids.com>" }, { name: "Subject", value: "Cleaning reminder" }, { name: "Date", value: "Sat, 18 Oct 2026 09:00:00 -0600" }] },
    };
    const m = shapeMessage(msg, names, "someone@example.com");
    assert.equal(m.from, "Blue Spruce Maids <info@bluesprucemaids.com>");
    assert.equal(m.subject, "Cleaning reminder");
    assert.deepEqual(m.labels, ["🍏 Constitution/🧖 Personal Care"]);
    assert.equal(m.unread, true);
    assert.equal(m.starred, true);
    assert.deepEqual(m.stars, ["YELLOW_STAR"]);
    assert.equal(m.link, "https://mail.google.com/mail/?authuser=someone%40example.com#inbox/m1");
});

test("MAILBOX_ADDRESSES parses name=address pairs", () => {
    assert.deepEqual(addressesFromEnv("personal=a@b.c, atelic=d@e.f"), { personal: "a@b.c", atelic: "d@e.f" });
});

test("an issue carries its load label apart and a trimmed description", () => {
    const issue = shapeIssue({
        identifier: "ATE-674", title: "Brief runner", url: "https://linear.app/atelic/issue/ATE-674", priority: 2, estimate: 16,
        dueDate: null, description: "line one\n\nline two  ".padEnd(400, "x"), updatedAt: "u", createdAt: "c",
        state: { name: "In Progress", type: "started" }, labels: { nodes: [{ name: "🧠 Sharp" }, { name: "Runner" }] },
        project: { name: "Practice" }, cycle: { number: 12 }, assignee: { name: "Forni" },
    });
    assert.equal(issue.load, "🧠 Sharp");
    assert.deepEqual(issue.labels, ["🧠 Sharp", "Runner"]);
    assert.equal(issue.stateType, "started");
    assert.equal(issue.description.length, 300);
    assert.equal(issue.description.includes("\n"), false);
});

test("Todoist priorities read as Forni reads them, and a filter date is US order", () => {
    assert.equal(priorityWord(4), "p1");
    assert.equal(priorityWord(1), "p4");
    assert.equal(filterDate("2026-10-20"), "10/20/2026");
});

test("a task carries its project and section names and its due date", () => {
    const projects = new Map([["p1", "🛠️ Craft"]]);
    const sections = new Map([["s1", "💼 Vocation"]]);
    const task = shapeTask({
        id: "t1", content: "📧 Reply to Ambrook", project_id: "p1", section_id: "s1", labels: ["⏰ Scheduled"], priority: 3,
        due: { date: "2026-10-20", string: "Oct 20", is_recurring: false }, duration: { amount: 30, unit: "minute" },
    }, projects, sections);
    assert.equal(task.project, "🛠️ Craft");
    assert.equal(task.section, "💼 Vocation");
    assert.equal(task.priority, "p2");
    assert.equal(task.due, "2026-10-20");
    assert.equal(task.duration, "30 minute");
    assert.equal(task.url, "https://app.todoist.com/app/task/t1");
});
