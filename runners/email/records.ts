import type { RecordAside, RecordAsideTone, RecordBadge, RecordStackItem, RecordTimeline } from "@atelic-action/ui/email";
import { alt, jqToString, numberString, titlecase } from "./jq";

/*
 * The one record card for a company or a contact, shared by every mail
 * (Forni, 2026-09-29: "the company and the contact cards should be very
 * similar in the emails, with a base component across these, and the touches
 * and the opens in the same place"). Each mail maps its own rows into a
 * RecordInput and this file decides how the card reads, so a rule about
 * opens or tracking is written once:
 *
 * - No send logged reads "no send logged", never "0 touches · untracked".
 * - A send with no tracking reads "untracked"; a tracked send nobody opened
 *   reads "no opens yet"; opens are counted otherwise. When the mail knows
 *   how many sends carried tracking, a mixed record says "2 of 3 tracked".
 * - The clock (sent, opened, replied, in days) rides on the meta line after
 *   the counts, so the whole history of a name sits in one place, and the
 *   mail's own sentence about the name stays the note beneath.
 * - A deal reads its stage and its cash; a closed name reads its reason.
 * - A card with a timeline (the Company Cards IA, 2026-09-29) draws its sends
 *   and its last open on the strip, sets "opened Nd" right on the meta line in
 *   a freshness tone, and keeps only the reply on the clock, since the strip
 *   already says when the sends went out.
 */

/** The strip spans thirty days, today at the right edge. */
export const TIMELINE_DAYS = 30;

export type TouchLine = {
	/** Sends logged on the record. */
	touches?: number | null;
	/** Sends that carried tracking, when the mail knows; omit when it does not. */
	tracked?: number | null;
	/** Opens across the tracked sends; null when no send carried tracking. */
	opens?: number | null;
	/** "First", "Bump" or "Visit": the kind of the last touch. */
	lastTouch?: unknown;
	daysSinceSend?: number | null;
	daysSinceOpen?: number | null;
	daysSinceReply?: number | null;
	/** The reply's date when the mail has one instead of a day count. */
	lastReply?: unknown;
	/** True when the record shows a reply and no date for it. */
	replied?: boolean;
};

export type RecordInput = {
	title: unknown;
	url?: string | null;
	/** A stage or status word for the pill, as the record carries it (CONTACTED, Closed Lost). */
	badge?: unknown;
	/** Facts that lead the meta line: the company on a contact card, the fit on a first touch. */
	lead?: unknown[];
	touch?: TouchLine | null;
	/** The deal's stage and cash; `cash` is a preformatted string for a mail whose rows carry one instead of a number. */
	deal?: { stage?: unknown; amount?: number | null; cash?: unknown; close?: unknown; signed?: boolean } | null;
	closed?: { reason?: unknown } | null;
	/** A line under the meta, from the mail; the clock goes before it. */
	note?: unknown;
	callout?: { eyebrow: string; text: string } | null;
	/** The Company Cards pills after the badge: New in the accent, the next touch in ink, Wait faint. */
	pills?: RecordBadge[] | null;
	/** The sends and the last open as day counts back from today; the card draws them when set. */
	days?: { touches?: number[] | null; opens?: number[] | null } | null;
};

/** "opened 6d" set right on the meta line, its number by freshness: inside a week `up`, inside two `warm`, older `accent`. */
export function openedAside(daysSinceOpen: number | null | undefined): RecordAside | undefined {
	if (daysSinceOpen === null || daysSinceOpen === undefined) return undefined;
	const tone: RecordAsideTone = daysSinceOpen <= 7 ? "up" : daysSinceOpen <= 14 ? "warm" : "accent";
	return { text: "opened", strong: `${numberString(Math.max(daysSinceOpen, 0))}d`, tone };
}

/** The strip a card draws from its day counts; nothing when the record has no send and no open to place. */
export function timelineOf(days: RecordInput["days"]): RecordTimeline | undefined {
	if (!days) return undefined;
	// Only what lands inside the window draws; a record whose every send is
	// older than the strip keeps its clock on the meta line instead.
	const inWindow = (d: number | null | undefined): d is number => d !== null && d !== undefined && d >= 0 && d < TIMELINE_DAYS;
	const touches = (days.touches ?? []).filter(inWindow);
	const opens = (days.opens ?? []).filter(inWindow);
	if (touches.length === 0 && opens.length === 0) return undefined;
	return { days: TIMELINE_DAYS, touches, opens };
}

export function count(n: number, noun: string): string {
	return `${numberString(n)} ${n === 1 ? noun : `${noun}${noun.endsWith("ch") ? "es" : "s"}`}`;
}

export function ago(days: number | null | undefined): string {
	if (days === null || days === undefined) return "";
	if (days <= 0) return "today";
	if (days === 1) return "yesterday";
	return `${numberString(days)} days ago`;
}

export function money(amount: number | null | undefined): string {
	if (amount === null || amount === undefined) return "";
	return `$${Math.round(amount).toLocaleString("en-US")}`;
}

/** "Contacted" from CONTACTED; a badge that already reads as words stays as it is. */
export function statusWord(value: unknown): string {
	if (value === null || value === undefined) return "";
	const s = jqToString(value);
	if (s === "" || s === "null") return "";
	return s === s.toUpperCase() ? titlecase(s.replace(/_/g, " ")) : s;
}

/** The touches and the opens, as the meta line reads them. */
export function touchMeta(touch: TouchLine | null | undefined): string[] {
	if (!touch) return [];
	const touches = touch.touches;
	// A record that says zero sends has no opens to speak of; a record that
	// simply carries no send count (the retro's week table) still shows its opens.
	if (touches === 0) return ["no send logged"];
	const meta: string[] = [];
	if (touches !== null && touches !== undefined) meta.push(count(touches, "touch"));
	const tracked = touch.tracked;
	if (touch.opens === null || touch.opens === undefined) {
		meta.push("untracked");
	} else {
		meta.push(touch.opens === 0 ? "no opens yet" : count(touch.opens, "open"));
		if (touches && tracked !== null && tracked !== undefined && tracked < touches) {
			meta.push(`${numberString(tracked)} of ${numberString(touches)} tracked`);
		}
	}
	if (touch.replied) meta.push("replied");
	return meta;
}

/** The reply on the clock: when they answered, as days or as the date the mail carries. */
export function replyClock(touch: TouchLine | null | undefined): string {
	if (!touch) return "";
	if (ago(touch.daysSinceReply) !== "") return `replied ${ago(touch.daysSinceReply)}`;
	if (jqToString(alt(touch.lastReply, "")) !== "") return `replied ${jqToString(touch.lastReply)}`;
	return "";
}

/** The clock under the meta line: when it was sent, opened and answered. */
export function touchClock(touch: TouchLine | null | undefined): string {
	if (!touch) return "";
	const clock: string[] = [];
	const kind = jqToString(alt(touch.lastTouch, "")).toLowerCase();
	if (ago(touch.daysSinceSend) !== "") clock.push(`${kind === "" ? "sent" : kind} ${ago(touch.daysSinceSend)}`);
	if (ago(touch.daysSinceOpen) !== "") clock.push(`opened ${ago(touch.daysSinceOpen)}`);
	const reply = replyClock(touch);
	if (reply !== "") clock.push(reply);
	return clock.join(" · ");
}

export function recordCard(input: RecordInput): RecordStackItem {
	const lead = alt(input.lead, []).map((l) => jqToString(l)).filter((l) => l !== "");
	const meta: string[] = [...lead];
	const notes: string[] = [];
	if (input.deal) {
		const stage = jqToString(alt(input.deal.stage, ""));
		meta.push(stage === "" ? "no stage set" : stage, money(input.deal.amount) || jqToString(alt(input.deal.cash, "")));
		const close = jqToString(alt(input.deal.close, ""));
		if (close !== "") notes.push(`${input.deal.signed ? "signed" : "closes"} ${close}`);
	} else if (input.deal === null && input.touch === undefined) {
		meta.push("no deal on the record");
	}
	if (input.closed) {
		const reason = jqToString(alt(input.closed.reason, ""));
		if (reason !== "") meta.push(titlecase(reason.replace(/_/g, " ")));
	}
	// The counts and the clock share the meta line, so touches, opens and when
	// they happened read in one place; the mail's own sentence stays the note.
	// A drawn card keeps only the reply on the clock and sets the open right.
	meta.push(...touchMeta(input.touch));
	const timeline = timelineOf(input.days);
	const clock = timeline ? replyClock(input.touch) : touchClock(input.touch);
	if (clock !== "") meta.push(clock);
	const note = jqToString(alt(input.note, ""));
	if (note !== "") notes.push(note);
	const pills = (input.pills ?? []).filter((p) => p.text !== "");
	return {
		title: jqToString(input.title),
		url: input.url ?? undefined,
		badge: statusWord(input.badge) || undefined,
		badges: pills.length === 0 ? undefined : pills,
		timeline,
		aside: timeline ? openedAside(input.touch?.daysSinceOpen) : undefined,
		meta: meta.filter((m) => m !== ""),
		note: notes.length === 0 ? undefined : notes.join(" · "),
		callout: input.callout ?? undefined,
	};
}
