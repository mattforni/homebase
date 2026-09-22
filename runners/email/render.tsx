import { readFileSync } from "node:fs";
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
 * The draft JSON arrives on stdin and the page leaves on stdout with exactly
 * one trailing newline, which is what `jq -r` wrote and what every caller
 * downstream still counts on. A bad runner name, a draft that is not JSON, and
 * a render that throws each print one line to stderr and exit non zero, so the
 * scaffold can fall back to the jq path and say why in the log.
 */

const PAGES: Record<string, Page> = {
	retro: { html: retroHTML, text: retroText },
	plumber: { html: pipelineHTML, text: pipelineText },
	recruiter: { html: recruiterHTML, text: recruiterText },
};

const FORMATS = ["html", "text"];

function die(message: string): never {
	process.stderr.write(`render: ${message}\n`);
	process.exit(1);
}

function parse(argv: string[]): { page: Page; format: string; context: RenderContext } {
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

	const [name, format] = positional;
	if (name === undefined) die(`no runner named; one of ${Object.keys(PAGES).join(", ")}`);
	const page = PAGES[name];
	if (page === undefined) die(`unknown runner "${name}"; one of ${Object.keys(PAGES).join(", ")}`);
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

function main(): void {
	const { page, format, context } = parse(process.argv.slice(2));

	let raw: string;
	try {
		raw = readFileSync(0, "utf8");
	} catch (error) {
		die(`could not read the draft on stdin: ${String(error)}`);
	}

	let draft: unknown;
	try {
		draft = JSON.parse(raw);
	} catch (error) {
		die(`the draft is not JSON: ${String(error)}`);
	}

	let out: string;
	try {
		out = format === "text" ? page.text(draft, context) : page.html(draft, context);
	} catch (error) {
		die(`the ${format} render threw: ${error instanceof Error ? error.message : String(error)}`);
	}

	process.stdout.write(`${out}\n`);
}

main();
