import { readFileSync } from "node:fs";
import { renderFailureEmail } from "@atelic-action/ui/email/render";
import { pipelineHTML, pipelineText } from "./plumber";
import { recruiterHTML, recruiterText } from "./recruiter";
import { retroHTML, retroText } from "./retro";
import type { Page, RenderContext } from "./types";

/*
 * The renderer the runners call, bundled by esbuild into one CommonJS file:
 *
 *   node render.cjs <retro|plumber|recruiter> <html|text> \
 *       --week 2026-W38 --monday 2026-09-14 --sunday 2026-09-20 --meta "42s · $0.31"
 *
 * and the page a bad run mails instead, whose stdin is the log's tail rather
 * than a draft:
 *
 *   node render.cjs failure html \
 *       --title Retro --eyebrow "Retro · 2026-W38" --reason "the render failed"
 *
 * The page leaves on stdout with exactly one trailing newline, which is what
 * every caller downstream counts on. A bad runner name, a draft that is not
 * JSON, and a render that throws each print one line to stderr and exit non
 * zero, so the scaffold can say why in the log; for the failure page that is
 * the moment it drops to a bare <pre>, which is the last thing standing
 * between a broken renderer and no mail at all.
 */

const PAGES: Record<string, Page> = {
	retro: { html: retroHTML, text: retroText },
	plumber: { html: pipelineHTML, text: pipelineText },
	recruiter: { html: recruiterHTML, text: recruiterText },
};

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

/* The failure page: the reason it gives and the log's tail beneath it. */
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
