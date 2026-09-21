import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalize, firstDifference } from "../parity.mjs";
import { CASES, FORMATS, goldenPath, render, renderRaw } from "./fixtures.mjs";

/*
 * The gate on the renderer. Every fixture renders through the built bundle and
 * has to come back byte for byte what the frozen golden says, html and text
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
 * The width gate on the two new text twins. The goldens only prove the text
 * has not moved; they cannot say it was right to begin with, and the first
 * recruiter twin was not: fixtures full of short invented strings froze a
 * layout that ran to 172 columns on a real draft and butted a long company
 * name straight into its reason. So the fixtures now carry long values, and
 * this holds every line to the 68 columns prose wraps at. The one excuse is a
 * line whose overflow is a single unbreakable last token (a url): take that
 * token away and the rest has to fit. The retro is exempt on purpose: its twin
 * is a byte for byte port of the jq one, wide session tables included.
 */
const TEXT_WIDTH = 68;
const columns = (line) => [...line].length;
const withoutLastToken = (line) => line.replace(/\S+$/, "");

for (const { runner, fixture } of CASES) {
	if (runner === "retro") continue;
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
	const result = render("nosuchrunner", "html", "retro");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /unknown runner/);
	assert.equal(result.stdout, "");
});

test("an unknown format fails loudly", () => {
	const result = render("retro", "markdown", "retro");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /unknown format/);
});

test("a draft that is not JSON fails loudly", () => {
	const result = renderRaw("retro", "html", "the agent wrote prose again");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /not JSON/);
	assert.equal(result.stdout, "");
});

test("a render that throws fails loudly rather than writing half a page", () => {
	const result = renderRaw("retro", "html", '{"strava": 7}');
	assert.equal(result.status, 1);
	assert.match(result.stderr, /render threw/);
	assert.equal(result.stdout, "");
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
