import {
	asciiUpcase,
	Card,
	EmptyRow,
	Eyebrow,
	Footer,
	List,
	ListRow,
	lpad,
	Masthead,
	Note,
	Records,
	type RecordsCell,
	RecordStack,
	type RecordStackItem,
	recordStackText,
	Row,
	spaces,
	StatStrip,
	type StatStripEntry,
	SubEyebrow,
	textRead,
	textSection,
	textTable,
	TitleCard,
	wrap,
} from "@atelic-action/ui/email";
import { renderEmail } from "@atelic-action/ui/email/render";
import { alt, fromDate, jqToString, numberString, shortDate, unindent, weekdayName, weekNumber } from "./jq";
import { DimLine, Link, type NeedsGroup, type NeedsItem, NeedsList, RosterLine, type WeekCell, WeekTable } from "./local";
import { money } from "./records";
import { hang } from "./text";
import type { RenderContext } from "./types";

/*
 * The Pipeline email: what needs Forni first, then the health of the funnel.
 * Reshaped 2026-10-07 (ATE-630) after he opened the W41 mail, met dozens of
 * MQL names, and could not tell which of them needed him: it was a to do list
 * problem wearing a report. So the mail is two things now. Needs You Now is
 * one numbered list in his own order, customers before proposals before
 * conversations before cold outreach: a named line for everything that needs
 * his judgment, replies owed among them, then a count for each kind of cold
 * touch with the people it counts in one sentence beneath, because a bare
 * "7" made him ask who the seven were (his read of the first mockup, the
 * same day). The count in the section's heading is the named lines alone.
 * Funnel Health is the strip, how many names entered and left each stage,
 * and the opens and responses of the last four send weeks, newest first,
 * each number with its change on the week before beside it.
 *
 * The runner, not the model, supplies the funnel, the groom, the named lines
 * (`needs`), the send weeks (`health`) and the other routines' fires
 * (`routines`): the sweep reads the groom's seven buckets now and seven days
 * ago off HubSpot's own entered dates, moves every stage and status the
 * record justifies, and the entrypoint folds all of it into the draft before
 * the render. The model writes the read and the names owed a touch.
 * Everything the email leaves out lives in the roster, which the runner
 * commits into the Atelic repo and the read card links as its last line
 * (roster_url); a run that could not push attaches it instead.
 *
 * What this replaced, for the record. From 2026-09-24 (ATE-551) the mail was
 * the state of the pipeline first and what the week owed second: the strip, a
 * card per listed stage with every company on the Company Cards IA (Forni,
 * 2026-09-29: a thirty day timeline, the counts, the open's age), the waiting
 * names as one linked sentence at each stage's foot, then This Week with a
 * card per person per kind of touch. Each tuning made a name easier to read
 * and none of them made the mail shorter, and the stage lists were the part
 * he stopped reading.
 */

/** A name owed a touch: a line of its own when a reply is owed, one of the people under a count otherwise. */
type Name = {
	person?: unknown;
	company?: unknown;
	contact_url?: string | null;
	company_url?: string | null;
	/** What the touch is and why it is owed; a reply's line says it, a counted name's does not. */
	note?: unknown;
	metrics?: { opens?: number | null } | null;
};
type Owed = {
	reply?: Name[] | null;
	bump?: Name[] | null;
	visit?: Name[] | null;
	first_touch?: Name[] | null;
	decide?: Name[] | null;
};
type LeadNote = { lead?: unknown; note?: unknown };
type FunnelStage = {
	key?: unknown;
	label?: unknown;
	now?: number | null;
	then?: number | null;
	delta?: number | null;
	pct?: number | null;
	/** The names that entered and left the stage this week; the mail counts them and prints none. */
	entered?: unknown[] | null;
	left?: unknown[] | null;
};
type Funnel = { from?: unknown; to?: unknown; stages?: FunnelStage[] | null } | null;
type Proposed = { kind?: unknown; name?: unknown; company?: unknown; url?: string | null; note?: unknown };
type Groom = {
	applied?: boolean | null;
	/** The stage moves and the status moves the groom made; the mail counts them and the roster names them. */
	companies?: unknown[] | null;
	contacts?: unknown[] | null;
	proposed?: Proposed[] | null;
} | null;

/**
 * One named line of the list, a sentence in four parts: who, what is owed,
 * by when, and a link. The line links twice (Forni, 2026-10-07): the name to
 * its HubSpot record (`url`) and the ticket key (`ref`, "ATE-633") to Linear
 * (`ref_url`). Either may be missing; a HubSpot hold has no ticket. `due` is
 * an ISO date. `amount` is a proposal's money, in dollars.
 */
type NeedLine = {
	who?: unknown;
	owed?: unknown;
	due?: unknown;
	url?: string | null;
	ref?: unknown;
	ref_url?: string | null;
	amount?: number | null;
};
/** A tier of named lines. `key` is one of NEED_TIERS; `label` overrides the label there. The runner sorts a tier's lines, soonest due first. */
type NeedTier = { key?: unknown; label?: unknown; lines?: NeedLine[] | null };
/** `first_touch_target` is the week's standing number of first touches, which the count is read against; absent, the line says only the count. */
type Needs = { tiers?: NeedTier[] | null; first_touch_target?: number | null } | null;

/**
 * One send week: the tracked sends, how many were opened and how many drew a
 * response, and the two rates in whole percent. The renderer works a rate
 * out of its two counts when the runner leaves it null, and it works out
 * every change itself from the week beneath, so a change can never disagree
 * with the two numbers it sits between.
 */
type SendWeek = {
	/** "2026-W38", which reads as W38. */
	week?: unknown;
	tracked?: number | null;
	opened?: number | null;
	rate?: number | null;
	responded?: number | null;
	respond_rate?: number | null;
};
/** The trailing send weeks in any order (the table sorts them newest first) and one sentence to call out when a rate has turned. */
type Health = { weeks?: SendWeek[] | null; flag?: string | null } | null;

/** A cloud routine other than Outreach and how its fires went this run: "Writeup: 2 of 2 fired". */
type Routine = { name?: unknown; fired?: number | null; total?: number | null; url?: string | null };

export type PipelineDraft = {
	preheader?: unknown;
	headline?: string[] | null;
	lede?: unknown;
	owed?: Owed | null;
	flags?: LeadNote[] | null;
	unverified?: LeadNote[] | null;
	not_in_block?: LeadNote[] | null;
	funnel?: Funnel;
	groom?: Groom;
	/** Where the runner committed the roster; empty when it rode as the attachment instead. */
	roster_url?: string | null;
	/** What the runner sent to the Outreach routine after the roster was placed; absent on a run from before 2026-10-06. */
	drafting?: Drafting;
	/** The named lines of Needs You Now, from the runner; absent on a run from before ATE-630, which still gets the counts. */
	needs?: Needs;
	/** The trailing send weeks, from the runner; absent on a run from before ATE-630. */
	health?: Health;
	/** The cloud routines beside Outreach, from the runner; Outreach itself is read off `drafting`. */
	routines?: Routine[] | null;
};

type Fire = {
	business?: unknown;
	touch?: unknown;
	/** fired, failed, dry run, or not fired. */
	outcome?: unknown;
	http_status?: number | null;
	session_url?: string | null;
	session_id?: unknown;
};
type Drafting = { note?: unknown; fires?: Fire[] | null } | null;

const TOUCH_WORD: Record<string, string> = { first_touch: "First touch", bump: "Bump" };

/**
 * One line per payload that did not reach the Outreach routine: the business,
 * linked to its cloud session when the API named one, then the touch and how
 * the fire went. From 2026-10-06 the card listed every payload, so Tuesday
 * knew which drafts to expect; a fire that went is only a name, though, and
 * the note above already counts them, so the ones that failed are the ones
 * that need Forni (2026-10-07, ATE-630).
 */
function misfireRecords(drafting: Drafting): RecordStackItem[] {
	const misfires = alt(drafting?.fires, []).filter((fire) => jqToString(alt(fire.outcome, "")) !== "fired");
	return misfires.map((fire) => {
		const touch = jqToString(alt(fire.touch, ""));
		const outcome = jqToString(alt(fire.outcome, ""));
		const status = fire.http_status === null || fire.http_status === undefined ? "" : `HTTP ${numberString(fire.http_status)}`;
		const sessionUrl = jqToString(alt(fire.session_url, ""));
		return {
			title: jqToString(fire.business),
			url: sessionUrl === "" ? null : sessionUrl,
			meta: [TOUCH_WORD[touch] ?? touch, outcome, status].filter((x) => x !== ""),
		};
	});
}

/* ---------- needs you now ---------- */

/**
 * The order of the list, Forni's own (2026-10-07, ATE-630): paying customers
 * in build, then trade customers in build, then customers in operate, then
 * open proposals, then warm SQLs in a live conversation. Inside a tier the
 * soonest due date leads, which the runner sorts. A tier with no lines stays
 * out. A tier whose key is not here follows these in the order it arrived,
 * so a new tier in the runner shows before the renderer learns its place.
 */
const NEED_TIERS: { key: string; label: string }[] = [
	{ key: "paying_build", label: "Paying Customers in Build" },
	{ key: "trade_build", label: "Trade Customers in Build" },
	{ key: "operate", label: "Customers in Operate" },
	{ key: "proposal", label: "Open Proposals" },
	{ key: "warm_sql", label: "Warm SQLs in a Live Conversation" },
];

/**
 * The cold end of the list, a count per kind of touch with its people named
 * beneath, in Forni's order (2026-10-07, ATE-630, reordered the same day on
 * his read of the first mockup): second touches to people who opened, first
 * touches, visits, second touches to people who have not opened, and the
 * names to close or keep last. The words are his too. A bump is the second
 * email at about seven days, and "bump" read to him as possibly a second
 * bump, so the line says second touch; "decide" said nothing, so the line
 * says what the decision is. Until W41 the mail carried a card per person
 * here, first touches leading (2026-09-29), and until W40 replies led;
 * replies are named lines now, under the warm SQLs.
 */
const OWED_COUNTS: {
	label: string;
	names: (owed: Owed) => Name[];
	/** The kind of fire that drafts this touch, when the Outreach routine drafts it. */
	drafted?: string;
	/** True on the line that is read against the week's target. */
	target?: boolean;
	tail?: (count: number) => string;
}[] = [
	{ label: "Second touch to people who opened", names: (owed) => bumps(owed, true), drafted: "bump" },
	{ label: "First touches", names: (owed) => alt(owed.first_touch, []), drafted: "first_touch", target: true },
	{ label: "Visits", names: (owed) => alt(owed.visit, []), tail: () => ", Thursday walkabout" },
	{ label: "Second touch to people who have not opened", names: (owed) => bumps(owed, false), drafted: "bump" },
	{
		label: "Close or keep",
		names: (owed) => alt(owed.decide, []),
		tail: (count) => ` ${count === 1 ? "name" : "names"} past the three week clock`,
	},
];

/** The bumps owed to people who opened a send, or to the ones who did not; an untracked send counts as not opened. */
function bumps(owed: Owed, opened: boolean): Name[] {
	return alt(owed.bump, []).filter((name) => alt(name.metrics?.opens, 0) > 0 === opened);
}

/**
 * What the fires of a kind of touch say about its drafts: "ready" when every
 * one fired, "partial" when one did not, and "none" when the runner fired
 * nothing of the kind, so a line never promises a draft nobody asked for.
 */
function draftState(drafting: Drafting, touch: string): "none" | "ready" | "partial" {
	const fires = alt(drafting?.fires, []).filter((fire) => jqToString(alt(fire.touch, "")) === touch);
	if (fires.length === 0) return "none";
	return fires.every((fire) => jqToString(alt(fire.outcome, "")) === "fired") ? "ready" : "partial";
}

/** "Person, Company", or whichever of the two the record has. */
function whoOf(name: Name): string {
	return [jqToString(alt(name.person, "")), jqToString(alt(name.company, ""))].filter((part) => part !== "").join(", ");
}

/** The person's record, or the company's when the person has none. */
function recordOf(name: Name): string | null {
	return jqToString(alt(name.contact_url, "")) || jqToString(alt(name.company_url, "")) || null;
}

/** "Due Thu 10-08." from an ISO date; anything else is said as the runner wrote it. */
function dueText(due: unknown): string {
	const day = jqToString(alt(due, ""));
	if (day === "") return "";
	const at = /^\d{4}-\d{2}-\d{2}$/.test(day) ? fromDate(`${day}T00:00:00Z`) : Number.NaN;
	if (Number.isNaN(at)) return `Due ${day}.`;
	return `Due ${weekdayName(at)} ${day.slice(5)}.`;
}

/** What is owed as a sentence, closed with a period when the runner left it open. */
function sentence(text: string): string {
	return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * A named line: "SkySpec: audit GA4 and Tag Manager, update the writeup. Due
 * Thu 10-08. ATE-633." The money follows the name on a proposal. The name
 * links to the record and the key to its ticket.
 */
function needItem(line: NeedLine): NeedsItem {
	const ref = jqToString(alt(line.ref, ""));
	const cash = money(line.amount);
	const owed = jqToString(alt(line.owed, ""));
	const due = dueText(line.due);
	return {
		lead: jqToString(line.who),
		url: line.url,
		rest: `${cash === "" ? "" : `, ${cash}`}${owed === "" && due === "" ? "" : ":"}${owed === "" ? "" : ` ${sentence(owed)}`}`,
		due: due === "" ? undefined : due,
		ref: ref === "" ? undefined : ref,
		refUrl: ref === "" ? null : line.ref_url,
	};
}

/** A reply owed, as a named line: the person and the company, the model's note as what is owed, a link to the contact. */
function replyItem(name: Name): NeedsItem {
	const note = jqToString(alt(name.note, ""));
	return { lead: whoOf(name), url: recordOf(name), rest: note === "" ? "" : `: ${sentence(note)}` };
}

/**
 * The named part of the list: the tiers in order, each under its label, then
 * the replies owed directly under the warm SQLs (Forni, 2026-10-07: a reply
 * is a line with a person on it, never a count), then any tier the renderer
 * does not know. Empty groups drop.
 */
function namedGroups(draft: PipelineDraft): NeedsGroup[] {
	const tiers = alt(draft.needs?.tiers, []);
	const known = NEED_TIERS.map((tier) => tier.key);
	const group = (tier: NeedTier): NeedsGroup => {
		const fallback = NEED_TIERS.find((t) => t.key === jqToString(alt(tier.key, "")))?.label ?? jqToString(alt(tier.key, ""));
		const label = jqToString(alt(tier.label, ""));
		return { label: label === "" ? fallback : label, items: alt(tier.lines, []).map(needItem) };
	};
	return [
		...NEED_TIERS.flatMap((tier) => tiers.filter((t) => jqToString(alt(t.key, "")) === tier.key)).map(group),
		{ label: "Replies Owed", items: alt(draft.owed?.reply, []).map(replyItem) },
		...tiers.filter((t) => !known.includes(jqToString(alt(t.key, "")))).map(group),
	].filter((g) => g.items.length > 0);
}

/**
 * The count lines, one per kind of cold touch with anyone owed it; a zero
 * says nothing. "First touches: 5 drafts ready of 15 a week" reads the count,
 * what the routine did about it, and the week's target, in that order.
 */
function countGroup(draft: PipelineDraft): NeedsGroup[] {
	const owed = alt(draft.owed, {});
	const target = draft.needs?.first_touch_target;
	const items = OWED_COUNTS.map((line) => ({ line, names: line.names(owed) }))
		.filter(({ names }) => names.length > 0)
		.map(({ line, names }) => {
			const count = names.length;
			const state = line.drafted === undefined ? "none" : draftState(draft.drafting ?? null, line.drafted);
			const ready = state === "ready" ? (count === 1 ? " draft ready" : " drafts ready") : "";
			const against = line.target && target !== null && target !== undefined ? ` of ${numberString(target)} a week` : "";
			const partial = state === "partial" ? ", not every draft fired" : "";
			return {
				lead: line.label,
				rest: `: ${numberString(count)}${ready}${against}${partial}${line.tail === undefined ? "" : line.tail(count)}`,
				names: names.map((name) => ({ text: whoOf(name), url: recordOf(name) })),
			};
		});
	return items.length === 0 ? [] : [{ label: "Cold Touches", items }];
}

function lineCount(groups: NeedsGroup[]): number {
	return groups.reduce((sum, group) => sum + group.items.length, 0);
}

/** The section's heading. Its count is the named lines alone, the ones that need his judgment; the cold touches are drafted for him. */
function needsHeading(named: NeedsGroup[]): string {
	return named.length === 0 ? "Needs You Now" : `Needs You Now · ${numberString(lineCount(named))}`;
}

/**
 * The list's plain text twin: each group under its label in upper case, each
 * line under its number with a hanging indent, each link on a line of its
 * own beneath (the record, then the ticket), since a url is the one token the
 * wrap cannot break, and a count's people a line each, unlinked.
 */
function needsText(groups: NeedsGroup[]): string {
	const width = numberString(lineCount(groups)).length + 2;
	let n = 0;
	return groups
		.map((group) => {
			const lines = group.items.map((item) => {
				n += 1;
				const text = `${item.lead}${item.rest}${item.due ? ` ${item.due}` : ""}${item.ref ? ` ${item.ref}.` : ""}`;
				const urls = [item.url, item.refUrl].map((url) => jqToString(alt(url, ""))).filter((url) => url !== "");
				return [
					hang(lpad(`${numberString(n)}.`, width - 1), text, width),
					...urls.map((url) => `${spaces(2 + width)}${url}\n`),
					...alt(item.names, []).map((name) => hang("", name.text, width)),
				].join("");
			});
			return `${wrap(asciiUpcase(group.label))}\n${lines.join("")}`;
		})
		.join("\n");
}

/* ---------- funnel health ---------- */

/** The strip: the funnel Forni works, each stage with its week over week change. New stays off it. */
const STRIP_STAGES = ["lead", "mql", "sql", "opportunity", "customer", "closed"];

function stripStages(funnel: Funnel): FunnelStage[] {
	return alt(funnel?.stages, []).filter((stage) => STRIP_STAGES.includes(jqToString(stage.key)));
}

function signed(n: number): string {
	return n > 0 ? `+${numberString(n)}` : numberString(n);
}

/**
 * "+6 (15%)", "+9 (from 0)" when the stage was empty a week ago so no
 * percentage exists, or "0" when nothing moved. The sweep leaves pct null
 * exactly when last week's count was zero (Forni asked on 2026-09-29 why MQL
 * and SQL showed no percentage; both had been empty until the 09-22 reset).
 */
function deltaText(stage: FunnelStage): string {
	const delta = alt(stage.delta, 0);
	const pct = stage.pct;
	if (delta === 0) return "0";
	if (pct === null || pct === undefined) return alt(stage.then, 0) === 0 ? `${signed(delta)} (from 0)` : signed(delta);
	return `${signed(delta)} (${numberString(Math.abs(pct))}%)`;
}

function stripStats(funnel: Funnel): StatStripEntry[] {
	return stripStages(funnel).map((stage) => ({ n: alt(stage.now, 0), label: jqToString(stage.label), delta: deltaText(stage) }));
}

function plural(count: number, noun: string): string {
	if (count === 1) return `${numberString(count)} ${noun}`;
	return `${numberString(count)} ${noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;
}

/** How many names entered a stage this week and how many left it, as two counts. */
function flow(stage: FunnelStage): { entered: number; left: number } {
	return { entered: alt(stage.entered, []).length, left: alt(stage.left, []).length };
}

/** A count in a table cell, quiet when it is zero. */
function countCell(n: number): RecordsCell {
	return { value: numberString(n), mono: true, muted: n === 0 };
}

/** The send weeks, newest first, whatever order the runner sent them in. */
function healthWeeks(health: Health): SendWeek[] {
	return [...alt(health?.weeks, [])].sort((a, b) => jqToString(alt(b.week, "")).localeCompare(jqToString(alt(a.week, ""))));
}

/** "W38" from "2026-W38"; anything else as the runner wrote it. */
function weekLabel(week: SendWeek): string {
	const raw = jqToString(alt(week.week, ""));
	return /^\d{4}-W\d{2}$/.test(raw) ? `W${weekNumber(raw)}` : raw;
}

/** A rate in whole percent: the runner's own when it sent one, the two counts' otherwise, nothing when there is no send to divide by. */
function rateOf(given: number | null | undefined, part: number | null | undefined, whole: number | null | undefined): number | null {
	if (given !== null && given !== undefined) return given;
	if (part === null || part === undefined || whole === null || whole === undefined || whole === 0) return null;
	return Math.round((part * 100) / whole);
}

/** A week's five numbers in the table's order: tracked, opened, open rate, responded, respond rate. */
function weekNumbers(week: SendWeek): (number | null)[] {
	return [
		week.tracked ?? null,
		week.opened ?? null,
		rateOf(week.rate, week.opened, week.tracked),
		week.responded ?? null,
		rateOf(week.respond_rate, week.responded, week.tracked),
	];
}

/**
 * The table's rows. Each number carries its change on the week before in
 * brackets, "33 (+18)" for a count and "58% (+3%)" for a rate, which is the
 * plain difference of the two percentages (Forni, 2026-10-07: no change
 * column and never the word points). The oldest row has no week beneath it
 * and shows no change.
 */
function weekRows(weeks: SendWeek[]): WeekCell[][] {
	const numbers = weeks.map(weekNumbers);
	return weeks.map((week, row) => [
		{ value: weekLabel(week) },
		...numbers[row].map((now, i) => {
			const unit = i === 2 || i === 4 ? "%" : "";
			if (now === null) return { value: "" };
			const before = numbers[row + 1]?.[i];
			return {
				value: `${numberString(now)}${unit}`,
				change: before === null || before === undefined ? undefined : `(${signed(now - before)}${unit})`,
				tone: before === null || before === undefined || now === before ? undefined : now > before ? ("up" as const) : ("down" as const),
			};
		}),
	]);
}

const WEEK_COLUMNS = ["Week", "Tracked", "Opened", "Open Rate", "Responded", "Respond Rate"];

/* ---------- cloud routines ---------- */

/**
 * One row per cloud routine: how many of its payloads fired, and how many
 * there were (Forni, 2026-10-07: the card was Drafting, and Outreach is not
 * the only routine the week runs on; a small table on his next read, where
 * it had been a sentence per routine). Outreach is counted off the fires the
 * runner recorded; the rest arrive counted.
 */
function routineRows(draft: PipelineDraft): { name: string; url?: string | null; fired: number; total: number }[] {
	const fires = alt(draft.drafting?.fires, []);
	const outreach = draft.drafting
		? [{ name: "Outreach", fired: fires.length - misfireRecords(draft.drafting).length, total: fires.length }]
		: [];
	const others = alt(draft.routines, []).map((routine) => ({
		name: jqToString(routine.name),
		url: routine.url,
		fired: alt(routine.fired, 0),
		total: alt(routine.total, 0),
	}));
	return [...outreach, ...others];
}

const ROUTINE_COLUMNS = ["Routine", "Fired", "Total"];

/** The runner's own sentence about Outreach, kept only when a fire did not go, which is when it explains something. */
function draftingNote(drafting: Drafting): string {
	const fires = alt(drafting?.fires, []);
	if (fires.length > 0 && misfireRecords(drafting).length === 0) return "";
	return jqToString(alt(drafting?.note, ""));
}

/** What the groom could not settle plus what the model flagged: one line each. */
function leftForYou(draft: PipelineDraft): string[] {
	const proposed = alt(draft.groom?.proposed, []).map((p) => {
		const who = [jqToString(p.name), jqToString(alt(p.company, ""))].filter((x) => x !== "").join(", ");
		return `${who}: ${jqToString(alt(p.note, ""))}`.replace(/: $/, "");
	});
	const flags = alt(draft.flags, []).map((f) => jqToString(f.lead));
	return [...proposed, ...flags].filter((line) => line !== "");
}

function groomLine(groom: Groom): string {
	const stages = alt(groom?.companies, []).length;
	const contacts = alt(groom?.contacts, []).length;
	if (groom === null || groom === undefined) return "The groom did not run this week.";
	if (groom.applied === false) {
		return `Read only this run: ${plural(stages, "stage move")} and ${plural(contacts, "status move")} were computed and nothing was written.`;
	}
	if (stages === 0 && contacts === 0) return "The portal already said what was true; nothing moved.";
	return `The groom moved ${plural(stages, "company")} and ${plural(contacts, "contact")} to match what the record already showed.`;
}

/* ---------- html ---------- */

export function pipelineHTML(input: unknown, context: RenderContext): string {
	const draft = input as PipelineDraft;
	const funnel = draft.funnel ?? null;
	const named = namedGroups(draft);
	const needs = [...named, ...countGroup(draft)];
	const weeks = healthWeeks(draft.health ?? null);
	const flag = jqToString(alt(draft.health?.flag, ""));
	const left = leftForYou(draft);
	const rosterUrl = jqToString(alt(draft.roster_url, ""));
	const routines = routineRows(draft);
	const note = draftingNote(draft.drafting ?? null);
	const misfires = misfireRecords(draft.drafting ?? null);

	return renderEmail({
		title: `${context.week} Pipeline`,
		preheader: jqToString(alt(draft.preheader, "")),
		children: (
			<>
				<Masthead
					title="Pipeline"
					meta={`Week ${weekNumber(context.week)} · ${shortDate(context.monday)} to ${shortDate(context.sunday)}`}
				/>
				<TitleCard
					eyebrowText="The read"
					headlineLines={alt(draft.headline, [])}
					lede={jqToString(alt(draft.lede, ""))}
					stats={rosterUrl === "" ? undefined : <RosterLine url={rosterUrl} />}
				/>

				<Eyebrow text={needsHeading(named)} strong={true} />
				<Card>
					{needs.length === 0 ? (
						<EmptyRow text="Nothing needs you this week." />
					) : (
						<Row last={true}>
							<NeedsList groups={needs} />
						</Row>
					)}
				</Card>

				<Eyebrow text="Funnel Health" strong={true} />
				<Card>
					{funnel === null ? (
						<EmptyRow text="The portal sweep carried no funnel this run." />
					) : (
						<>
							<Row last={false}>
								<StatStrip stats={stripStats(funnel)} />
							</Row>
							<SubEyebrow text="In and Out This Week" />
							<Row last={true}>
								<Records
									columns={[{ label: "Stage" }, { label: "In", right: true, keep: true }, { label: "Out", right: true, keep: true }]}
									rows={stripStages(funnel).map((stage) => [
										{ value: jqToString(stage.label) },
										countCell(flow(stage).entered),
										countCell(flow(stage).left),
									])}
								/>
							</Row>
						</>
					)}
				</Card>

				{weeks.length === 0 ? null : (
					<>
						<Eyebrow text="Opens and Responses by Week" />
						<Card>
							{flag === "" ? null : <Note eyebrowText="Flag" text={flag} accented={true} last={false} />}
							<Row last={true}>
								<WeekTable columns={WEEK_COLUMNS} rows={weekRows(weeks)} />
							</Row>
						</Card>
					</>
				)}

				{routines.length === 0 ? null : (
					<>
						<Eyebrow text="Cloud Routines" strong={true} />
						<Card>
							<Row last={note === "" && misfires.length === 0}>
								<Records
									columns={ROUTINE_COLUMNS.map((label, i) => ({ label, right: i > 0, keep: true }))}
									rows={routines.map((routine) => [
										{ value: routine.name, html: <Link text={routine.name} url={routine.url} /> },
										countCell(routine.fired),
										{ value: numberString(routine.total), mono: true },
									])}
								/>
							</Row>
							{note === "" ? null : (
								<Row last={misfires.length === 0}>
									<DimLine text={note} />
								</Row>
							)}
							{misfires.length === 0 ? null : (
								<>
									<SubEyebrow text={`Did Not Fire · ${numberString(misfires.length)}`} />
									<Row last={true}>
										<RecordStack records={misfires} />
									</Row>
								</>
							)}
						</Card>
					</>
				)}

				<Eyebrow text="The groom" strong={true} />
				<Card>
					<Row last={left.length === 0}>
						<DimLine text={groomLine(draft.groom ?? null)} />
					</Row>
					{left.length === 0 ? null : (
						<>
							<SubEyebrow text={`Left for you · ${numberString(left.length)}`} />
							<Row last={true}>
								<List fontSize="14px">
									{left.map((line, index) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: a line's position is its identity
										<ListRow key={index}>{line}</ListRow>
									))}
								</List>
							</Row>
						</>
					)}
				</Card>

				<Footer meta={context.meta} />
			</>
		),
	});
}

/* ---------- plain text ---------- */

export function pipelineText(input: unknown, context: RenderContext): string {
	const draft = input as PipelineDraft;
	const number = weekNumber(context.week);
	const funnel = draft.funnel ?? null;
	const named = namedGroups(draft);
	const needs = [...named, ...countGroup(draft)];
	const weeks = healthWeeks(draft.health ?? null);
	const flag = jqToString(alt(draft.health?.flag, ""));
	const left = leftForYou(draft);

	let out = `ATELIC · PIPELINE · WEEK ${number} · ${shortDate(context.monday)} TO ${shortDate(context.sunday)}\n\n`;
	out += `${asciiUpcase(alt(draft.headline, []).join("\n"))}\n`;
	const lede = unindent(jqToString(alt(draft.lede, "")));
	if (lede !== "") out += `\n${textRead(lede)}`;
	const rosterUrl = jqToString(alt(draft.roster_url, ""));
	if (rosterUrl !== "") out += `\nThe full read is in the roster: ${rosterUrl}\n`;

	out += textSection(needsHeading(named));
	out += needs.length === 0 ? "  Nothing needs you this week.\n" : needsText(needs);

	out += textSection("Funnel Health");
	if (funnel === null) {
		out += "  The portal sweep carried no funnel this run.\n";
	} else {
		const rows = stripStages(funnel).map((stage) => [
			jqToString(stage.label),
			numberString(alt(stage.now, 0)),
			deltaText(stage),
			numberString(flow(stage).entered),
			numberString(flow(stage).left),
		]);
		out += `${textTable(["Stage", "Now", "Change", "In", "Out"], rows, [1, 3, 4])}\n`;
	}
	if (weeks.length > 0) {
		out += "\nOpens and Responses by Week\n";
		if (flag !== "") out += `${wrap(`Flag: ${flag}`)}\n\n`;
		const rows = weekRows(weeks).map((cells) => cells.map((cell) => `${cell.value}${cell.change ? ` ${cell.change}` : ""}`));
		out += `${textTable(WEEK_COLUMNS, rows, [1, 2, 3, 4, 5])}\n`;
	}

	const routines = routineRows(draft);
	if (routines.length > 0) {
		const note = draftingNote(draft.drafting ?? null);
		const misfires = misfireRecords(draft.drafting ?? null);
		out += textSection("Cloud Routines");
		const rows = routines.map((routine) => [routine.name, numberString(routine.fired), numberString(routine.total)]);
		out += `${textTable(ROUTINE_COLUMNS, rows, [1, 2])}\n`;
		if (note !== "") out += `\n${wrap(note)}\n`;
		if (misfires.length > 0) out += `\nDid Not Fire · ${numberString(misfires.length)}\n${recordStackText(misfires)}\n`;
	}

	out += textSection("The Groom");
	out += `${wrap(groomLine(draft.groom ?? null))}\n`;
	if (left.length > 0) {
		out += `\nLeft for you · ${numberString(left.length)}\n${left.map((line) => wrap(line)).join("\n")}\n`;
	}

	out += `\n\n${context.meta}\n`;
	return out;
}
