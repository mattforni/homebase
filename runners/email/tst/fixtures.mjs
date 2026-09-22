import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * What both the test and the golden writer need: where things live, the one
 * week every golden is rendered for, and the call into the built bundle.
 *
 * The week is 2026-W05 on purpose. Its number carries a leading zero, so the
 * goldens prove that a week reads as 5 rather than 05, and it runs from
 * January into February, so the short dates cross a month boundary.
 */

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(HERE);
export const BUNDLE = join(ROOT, "dist", "render.cjs");

export const CONTEXT = {
	week: "2026-W05",
	monday: "2026-01-26",
	sunday: "2026-02-01",
	meta: "12m 04s · $0.42 · 9 turns · claude-sonnet",
};

/** Every fixture, as the runner it belongs to and the file it lives in. */
export const CASES = [
	{ runner: "retro", fixture: "retro" },
	{ runner: "retro", fixture: "retro-empty" },
	{ runner: "pipeline", fixture: "pipeline" },
	{ runner: "pipeline", fixture: "pipeline-empty" },
	{ runner: "recruiter", fixture: "recruiter" },
	{ runner: "recruiter", fixture: "recruiter-empty" },
];

export const FORMATS = ["html", "text"];

export function goldenPath(fixture, format) {
	return join(ROOT, "goldens", `${fixture}.${format === "html" ? "html" : "txt"}`);
}

export function fixturePath(fixture) {
	return join(ROOT, "fixtures", `${fixture}.json`);
}

/** One run of the built bundle, with whatever is handed in on stdin. */
export function renderRaw(runner, format, input) {
	return spawnSync(
		process.execPath,
		[
			BUNDLE,
			runner,
			format,
			"--week",
			CONTEXT.week,
			"--monday",
			CONTEXT.monday,
			"--sunday",
			CONTEXT.sunday,
			"--meta",
			CONTEXT.meta,
		],
		{ input, encoding: "utf8" },
	);
}

/** One run of the built bundle over a fixture, with the page captured. */
export function render(runner, format, fixture) {
	return renderRaw(runner, format, readFileSync(fixturePath(fixture), "utf8"));
}
