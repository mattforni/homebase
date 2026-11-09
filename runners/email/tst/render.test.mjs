import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalize, firstDifference } from "../parity.mjs";
import { spawnSync } from "node:child_process";
import { bundlePath, CASES, FORMATS, fixturePath, goldenPath, render, renderRaw } from "./fixtures.mjs";

/*
 * The gate on the renderer. Every fixture renders through its runner's built
 * bundle and has to come back byte for byte what the frozen golden says, html and text
 * alike, so a padding, a column width or a conditional that moves is a failed
 * build rather than a surprise in Monday's inbox.
 *
 * The fixtures are invented: the names, the numbers and the urls are all made
 * up, because this repository is public and the drafts the runners actually
 * produce are not.
 */

for (const { runner, fixture } of CASES) {
	for (const format of FORMATS) {
		test(`${fixture} renders the frozen ${format}`, () => {
			const result = render(runner, format, fixture);
			assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
			assert.equal(result.stderr, "");
			assert.equal(result.stdout, readFileSync(goldenPath(fixture, format), "utf8"));
		});
	}

	test(`${fixture} ends its html in exactly one newline`, () => {
		const out = render(runner, "html", fixture).stdout;
		assert.ok(out.endsWith("</html>\n"), "the page ends on the document and one newline");
	});
}

/*
 * The width gate on the recruiter's text twin. The goldens only prove the text
 * has not moved; they cannot say it was right to begin with, and the first
 * recruiter twin was not: fixtures full of short invented strings froze a
 * layout that ran to 172 columns on a real draft and butted a long company
 * name straight into its reason. So the fixtures now carry long values, and
 * this holds every line to the 68 columns prose wraps at. The one excuse is a
 * line whose overflow is a single unbreakable last token (a url): take that
 * token away and the rest has to fit. The brief is exempt on purpose: its twin
 * is a byte for byte port of the jq one, wide session tables included.
 */
const TEXT_WIDTH = 68;
const columns = (line) => [...line].length;
const withoutLastToken = (line) => line.replace(/\S+$/, "");

for (const { runner, fixture } of CASES) {
	if (runner === "brief") continue;
	test(`${fixture} keeps its text inside ${TEXT_WIDTH} columns`, () => {
		const lines = render(runner, "text", fixture).stdout.split("\n");
		const wide = lines.filter(
			(line) => columns(line) > TEXT_WIDTH && columns(withoutLastToken(line)) > TEXT_WIDTH,
		);
		assert.deepEqual(wide, [], "lines past the wrap width for a reason other than one long token");
	});

	test(`${fixture} leaves no trailing whitespace in its text`, () => {
		const lines = render(runner, "text", fixture).stdout.split("\n");
		assert.deepEqual(
			lines.filter((line) => /\s$/.test(line)),
			[],
		);
	});
}

test("a long company name never runs into its reason", () => {
	const out = render("recruiter", "text", "recruiter").stdout;
	const draft = JSON.parse(readFileSync(new URL("../fixtures/recruiter.json", import.meta.url), "utf8"));
	const long = draft.rejected.find((row) => [...row.company].length >= 28);
	assert.ok(long, "the fixture carries a rejected company of 28 characters or more");
	const lines = out.split("\n");
	const lastCompanyWord = long.company.split(" ").at(-1);
	const firstReasonWords = long.reason.split(" ").slice(0, 3).join(" ");
	const reasonAt = lines.findIndex((line) => line === `  ${firstReasonWords}` || line.startsWith(`  ${firstReasonWords} `));
	assert.ok(reasonAt > 0, "the reason opens a line of its own");
	assert.ok(lines[reasonAt - 1].endsWith(lastCompanyWord), "and the company ends the line above it");
	assert.ok(!lines[reasonAt].includes(lastCompanyWord), "with none of the company on the reason's line");
});

test("an unknown runner fails loudly", () => {
	const result = render("nosuchrunner", "html", "brief", "brief");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /unknown runner/);
	assert.equal(result.stdout, "");
});

/*
 * A bundle carries its own runner's page and the failure page, and nothing
 * else. A page from another runner is not in the file at all, so asking for
 * it has to read exactly like a name nobody has: one line, exit one, no page.
 */
test("a bundle asked for another runner's page fails the way an unknown runner does", () => {
	const result = render("recruiter", "html", "recruiter", "brief");
	assert.equal(result.status, 1);
	assert.equal(result.stderr, 'render: unknown runner "recruiter"; one of brief, failure\n');
	assert.equal(result.stdout, "");
});

test("every bundle carries the failure page", () => {
	for (const runner of new Set(CASES.map((item) => item.runner))) {
		const result = spawnSync(
			process.execPath,
			[bundlePath(runner), "failure", "html", "--title", "Invented", "--reason", "an invented reason"],
			{ input: "the log's tail\n", encoding: "utf8" },
		);
		assert.equal(result.status, 0, `${runner}: ${result.stderr}`);
		assert.ok(result.stdout.includes("an invented reason"), `${runner} renders the reason`);
		assert.ok(result.stdout.endsWith("</html>\n"));
	}
});

test("an unknown format fails loudly", () => {
	const result = render("brief", "markdown", "brief");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /unknown format/);
});

test("a draft that is not JSON fails loudly", () => {
	const result = renderRaw("brief", "html", "the agent wrote prose again");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /not JSON/);
	assert.equal(result.stdout, "");
});

test("a render that throws fails loudly rather than writing half a page", () => {
	const result = renderRaw("brief", "html", '{"strava": 7}');
	assert.equal(result.status, 1);
	assert.match(result.stderr, /render threw/);
	assert.equal(result.stdout, "");
});

/* ---------- the brief ---------- */

const sectionOf = (text, name) => {
	const start = text.indexOf(`\n${name.toUpperCase()}\n`);
	assert.ok(start >= 0, `${name} is on the page`);
	const next = text.indexOf("\n================================================================\n", start + name.length + 70);
	return text.slice(start, next < 0 ? undefined : next);
};

const briefDraft = () => JSON.parse(readFileSync(fixturePath("brief"), "utf8"));

/*
 * The mail is named for the week it plans, the one that opens after the closed
 * week's Sunday (ATE-675), while every date on the page stays the closed
 * week's. The fixtures render for 2026-W05, so the mail is the W06 brief.
 */
test("the brief is named for the planning week and dated by the closed one", () => {
	const html = render("brief", "html", "brief");
	assert.equal(html.status, 0, html.stderr);
	assert.ok(html.stdout.includes("2026-W06 Brief"), "the title is the planning week");
	assert.ok(html.stdout.includes("Brief · Week 6"), "and so is the masthead");
	const text = render("brief", "text", "brief").stdout;
	assert.ok(text.startsWith("ATELIC · BRIEF · WEEK 6\n"), "the text twin leads with the planning week");
	assert.ok(text.includes("\nLAST WEEK · WEEK 5\n"), "and names the closed week under it");
	assert.ok(text.includes("\n  3 tasks completed last week.\n"), "the completed tasks are one line, not a table");
});

/*
 * What I Need From You holds the decision rows alone, grouped by source and
 * numbered within the group, so a reply can say "Money 2, no". A source with
 * nothing to decide is not drawn.
 */
test("what I need from you groups the decision rows by source and numbers within each", () => {
	const text = render("brief", "text", "brief");
	assert.equal(text.status, 0, text.stderr);
	const needs = sectionOf(text.stdout, "What I Need From You");
	// Two decision rows, one delete and one trip memo on the fixture's money.
	assert.ok(needs.includes("\nMoney · 4\n"), "money counts its decisions, deletes and memos");
	for (const n of [1, 2, 3, 4]) assert.ok(needs.includes(`\n  ${n}. `), `money row ${n} is numbered`);
	assert.ok(!needs.includes("\n  5. "), "and the numbering restarts with the next group");
	assert.ok(needs.includes("\nEmail · 2\n"), "the two decision messages");
	assert.ok(needs.includes("\nCalendar · 1\n"), "the one decision finding");
	assert.ok(needs.includes("\nTasks · 1\n"), "the one note");
	assert.ok(!needs.includes("\nWork · "), "a source with nothing to decide is not drawn");
	assert.ok(needs.indexOf("Money · 4") < needs.indexOf("Email · 2"), "in source order");

	const html = render("brief", "html", "brief");
	assert.equal(html.status, 0, html.stderr);
	assert.ok(html.stdout.includes(">1. Venmo, $85.00 on Fri 01-30<"), "a decision row names the thing itself");
});

/*
 * What I Did is a ledger: the rows categorized are a count, and only a big
 * row is listed. A high row never earns a line; a medium one does only at
 * $500 or more; an inflow of that size does whatever its band.
 */
test("the ledger counts the rows categorized and lists only the big ones", () => {
	const draft = briefDraft();
	draft.money.rows = [
		{ budget: "Personal", id: "t-1", date: "2026-01-27", amount: "-9.00", payee: "Tally Only Bakery", category: "🥐 Bakery Test", memo: "", band: "high", rule: "an invented rule", reason: "" },
		{ budget: "Personal", id: "t-2", date: "2026-01-28", amount: "-11.00", payee: "Spot Check Diner", category: "🍽️ Diner Test", memo: "", band: "medium", rule: "an invented family", reason: "" },
		{ budget: "Personal", id: "t-3", date: "2026-01-29", amount: "-650.00", payee: "Big Spender Antiques", category: "🏡 Home Test", memo: "", band: "medium", rule: "an invented family", reason: "a first visit" },
		{ budget: "Personal", id: "t-4", date: "2026-01-30", amount: "1200.00", payee: "Refund Office", category: "Inflow: Ready to Assign", memo: "", band: "high", rule: "an invented inflow rule", reason: "" },
		{ budget: "Personal", id: "t-5", date: "2026-01-30", amount: "-42.00", payee: "Nobody Knows LLC", category: "", memo: "", band: "decision", rule: "", reason: "a bare descriptor" },
	];
	const text = renderRaw("brief", "text", JSON.stringify(draft));
	assert.equal(text.status, 0, text.stderr);
	const did = sectionOf(text.stdout, "This Week");
	assert.match(did, /Money +4 rows categorized/, "the decision row is not counted as done");
	const big = did.slice(did.indexOf("\nBig Rows · "));
	assert.ok(big.startsWith("\nBig Rows · 2\n"), "two rows are big");
	assert.ok(big.includes("Big Spender Antiques"), "a medium row of $500 or more is listed");
	assert.ok(big.includes("Refund Office"), "and so is a large inflow");
	assert.ok(!big.includes("Tally Only Bakery") && !big.includes("Spot Check Diner"), "small rows are counts only");
	assert.ok(did.includes("Writes were off this run"), "writes off reads as the session's to apply");
	assert.ok(did.includes("\nMoney Rules · "), "the money rules are a table");
	assert.ok(did.includes("\nEmail Rules · "), "and so are the email rules");
	assert.match(did, /Mailbox +Sender +Label +Star +Read +Archive/, "as a table of checks");

	draft.applied.writes = true;
	draft.applied.ynab = [{ budget: "Personal", id: "t-1", payee: "Tally Only Bakery", amount: "-9.00", category: "🥐 Bakery Test" }];
	const on = renderRaw("brief", "text", JSON.stringify(draft));
	assert.equal(on.status, 0, on.stderr);
	assert.ok(sectionOf(on.stdout, "This Week").includes("applied overnight"), "writes on reads as applied");
});

test("the money table carries what went out and in, the pace, and the delta against it", () => {
	const text = render("brief", "text", "brief").stdout;
	const last = sectionOf(text, "Last Week · Week 5");
	assert.match(last, /Budget +Out +In +Pace +Delta/, "one table, five columns");
	assert.match(last, /Personal +\$4,012\.37 +\$3,612\.00 +\$3,871\.29 +\+\$141\.08/, "out, the inflows as one total, pace, and the signed difference");
	assert.ok(!last.includes("Invented Payroll"), "no inflow is listed on its own");
	assert.ok(!last.includes("Trips"), "trips are gone");
	assert.ok(!last.includes("Month So Far"), "and so is the day count title");
	assert.ok(last.includes("Money · ⚠️"), "the fixture's account in error puts the sign on the eyebrow");
	assert.ok(last.includes("Front Range Checking"), "and the warning itself sits under the table");
	assert.ok(!text.includes("\nSessions · "), "the sessions table is gone; the day strip is the movement detail");
});

test("a pull that was not read is a line in the ledger and is listed in This Run", () => {
	const draft = briefDraft();
	draft.pulls = draft.pulls.map((pull) =>
		pull.name === "linear" ? { ...pull, ok: false, note: "the cycle read failed" } : { ...pull, ok: true, note: "" },
	);
	const text = renderRaw("brief", "text", JSON.stringify(draft));
	assert.equal(text.status, 0, text.stderr);
	const did = sectionOf(text.stdout, "This Week");
	assert.match(did, /Work +Not read this run: the cycle read failed/, "the ledger line carries the notice");
	assert.ok(!/Tasks +Not read/.test(did), "and no other line does");
	const run = sectionOf(text.stdout, "This Run");
	assert.ok(run.includes("\nNot Read · 1\n  linear\n    the cycle read failed"), "This Run names it");

	const html = renderRaw("brief", "html", JSON.stringify(draft));
	assert.equal(html.status, 0, html.stderr);
	assert.ok(html.stdout.includes("Not read this run: the cycle read failed"));
});

test("a planning half that did not validate is a notice on every ledger line and never an all clear", () => {
	const draft = briefDraft();
	draft.money = { read: "", rows: [], deletes: [], trips: [] };
	draft.inbox = { rows: [] };
	draft.work = { read: "", flags: [], unplaced: [] };
	draft.calendar = { read: "", findings: [] };
	draft.tasks = { read: "", rows: [] };
	draft.rules = [];
	draft.pulls = [{ name: "planning", ok: false, note: "the planning half of the answer did not validate" }];
	const text = renderRaw("brief", "text", JSON.stringify(draft));
	assert.equal(text.status, 0, text.stderr);
	assert.ok(!text.stdout.includes("Nothing needs you this week"), "no all clear");
	assert.ok(sectionOf(text.stdout, "What I Need From You").includes("The planning half was not read this run"), "the board says so");
	const did = sectionOf(text.stdout, "This Week");
	for (const name of ["Money", "Email", "Work", "Calendar", "Tasks"]) {
		assert.ok(new RegExp(`${name} +Not read this run`).test(did), `${name} carries the notice`);
	}
	const html = renderRaw("brief", "html", JSON.stringify(draft));
	assert.equal(html.status, 0, html.stderr);
	assert.ok(!html.stdout.includes("Nothing needs you this week"));
});

test("a draft from before the rows carried bands still renders the way it was written", () => {
	const draft = briefDraft();
	for (const row of draft.calendar.findings) delete row.band;
	for (const row of draft.tasks.rows) delete row.band;
	for (const row of draft.work.flags) delete row.band;
	const text = renderRaw("brief", "text", JSON.stringify(draft));
	assert.equal(text.status, 0, text.stderr);
	const needs = sectionOf(text.stdout, "What I Need From You");
	assert.ok(needs.includes("\nCalendar · 2\n"), "every unbanded finding was a decision");
	assert.ok(needs.includes("\nTasks · 1\n"), "a note was a decision and a plain task was not");
	assert.ok(!needs.includes("\nWork · "), "a flag was the session's");
});

test("the parity canonicalizer ignores what only the markup differs on", () => {
	const jqShape = '<table><tr><td style="color:#FC4A1A; padding:2px;">a &#39;b&#39;</td></tr></table>';
	const reactShape =
		'<table><tbody><tr><td style="color:#fc4a1a;padding:2px">a &#x27;b&#x27;</td></tr></tbody></table>';
	assert.equal(firstDifference(canonicalize(jqShape), canonicalize(reactShape)), null);
});

test("the parity canonicalizer catches a declaration that moved", () => {
	const before = '<p style="padding:2px;color:#151515">x</p>';
	const after = '<p style="padding:3px;color:#151515">x</p>';
	assert.match(firstDifference(canonicalize(before), canonicalize(after)) ?? "", /padding/);
});
