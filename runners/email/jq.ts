/*
 * The jq semantics the three runner pages were written against, ported
 * literally. Every function here exists because JavaScript's own answer is
 * subtly different from jq's, and the renderers have to agree with the jq
 * they replaced byte for byte in plain text and node for node in html.
 *
 * What bites, and what each helper does about it:
 *   - `a // b` yields b when a is null OR false, never when a is 0 or "".
 *   - `length` on a string counts Unicode codepoints, not UTF-16 units.
 *   - `ascii_upcase` and `ascii_downcase` touch ASCII letters and nothing else
 *     (they live in the package, as asciiUpcase and asciiDowncase).
 *   - `split(" ")` on an empty string yields an empty array, where JavaScript
 *     yields one empty element; every caller here is written so both agree.
 *   - `strftime` and every date arithmetic in jq run in UTC.
 *   - `round` rounds half away from zero; every value it sees here is
 *     non negative, where Math.round agrees with it.
 */

/** jq's `//`: the fallback answers null and false, nothing else. */
export function alt<T>(value: T | null | undefined | false, fallback: T): T {
	return value === null || value === undefined || value === false ? fallback : value;
}

/** jq's `[range(0; n)]`. */
export function rangeOf(count: number): number[] {
	return Array.from({ length: count }, (_, index) => index);
}

/** jq's `length` on a string. */
export function codepoints(value: string): number {
	return [...value].length;
}

/** jq's string slice, which counts codepoints. */
export function slice(value: string, from: number, to?: number): string {
	return [...value].slice(from, to).join("");
}

/**
 * jq's `tostring` on a number. jq prints a double the shortest way that reads
 * back, which is what JavaScript does too, so 1.0 is "1" on both sides.
 */
export function numberString(value: number): string {
	return String(value);
}

/**
 * jq's `tostring` over anything, which is what `esc` runs first. A null reads
 * as the word null and an object as its compact JSON, exactly as jq writes
 * them, so a draft with a hole in it produces the same page both ways rather
 * than a quietly different one.
 */
export function jqToString(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined || value === null) return "null";
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value) ?? "null";
}

/** jq's `tonumber? // 0` over anything: a number passes, a numeric string parses, the rest is 0. */
export function num(value: unknown): number {
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed === "") return 0;
		const parsed = Number(trimmed);
		return Number.isNaN(parsed) ? 0 : parsed;
	}
	return 0;
}

/** The days of the week and the months, in the C locale strftime writes. */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** jq's `fromdate`: an RFC 3339 instant as seconds since the epoch. */
export function fromDate(iso: string): number {
	return Math.floor(Date.parse(iso) / 1000);
}

/** jq's `strftime("%a")`, in UTC, the way jq reads a date. */
export function weekdayName(epochSeconds: number): string {
	const date = new Date(epochSeconds * 1000);
	return WEEKDAYS[date.getUTCDay()];
}

/** jq's `strftime("%Y-%m-%d")`, in UTC. */
export function isoDate(epochSeconds: number): string {
	return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

/** The ISO week's number without its leading zero: "2026-W05" reads as "5". */
export function weekNumber(week: string): string {
	const parts = week.split("-W");
	return String(Number(parts[1]));
}

/** "2026-09-14" as "09/14". */
export function shortDate(day: string): string {
	const parts = day.split("-");
	return `${parts[1]}/${parts[2]}`;
}

/**
 * Two decimal places the way the retro's `two` writes them: multiply, round,
 * divide, print, then pad out to two places. Deliberately not toFixed, which
 * rounds the printed decimal rather than the scaled integer and disagrees on
 * the halfway cases the distances land on.
 */
export function two(value: number): string {
	const printed = String(Math.round(value * 100) / 100);
	if (!printed.includes(".")) return `${printed}.00`;
	return /\.[0-9]$/.test(printed) ? `${printed}0` : printed;
}

const SMALL_WORDS = ["a", "an", "the", "of", "in", "to", "for", "by"];

/**
 * The retro's `titlecase`: underscores become spaces, every word lowercases,
 * a small word keeps its lowercase anywhere but first, and the rest take an
 * ASCII capital. HubSpot shouts its own vocabulary and the model writes
 * sentence case; both read as Title Case here.
 */
export function titlecase(value: unknown): string {
	const words = jqToString(value).replace(/_/g, " ").split(" ");
	if (words.length === 1 && words[0] === "") return "";
	return words
		.map((raw, index) => {
			const word = raw.replace(/[A-Z]/g, (c) => c.toLowerCase());
			if (word === "") return "";
			if (index > 0 && SMALL_WORDS.includes(word)) return word;
			return slice(word, 0, 1).replace(/[a-z]/g, (c) => c.toUpperCase()) + slice(word, 1);
		})
		.join(" ");
}

const WORDS = [
	"Zero",
	"One",
	"Two",
	"Three",
	"Four",
	"Five",
	"Six",
	"Seven",
	"Eight",
	"Nine",
	"Ten",
];

/** The retro's `word`: nought to ten spelled out, anything else as its digits. */
export function word(value: number): string {
	return value >= 0 && value <= 10 ? WORDS[value] : numberString(value);
}

/** Strips the two space indent `wrap` lays down, the way the retro's headline does. */
export function unindent(text: string): string {
	return text.replace(/^ {2}/gm, "");
}
