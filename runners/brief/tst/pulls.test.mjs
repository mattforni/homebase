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
import { shapeIssue } from "../linear.mjs";
import { filterDate, priorityWord, scheduleFilter, shapeTask } from "../todoist.mjs";

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
