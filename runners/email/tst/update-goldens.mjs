#!/usr/bin/env node
/*
 * Rewrites every frozen golden from the current renderer.
 *
 *   npm --prefix runners/email run goldens
 *
 * Run it only when a layout change is intended, and read the diff before
 * committing it: a golden that moved without a reason is the renderer drifting
 * away from the design, which is the whole thing these files are here to
 * catch. Build first; this reads dist/render.cjs.
 */

import { writeFileSync } from "node:fs";
import { CASES, FORMATS, goldenPath, render } from "./fixtures.mjs";

let failed = false;
for (const { runner, fixture } of CASES) {
	for (const format of FORMATS) {
		const result = render(runner, format, fixture);
		if (result.status !== 0) {
			process.stderr.write(`${fixture} ${format}: exit ${result.status}\n${result.stderr}`);
			failed = true;
			continue;
		}
		const path = goldenPath(fixture, format);
		writeFileSync(path, result.stdout);
		process.stdout.write(`wrote ${path} (${result.stdout.length} bytes)\n`);
	}
}
process.exit(failed ? 1 : 0);
