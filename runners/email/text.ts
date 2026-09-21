import { rpad, spaces, wrap } from "@atelic-action/ui/email";

/*
 * Plain text shapes the outreach and recruiter pages share. Both twins are new
 * (neither page had a jq text branch), so unlike the retro's they answer to no
 * baseline, only to the rule the twins exist for: every label and value sits
 * in its own column or on its own line, nothing is ever concatenated, and no
 * line of prose runs past the 68 columns the retro wraps at.
 *
 * Two shapes cover every free text value. A fixed width column is only safe
 * for values that are short by construction (a count, a fit score); anything a
 * model or a job board wrote goes through one of these instead.
 */

/** The column prose wraps at, indent included, matching the package's wrap. */
export const TEXT_WIDTH = 68;

function codepoints(value: string): number {
	return [...value].length;
}

/** Greedy word wrap to a width; a word longer than the width sits alone. */
function fill(text: string, width: number): string[] {
	const lines: string[] = [];
	for (const word of text.split(" ").filter((part) => part !== "")) {
		const last = lines[lines.length - 1];
		if (last === undefined || codepoints(last) + 1 + codepoints(word) > width) lines.push(word);
		else lines[lines.length - 1] = `${last} ${word}`;
	}
	return lines;
}

/**
 * A label in its padded column and the value beside it, wrapped with a hanging
 * indent so a long value continues under itself and never under the label. An
 * empty value leaves the bare label, with no trailing spaces.
 */
export function hang(label: string, value: string, labelWidth: number): string {
	const indent = 2 + labelWidth;
	const lines = fill(value, TEXT_WIDTH - indent);
	if (lines.length === 0) return `  ${label}\n`;
	return `${lines
		.map((line, index) => (index === 0 ? `  ${rpad(label, labelWidth)}${line}` : `${spaces(indent)}${line}`))
		.join("\n")}\n`;
}

/**
 * A lead on its own line and its note wrapped beneath: the shape for any pair
 * whose halves are both free text. No column width to outgrow, so the two can
 * never run together. The lead wraps too, since a company with its role title
 * is as long as any sentence. An empty note leaves the lead alone.
 */
export function leadBlock(lead: string, note: string): string {
	return note === "" ? wrap(lead) : `${wrap(lead)}\n${wrap(note)}`;
}
