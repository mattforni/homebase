import { readFileSync } from "node:fs";
import { renderFailureEmail } from "@atelic-action/ui/email/render";
import { page } from "runner-page";
import type { Page, RenderContext } from "./types";

/*
 * The renderer a runner calls, bundled by esbuild into one CommonJS file per
 * runner (build.mjs): this file, that runner's page, and the failure page.
 *
 *   node render.cjs <runner> <html|text> \
 *       --week 2026-W38 --monday 2026-09-14 --sunday 2026-09-20 --meta "42s · $0.31"
 *
 * and the page a bad run mails instead, whose stdin is the log's tail rather
 * than a draft:
 *
 *   node render.cjs failure html \
 *       --title Brief --eyebrow "Brief · 2026-W38" --reason "the render failed" \
 *       [--step "Page render"] [--fix "what the reader should do about it"]
 *
 * --step names what failed and --fix says what to do. With either one the page
 * lays its facts out as labelled rows (What Failed, Why, What to Do, then the
 * log); with neither it is the reason and the log, exactly as before they
 * existed.
 *
 * The page leaves on stdout with exactly one trailing newline, which is what
 * every caller downstream counts on. A bundle answers to its own runner's
 * name and to no other: the page is whichever one build.mjs aliased
 * "runner-page" to, under the name it defined as RUNNER_NAME, so asking the
 * brief's bundle for another runner's page is an unknown name like any other.
 * A bad runner name, a draft that is not
 * JSON, and a render that throws each print one line to stderr and exit non
 * zero, so the scaffold can say why in the log; for the failure page that is
 * the moment it drops to a bare <pre>, which is the last thing standing
 * between a broken renderer and no mail at all.
 */

/* Set by the build to the runner this bundle was built for. */
declare const RUNNER_NAME: string;

const PAGES: Record<string, Page> = { [RUNNER_NAME]: page };

const FORMATS = ["html", "text"];

const FAILURE = "failure";

function die(message: string): never {
	process.stderr.write(`render: ${message}\n`);
	process.exit(1);
}

type Arguments = { positional: string[]; named: Record<string, string> };

function tokenize(argv: string[]): Arguments {
	const positional: string[] = [];
	const named: Record<string, string> = {};
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (token.startsWith("--")) {
			const key = token.slice(2);
			const value = argv[i + 1];
			if (value === undefined) die(`--${key} needs a value`);
			named[key] = value;
			i += 1;
			continue;
		}
		positional.push(token);
	}
	return { positional, named };
}

function names(): string {
	return [...Object.keys(PAGES), FAILURE].join(", ");
}

function parse(args: Arguments): { page: Page; format: string; context: RenderContext } {
	const { positional, named } = args;
	const [name, format] = positional;
	const page = PAGES[name];
	if (page === undefined) die(`unknown runner "${name}"; one of ${names()}`);
	if (format === undefined) die(`no format named; one of ${FORMATS.join(", ")}`);
	if (!FORMATS.includes(format)) die(`unknown format "${format}"; one of ${FORMATS.join(", ")}`);
	if (positional.length > 2) die(`unexpected argument "${positional[2]}"`);

	for (const required of ["week", "monday", "sunday"]) {
		if (!named[required]) die(`--${required} is required`);
	}

	return {
		page,
		format,
		context: {
			week: named.week,
			monday: named.monday,
			sunday: named.sunday,
			meta: named.meta ?? "",
		},
	};
}

function stdin(what: string): string {
	try {
		return readFileSync(0, "utf8");
	} catch (error) {
		die(`could not read ${what} on stdin: ${String(error)}`);
	}
}

/*
 * The failure page: what failed, the reason it gives and what to do, and the
 * log's tail beneath them. The step and the fix are optional and only passed
 * on when given, so a caller that names neither gets the page it always got.
 */
function failure(args: Arguments): string {
	const { positional, named } = args;
	const format = positional[1] ?? "html";
	if (format !== "html") die(`the failure page is html only, not "${format}"`);
	if (positional.length > 2) die(`unexpected argument "${positional[2]}"`);
	for (const required of ["title", "reason"]) {
		if (!named[required]) die(`--${required} is required`);
	}

	try {
		return renderFailureEmail({
			runnerTitle: named.title,
			eyebrowText: named.eyebrow ?? named.title,
			reason: named.reason,
			logTail: stdin("the log's tail"),
			...(named.step ? { step: named.step } : {}),
			...(named.fix ? { fix: named.fix } : {}),
		});
	} catch (error) {
		die(`the failure render threw: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function runnerPage(args: Arguments): string {
	const { page, format, context } = parse(args);

	let draft: unknown;
	try {
		draft = JSON.parse(stdin("the draft"));
	} catch (error) {
		die(`the draft is not JSON: ${String(error)}`);
	}

	try {
		return format === "text" ? page.text(draft, context) : page.html(draft, context);
	} catch (error) {
		die(`the ${format} render threw: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function main(): void {
	const args = tokenize(process.argv.slice(2));
	const name = args.positional[0];
	if (name === undefined) die(`no runner named; one of ${names()}`);

	process.stdout.write(`${name === FAILURE ? failure(args) : runnerPage(args)}\n`);
}

main();
