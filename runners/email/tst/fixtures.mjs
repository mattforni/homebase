import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * What both the test and the golden writer need: where things live, the one
 * week every golden is rendered for, and the call into the built bundles.
 *
 * A bundle carries one runner's page, so there is one per runner here too,
 * each built by build.mjs the way an image's first stage builds its own. Every
 * render below goes through the file an image would run, never an import of
 * the page.
 *
 * The week is 2026-W05 on purpose. Its number carries a leading zero, so the
 * goldens prove that a week reads as 5 rather than 05, and it runs from
 * January into February, so the short dates cross a month boundary.
 */

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(HERE);

export const CONTEXT = {
	week: "2026-W05",
	monday: "2026-01-26",
	sunday: "2026-02-01",
	meta: "12m 04s · $0.42 · 9 turns · claude-sonnet",
};

/** Every fixture, as the runner it belongs to and the file it lives in. */
export const CASES = [
	{ runner: "brief", fixture: "brief" },
	{ runner: "brief", fixture: "brief-empty" },
	{ runner: "recruiter", fixture: "recruiter" },
	{ runner: "recruiter", fixture: "recruiter-empty" },
];

export const FORMATS = ["html", "text"];

/** Where build.mjs leaves a runner's bundle. */
export function bundlePath(runner) {
	return join(ROOT, "dist", `render-${runner}.cjs`);
}

/*
 * Every runner with a fixture is built once, when this file is first loaded,
 * so the test and the golden writer never read a bundle older than the
 * sources. A build that fails stops everything here with the builder's own
 * line, since nothing below could mean anything.
 */
{
	const runners = [...new Set(CASES.map(({ runner }) => runner))];
	const built = spawnSync(process.execPath, [join(ROOT, "build.mjs"), ...runners], { encoding: "utf8" });
	if (built.status !== 0) {
		process.stderr.write(built.stderr || `build.mjs exited ${built.status}\n`);
		process.exit(1);
	}
}

export function goldenPath(fixture, format) {
	return join(ROOT, "goldens", `${fixture}.${format === "html" ? "html" : "txt"}`);
}

export function fixturePath(fixture) {
	return join(ROOT, "fixtures", `${fixture}.json`);
}

/*
 * One run of a built bundle, with whatever is handed in on stdin. The bundle
 * is the named runner's own unless another is asked for, which is how a test
 * asks one runner's bundle for a page it does not carry.
 */
export function renderRaw(runner, format, input, bundle = runner) {
	return spawnSync(
		process.execPath,
		[
			bundlePath(bundle),
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

/** One run of a built bundle over a fixture, with the page captured. */
export function render(runner, format, fixture, bundle = runner) {
	return renderRaw(runner, format, readFileSync(fixturePath(fixture), "utf8"), bundle);
}

/*
 * The failure page as a run mails it, through a runner's bundle, with an
 * invented reason and log. The plain call is frozen as a golden: it is the
 * page from before the step and the fix existed, and it has to stay that
 * page for every caller that names neither.
 */
export const FAILURE = {
	runner: "brief",
	golden: "failure",
	args: ["--title", "Brief", "--eyebrow", "Brief · 2026-W38", "--reason", "an invented reason"],
	log: "an invented log line\nand another one\n",
};

export function renderFailure(extra = []) {
	return spawnSync(process.execPath, [bundlePath(FAILURE.runner), "failure", "html", ...FAILURE.args, ...extra], {
		input: FAILURE.log,
		encoding: "utf8",
	});
}
