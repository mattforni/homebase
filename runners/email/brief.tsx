import { Fragment, type ReactNode } from "react";
import {
	asciiDowncase,
	asciiUpcase,
	Badge,
	Card,
	type Day,
	DayStrip,
	EmptyRow,
	Eyebrow,
	Footer,
	GroupRow,
	lpad,
	Masthead,
	Note,
	ReadBlock,
	RecordStack,
	type RecordStackItem,
	Records,
	type RecordsCell,
	type RecordsColumn,
	Row,
	recordStackText,
	rpad,
	Scoreboard,
	StatStrip,
	SubEyebrow,
	TargetRow,
	textRead,
	textSection,
	textTable,
	textTarget,
	TitleCard,
	WhatMoved,
	wrap,
} from "@atelic-action/ui/email";
import { renderEmail } from "@atelic-action/ui/email/render";
import {
	alt,
	fromDate,
	isoDate,
	jqToString,
	num,
	numberString,
	rangeOf,
	slice,
	titlecase,
	two,
	unindent,
	weekdayName,
	weekNumber,
	word,
} from "./jq";
import { RecordsRow, SessionsRow, SpacerRow } from "./local";
import { recordCard } from "./records";
import { hang } from "./text";
import type { Page, RenderContext } from "./types";

/*
 * The Retro email, ported from the jq renderer it replaced (git history,
 * 4985f1a9). An overview card
 * holding every target at a glance and what moved, then one card per area,
 * each opening on its read. The sessions and the day strip are built from
 * strava.json here, never from the model, so the only numbers the model
 * supplies are the graded coverage counts.
 *
 * The plain text half was held to the jq twin byte for byte, and the goldens
 * in tst/ are that agreement frozen, so a change to a space here changes a
 * golden too.
 */

type CoverageRow = { modality?: unknown; logged?: unknown; target?: unknown; note?: unknown };
type TakeoutRow = { day?: unknown; vehicle?: unknown };
type MovedRow = { subject?: unknown; event?: unknown };
type AtelicCoverageRow = { measure?: unknown; logged?: unknown; target?: unknown };

type Activity = {
	name?: string | null;
	sportType?: string | null;
	startDateLocal?: string | null;
	distanceMi?: number | null;
	movingMin?: number | null;
	athleteCount?: number | null;
};

type FunnelRow = {
	company?: unknown;
	funnel?: unknown;
	status?: unknown;
	kind?: unknown;
	touches?: unknown;
	opens?: unknown;
	replied?: unknown;
	stage?: string | null;
	cash?: string | null;
	reason?: unknown;
	lastTouch?: unknown;
	lastReply?: unknown;
	/** A sentence the pull adds to a row it wants read twice (a half applied close). */
	note?: unknown;
};

export type BriefDraft = {
	headline?: unknown;
	coverage?: CoverageRow[] | null;
	whatMoved?: MovedRow[] | null;
	whatMovedNote?: unknown;
	movementRead?: unknown;
	takeout?: TakeoutRow[] | null;
	takeoutRead?: unknown;
	atelicRead?: unknown;
	blindSpots?: unknown;
	strava?: Activity[] | null;
	atelic?: {
		/** The funnel's stage names in funnel order, from the pull. */
		stages?: string[] | null;
		coverage?: AtelicCoverageRow[] | null;
		openLeads?: FunnelRow[] | null;
		opportunities?: FunnelRow[] | null;
		closedLeads?: FunnelRow[] | null;
	} | null;
	/* The planning pass: the model's keys (prompt.md, The Shape). */
	board?: BoardRow[] | null;
	money?: {
		read?: unknown;
		rows?: MoneyRow[] | null;
		deletes?: DeleteRow[] | null;
		trips?: TripMemo[] | null;
	} | null;
	inbox?: { rows?: InboxRow[] | null } | null;
	work?: { read?: unknown; flags?: FlagRow[] | null; unplaced?: UnplacedRow[] | null } | null;
	calendar?: { read?: unknown; findings?: Finding[] | null } | null;
	tasks?: { read?: unknown; rows?: TaskRow[] | null } | null;
	/* The entrypoint's keys, merged in after the model runs: data, never prose. */
	spend?: { personal?: BudgetSpend | null; atelic?: BudgetSpend | null } | null;
	applied?: Applied | null;
	pulls?: Pull[] | null;
};

/* ---------- the week, derived ---------- */

/** Strava's sport types in the words the week is graded in. */
const KINDS: Record<string, string> = {
	Run: "Run",
	TrailRun: "Run",
	VirtualRun: "Run",
	WeightTraining: "Lift",
	Yoga: "Yoga",
	RockClimbing: "Climb",
	Walk: "Walk",
	Hike: "Hike",
	Ride: "Ride",
	Swim: "Swim",
};

/**
 * PT is not a lift. It is logged as WeightTraining under the name "2026 PT"
 * or "2026 PT Achilles", so it is matched on the name, never the sport type,
 * and graded against its own target (Forni, W41, when the retro counted a PT
 * session as the week's one lift).
 */
const PT_NAME = /^(\d{4}\s+)?PT\b(?!\.)/;

/** The sport types a PT session is logged under; a Run named "PT Reyes" stays a run. */
const PT_SPORTS = new Set(["WeightTraining", "Workout"]);

function kindOf(activity: Activity): string {
	if (PT_SPORTS.has(alt(activity.sportType, "")) && PT_NAME.test(cleanName(activity).trim())) return "PT";
	const mapped = KINDS[alt(activity.sportType, "")];
	return mapped === undefined ? alt(activity.sportType, "Session") : mapped;
}

/**
 * The same test the prompt grades by: a run Strava matched other athletes
 * into, or one whose name says who it was with.
 */
function isSocial(activity: Activity): boolean {
	if (kindOf(activity) !== "Run") return false;
	return alt(activity.athleteCount, 1) >= 2 || /diego|drc|sprc/i.test(alt(activity.name, ""));
}

/** Session names lose their leading emoji; the table is for reading. */
function cleanName(activity: Activity): string {
	return alt(activity.name, "").replace(/^[^A-Za-z0-9'"(]+/, "");
}

type Session = {
	day: string;
	date: string;
	name: string;
	kind: string;
	social: boolean;
	minutes: number;
	miles: number | null;
};

function sessions(draft: BriefDraft): Session[] {
	const activities = [...alt(draft.strava, [])];
	activities.sort((a, b) => {
		const left = alt(a.startDateLocal, "");
		const right = alt(b.startDateLocal, "");
		return left < right ? -1 : left > right ? 1 : 0;
	});
	return activities.map((activity) => {
		const date = slice(alt(activity.startDateLocal, ""), 0, 10);
		const miles = alt(activity.distanceMi, 0);
		return {
			day: weekdayName(fromDate(`${date}T00:00:00Z`)),
			date,
			name: cleanName(activity),
			kind: kindOf(activity),
			social: isSocial(activity),
			minutes: alt(activity.movingMin, 0),
			miles: miles > 0 ? miles : null,
		};
	});
}

function days(monday: string, week: Session[]): Day[] {
	const start = fromDate(`${monday}T00:00:00Z`);
	return rangeOf(7).map((offset) => {
		const at = start + offset * 86400;
		const date = isoDate(at);
		return {
			label: weekdayName(at),
			entries: week
				.filter((session) => session.date === date)
				.map((session) => ({
					name: session.kind,
					strong: session.social,
					badge: session.social ? "S" : "",
				})),
		};
	});
}

function rangeLine(monday: string, sunday: string): string {
	const start = fromDate(`${monday}T00:00:00Z`);
	return `${weekdayName(start)}, ${monday} to ${weekdayName(start + 6 * 86400)}, ${sunday}`;
}

/* ---------- the targets ---------- */

type Target = { label: string; logged: number; target: number | null; note: string };

/** A label as Title Case, an acronym (PT) kept in capitals. */
function modalityLabel(value: unknown): string {
	// Split the way titlecase does (underscores are spaces) so the words line up.
	const acronyms = jqToString(alt(value, "")).replace(/_/g, " ").split(" ");
	return titlecase(value)
		.split(" ")
		.map((word, index) => (/^[A-Z]{2,}$/.test(acronyms[index] ?? "") ? acronyms[index] : word))
		.join(" ");
}

/** The model's coverage, with its note. */
function movementTargets(draft: BriefDraft): Target[] {
	return alt(draft.coverage, []).map((row) => ({
		label: modalityLabel(row.modality),
		logged: num(row.logged),
		target: num(row.target),
		note: jqToString(alt(row.note, "")),
	}));
}

/** Takeout as a bare count: nothing measures it. */
function takeoutTarget(draft: BriefDraft): Target {
	const orders = alt(draft.takeout, []);
	return {
		label: "Takeout",
		logged: orders.length,
		target: null,
		note:
			orders.length === 0
				? "No confirmed orders"
				: orders
						.map((order) => `${jqToString(alt(order.day, ""))} ${jqToString(alt(order.vehicle, ""))}`)
						.join(" · "),
	};
}

/** The outreach measures from HubSpot, each graded against its target. */
function atelicTargets(draft: BriefDraft): Target[] {
	return alt(draft.atelic?.coverage, []).map((row) => {
		const logged = num(row.logged);
		const target = num(row.target);
		return {
			label: titlecase(row.measure),
			logged,
			target,
			note: logged >= target ? "Target met" : `${word(target - logged)} short`,
		};
	});
}

function graded(draft: BriefDraft): Target[] {
	return [...movementTargets(draft), ...atelicTargets(draft)];
}

function verdict(draft: BriefDraft): string {
	const all = graded(draft);
	if (all.length === 0) return "No targets graded.";
	const hit = all.filter((row) => row.target !== null && row.logged >= row.target).length;
	return `${word(hit)} of ${asciiDowncase(word(all.length))} targets hit.`;
}

/* ---------- the funnel ---------- */
/*
 * The stages and their order come from the pull, as `stages` on the week
 * (Lead, MQL, SQL, Opportunity, Customer, Closed today), and which one a
 * company sits in comes from the pull too, as `funnel` on every row. The
 * rule that decides both lives with the pull, in the Atelic repo, and this
 * page keeps no list of its own: it only prints what it is given. A row that
 * carries no stage, or one the week does not name, is listed under No Stage
 * after the rest, so it is still on the page and nobody guesses where it
 * belongs.
 */

const NO_STAGE = "No Stage";

/** A stage name too wide for the stat strip, shortened; any other reads as it is. */
const STAGE_LABELS: Record<string, string> = { Opportunity: "Oppty" };

/** The week's stage names, in funnel order. */
function stageNames(draft: BriefDraft): string[] {
	return alt(draft.atelic?.stages, []).filter((name): name is string => typeof name === "string");
}

type Staged = FunnelRow & { funnel: string; record: (row: FunnelRow) => RecordStackItem };

function staged(
	rows: FunnelRow[] | null | undefined,
	record: (row: FunnelRow) => RecordStackItem,
	names: string[],
): Staged[] {
	return alt(rows, []).map((row) => ({
		...row,
		funnel: typeof row.funnel === "string" && names.includes(row.funnel) ? row.funnel : NO_STAGE,
		record,
	}));
}

/** Every row with its stage, and the card its own table would draw for it. */
function funnel(draft: BriefDraft, names: string[]): Staged[] {
	const atelic = alt(draft.atelic, {});
	return [
		...staged(atelic.openLeads, leadRecord, names),
		...staged(atelic.opportunities, dealRecord, names),
		...staged(atelic.closedLeads, closedRecord, names),
	];
}

/*
 * Every stage lists its companies on a RecordStack, the name on its own line
 * so it wraps instead of squashing on a phone, the way the plumber lists its
 * stages. A fixed column table left the name a letter wide at phone width.
 * A lead reads its status as the badge, its counts on the meta line, and its
 * last touch as the note; a deal reads its stage and its cash; a closed lead
 * reads its outcome and its reason.
 */

/*
 * All three go through the shared card in records.ts, the same one the
 * Pipeline mail uses, so a company reads the same way in both mails
 * (Forni, 2026-09-29). The retro's rows carry counts as strings and no day
 * clock, so the card gets what the week table knows and nothing invented.
 */

/** "Wed 10-07" from 2026-10-07, the way the retro writes a day; "" for none. */
function replyDay(row: FunnelRow): string {
	const date = jqToString(alt(row.lastReply, ""));
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
	return `${weekdayName(fromDate(`${date}T00:00:00Z`))} ${slice(date, 5)}`;
}

/**
 * The week's last touch, named by the pull (First, Bump, Reply, Drop off) and
 * shown as it is; a draft from before the pull carried one falls back to the
 * week's touch kinds, title cased the way it always was.
 */
function lastTouchOf(row: FunnelRow): string {
	const named = jqToString(alt(row.lastTouch, ""));
	const kind = titlecase(alt(row.kind, ""));
	return named !== "" ? named : kind === "None" ? "" : kind;
}

function leadRecord(row: FunnelRow): RecordStackItem {
	const kind = lastTouchOf(row);
	const touches = row.touches === null || row.touches === undefined ? null : Number(row.touches);
	const opens = row.opens === null || row.opens === undefined || row.opens === "-" ? null : Number(row.opens);
	const replied = replyDay(row);
	// The pull's own note on a row (a half applied close) rides on the muted
	// line under the card, after the last touch.
	const notes = [kind === "" ? "" : `Last touch: ${kind}`, jqToString(alt(row.note, ""))].filter((n) => n !== "");
	return recordCard({
		title: row.company,
		badge: row.status,
		// A dated reply rides on the clock ("replied Wed 10-07"); the bare
		// word is only for a row that says yes with no day.
		touch: { touches, opens, replied: replied === "" && row.replied === "yes", lastReply: replied },
		note: notes.length === 0 ? undefined : notes.join(" · "),
	});
}

/**
 * A deal that heard back this week says so on the funnel, a Replied pill and
 * the day, rather than reading as a stage that held (a deal at Proposal in
 * W41, with its reply that week on the record).
 */
function dealRecord(row: FunnelRow): RecordStackItem {
	const cash = alt(row.cash, "-");
	const replied = replyDay(row);
	// The reason and the pull's note (a lost deal with no reason on the
	// company) ride on the muted line, the way a lead's note does.
	const reason = jqToString(alt(row.reason, ""));
	const notes = [
		replied === "" ? "" : `Replied ${replied}`,
		reason === "" || reason === "-" ? "" : `Reason: ${titlecase(reason.replace(/_/g, " "))}`,
		jqToString(alt(row.note, "")),
	].filter((n) => n !== "");
	return recordCard({
		title: row.company,
		badge: replied !== "" || row.replied === "yes" ? "Replied" : undefined,
		deal: { stage: alt(row.stage, ""), amount: null, cash: cash === "-" ? "" : cash },
		note: notes.length === 0 ? undefined : notes.join(" · "),
	});
}

function closedRecord(row: FunnelRow): RecordStackItem {
	const reason = alt(row.reason, "-");
	const notes = [replyDay(row) === "" ? "" : `Replied ${replyDay(row)}`, jqToString(alt(row.note, ""))].filter(
		(n) => n !== "",
	);
	return recordCard({
		title: row.company,
		badge: row.stage === "Closed Lost" ? "Closed Lost" : row.status,
		closed: reason === "-" ? null : { reason },
		note: notes.length === 0 ? undefined : notes.join(" · "),
	});
}

type Stage = {
	name: string;
	label: string;
	rows: Staged[];
	records: RecordStackItem[];
};

/**
 * A funnel with more rows than this is drawn as one compact table (company,
 * stage, touch, reply) instead of a card per company. Gmail clips a message
 * near 100 KB and a card runs about a kilobyte; on 2026-10-19 thirty one
 * cards were a third of the mail. The Pipeline mail carries every company in
 * full.
 */
const FUNNEL_CAP = 12;

/** The compact rows of a long funnel: every company in stage order with its touch and reply. */
function funnelTable(stages: Stage[]): string[][] {
	return stages.flatMap((stage) =>
		stage.rows.map((row) => [
			jqToString(alt(row.company, "")),
			stage.name,
			jqToString(alt(row.lastTouch, "")),
			dayOf(row.lastReply),
		]),
	);
}

/**
 * The card a stage draws its rows on, where the stage decides it rather than
 * the table the row came in on: a lead whose company became a customer reads
 * as a deal, and a deal that was lost reads as closed. A stage not named here
 * draws each row on its own table's card.
 */
const STAGE_CARDS: Record<string, (row: FunnelRow) => RecordStackItem> = {
	Opportunity: dealRecord,
	Customer: dealRecord,
	Closed: closedRecord,
};

/** Each stage with its rows and the records that list them, in the week's order. */
function stages(draft: BriefDraft): Stage[] {
	const names = stageNames(draft);
	const all = funnel(draft, names);
	const known: Stage[] = names.map((name) => {
		const rows = all.filter((row) => row.funnel === name);
		const card = STAGE_CARDS[name];
		return {
			name,
			label: STAGE_LABELS[name] ?? name,
			rows,
			records: rows.map((row) => (card ? card(row) : row.record(row))),
		};
	});
	// A row with no stage is drawn by the card of the table it came in on,
	// and the group shows only when there is one, so a current pull reads
	// exactly as it did.
	const rest = all.filter((row) => row.funnel === NO_STAGE);
	if (rest.length === 0) return known;
	return [...known, { name: NO_STAGE, label: "No stage", rows: rest, records: rest.map((row) => row.record(row)) }];
}

/* ---------- the planning pass ---------- */
/*
 * The second half of the mail: the Monday planning pass, drafted the night
 * before. The board leads, right under the title card, so the decisions are
 * the first thing read; the sections below the retro hold their detail. The
 * model supplies the reads, the rows and their bands (prompt.md, The Shape);
 * the entrypoint merges in the spend tables, what it applied, and which
 * pulls it could read, and nothing here recomputes either.
 *
 * Long text never sits in a fixed column: a row with prose in it is a
 * RecordStack record, the name on its own line so it wraps on a phone, and
 * only numbers and short words go in a Records table.
 */

type BoardRow = { n?: unknown; area?: unknown; item?: unknown; default?: unknown; link?: unknown };

type MoneyRow = {
	budget?: unknown;
	id?: unknown;
	date?: unknown;
	amount?: unknown;
	payee?: unknown;
	category?: unknown;
	memo?: unknown;
	band?: unknown;
	rule?: unknown;
	reason?: unknown;
};

type DeleteRow = {
	budget?: unknown;
	id?: unknown;
	date?: unknown;
	amount?: unknown;
	payee?: unknown;
	reason?: unknown;
};

type TripMemo = { memo?: unknown; ids?: unknown[] | null };

type InboxRow = {
	mailbox?: unknown;
	id?: unknown;
	threadId?: unknown;
	from?: unknown;
	subject?: unknown;
	date?: unknown;
	what?: unknown;
	action?: unknown;
	labels?: unknown[] | null;
	star?: unknown;
	band?: unknown;
	rule?: unknown;
	link?: unknown;
};

type FlagRow = { key?: unknown; title?: unknown; what?: unknown; flag?: unknown; default?: unknown };
type UnplacedRow = { key?: unknown; title?: unknown; what?: unknown; points?: unknown; load?: unknown };
type Finding = { kind?: unknown; what?: unknown; when?: unknown; default?: unknown };
type TaskRow = {
	id?: unknown;
	content?: unknown;
	due?: unknown;
	priority?: unknown;
	kind?: unknown;
	default?: unknown;
	load?: unknown;
};

type SpendLine = { date?: unknown; payee?: unknown; amount?: unknown; category?: unknown; memo?: unknown };
type SpendTrip = { memo?: unknown; total?: unknown; count?: unknown };

type BudgetSpend = {
	month?: unknown;
	dayOfMonth?: unknown;
	daysInMonth?: unknown;
	typical?: {
		spent?: unknown;
		pace?: unknown;
		monthlyAverage?: unknown;
		months?: { month?: unknown; total?: unknown }[] | null;
	} | null;
	outliers?: SpendLine[] | null;
	trips?: SpendTrip[] | null;
	accountsInError?: unknown[] | null;
	rule?: unknown;
};

type Applied = {
	writes?: unknown;
	ynab?: { budget?: unknown; id?: unknown; payee?: unknown; amount?: unknown; category?: unknown }[] | null;
	gmail?: { mailbox?: unknown; id?: unknown; subject?: unknown; labels?: unknown[] | null; archived?: unknown }[] | null;
	dropped?: { kind?: unknown; id?: unknown; reason?: unknown }[] | null;
};

type Pull = { name?: unknown; ok?: unknown; note?: unknown };

/** A value as a string, a missing one as nothing rather than the word null. */
function str(value: unknown): string {
	return jqToString(alt(value, ""));
}

/** An array, or nothing when the draft carries anything else there. */
function list<T>(value: T[] | null | undefined): T[] {
	return Array.isArray(value) ? value : [];
}

/** "Fri 10-17" from 2026-10-17, the way the brief writes a day; anything else as it came. */
function dayOf(value: unknown): string {
	const date = str(value);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
	return `${weekdayName(fromDate(`${date}T00:00:00Z`))} ${slice(date, 5)}`;
}

/**
 * A day that stays on one line in a squeezed table column: a no break space
 * and a no break hyphen, so a phone never splits "Wed 01-14" after the hyphen.
 */
function unbroken(day: string): string {
	return day.replace(/ /g, "\u00a0").replace(/-/g, "\u2011");
}

/** "$1,850.00": dollars and cents with thousands marked, the sign left off. */
function usd(value: number): string {
	const [whole, cents] = two(Math.abs(value)).split(".");
	return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}

/**
 * A transaction's amount. Outflows are negative in YNAB and are most of what
 * the page lists, so they read bare; an inflow carries a plus.
 */
function signed(value: unknown): string {
	const amount = num(value);
	return amount > 0 ? `+${usd(amount)}` : usd(amount);
}

function band(row: { band?: unknown }): string {
	return asciiDowncase(str(row.band));
}

function writesOn(draft: BriefDraft): boolean {
	return draft.applied?.writes === true;
}

/** What the Handled rollups are headed: applied when writes were on, proposed when they were off. */
function handledTitle(draft: BriefDraft): string {
	return writesOn(draft) ? "Handled · Applied" : "Handled · Proposed, Writes Were Off";
}

/*
 * Which pull feeds which section, matched on the front of the pull's name
 * (ynab covers ynab-personal and ynab-atelic). A pull named nothing here
 * still shows in This Run.
 */
const SECTION_PULLS: Record<string, string[]> = {
	Money: ["ynab", "spend", "planning"],
	Inbox: ["gmail", "inbox", "planning"],
	Work: ["linear", "planning"],
	Calendar: ["calendar", "planning"],
	Tasks: ["todoist", "planning"],
};

/**
 * The entrypoint records a pull named "planning" when the model's planning
 * half did not validate and every planning section was emptied. Every
 * section then opens on the notice, and the board says so instead of an
 * all clear, since an empty board on a failed half is the one thing this
 * mail must never say.
 */
function planningMissed(draft: BriefDraft): Pull | undefined {
	return missedPulls(draft).find((pull) => asciiDowncase(str(pull.name)) === "planning");
}

function boardEmptyLine(draft: BriefDraft): string {
	const missed = planningMissed(draft);
	if (missed === undefined) return "Nothing needs you this week.";
	return `The planning half was not read this run${str(missed.note) === "" ? "" : `: ${str(missed.note)}`}. Run the Monday session's own passes.`;
}

function missedPulls(draft: BriefDraft): Pull[] {
	return list(draft.pulls).filter((pull) => pull && pull.ok === false);
}

/** The one line notices that open a section whose pull was not read. */
function notices(draft: BriefDraft, section: string): string[] {
	const prefixes = SECTION_PULLS[section] ?? [];
	return missedPulls(draft)
		.filter((pull) => prefixes.some((prefix) => asciiDowncase(str(pull.name)).startsWith(prefix)))
		.map((pull) => (str(pull.note) === "" ? "Not read this run." : `Not read this run: ${str(pull.note)}`));
}

/** The dropped writes of one kind, each named by the row it came from when the draft has it. */
function dropped(draft: BriefDraft, kind: string, name: (id: string) => string): RecordStackItem[] {
	return list(draft.applied?.dropped)
		.filter((row) => asciiDowncase(str(row.kind)) === kind)
		.map((row) => ({ title: name(str(row.id)), meta: [], note: str(row.reason) }));
}

/* ---------- the board ---------- */

/**
 * Numbered by position, so the numbers always run one to n in the order the
 * model ranked them and a reply of "3, no" means the third line down.
 */
function boardRecords(draft: BriefDraft): RecordStackItem[] {
	return list(draft.board).map((row, index) => ({
		title: `${index + 1}. ${str(row.item)}`,
		url: str(row.link) === "" ? undefined : str(row.link),
		badge: str(row.area) === "" ? undefined : str(row.area),
		meta: [],
		note: str(row.default) === "" ? undefined : `Default: ${str(row.default)}`,
	}));
}

/* ---------- money ---------- */

const BUDGETS: { key: "personal" | "atelic"; label: string }[] = [
	{ key: "personal", label: "Personal" },
	{ key: "atelic", label: "Atelic" },
];

type Tally = { budget: string; category: string; count: number; total: number };

/**
 * The handled rows by category, Personal first, each with its count and its
 * total. With writes on these are the rows the entrypoint actually approved,
 * so a write that failed or was dropped never shows as handled; with writes
 * off they are the rows the model banded high, which is what would have been.
 */
function moneyTallies(draft: BriefDraft): Tally[] {
	const handled: { budget?: unknown; category?: unknown; amount?: unknown }[] = writesOn(draft)
		? list(draft.applied?.ynab)
		: list(draft.money?.rows).filter((row) => band(row) === "high");
	const tallies: Tally[] = [];
	for (const row of handled) {
		const budget = str(row.budget);
		const category = str(row.category);
		const found = tallies.find((tally) => tally.budget === budget && tally.category === category);
		if (found) {
			found.count += 1;
			found.total += num(row.amount);
		} else tallies.push({ budget, category, count: 1, total: num(row.amount) });
	}
	const rank = (budget: string) => (budget === "Personal" ? 0 : 1);
	return tallies
		.map((tally, index) => ({ tally, index }))
		.sort((a, b) => rank(a.tally.budget) - rank(b.tally.budget) || a.index - b.index)
		.map(({ tally }) => tally);
}

function moneyRecord(row: MoneyRow): RecordStackItem {
	const note = [str(row.rule), str(row.reason)].filter((part) => part !== "").join(" · ");
	return {
		title: str(row.payee),
		badge: str(row.budget) === "" ? undefined : str(row.budget),
		meta: [dayOf(row.date), str(row.category), str(row.memo)],
		aside: { text: signed(row.amount) },
		note: note === "" ? undefined : note,
	};
}

function moneyRows(draft: BriefDraft, which: string): MoneyRow[] {
	return list(draft.money?.rows).filter((row) => band(row) === which);
}

function deleteRecords(draft: BriefDraft): RecordStackItem[] {
	return list(draft.money?.deletes).map((row) => ({
		title: str(row.payee),
		badge: str(row.budget) === "" ? undefined : str(row.budget),
		meta: [dayOf(row.date)],
		aside: { text: signed(row.amount) },
		note: str(row.reason) === "" ? undefined : str(row.reason),
	}));
}

function tripMemoRecords(draft: BriefDraft): RecordStackItem[] {
	return list(draft.money?.trips).map((row) => {
		const count = list(row.ids).length;
		return { title: str(row.memo), meta: [`${count} ${count === 1 ? "charge" : "charges"}`] };
	});
}

function droppedMoney(draft: BriefDraft): RecordStackItem[] {
	return dropped(draft, "ynab", (id) => {
		const row = list(draft.money?.rows).find((candidate) => str(candidate.id) === id);
		return row ? `${str(row.payee)} ${signed(row.amount)}` : id;
	});
}

/** The budgets the entrypoint read, in order, with the ones it could not. */
function spendBudgets(draft: BriefDraft): { label: string; spend: BudgetSpend | null }[] {
	return BUDGETS.map(({ key, label }) => {
		const spend = draft.spend?.[key];
		return { label, spend: spend && typeof spend === "object" ? spend : null };
	});
}

/** "Month So Far · Day 19 of 31", from the first budget that was read. */
function spendTitle(draft: BriefDraft): string {
	const read = spendBudgets(draft).find((budget) => budget.spend !== null)?.spend;
	if (!read) return "Month So Far";
	const day = str(read.dayOfMonth);
	const days = str(read.daysInMonth);
	return day === "" || days === "" ? "Month So Far" : `Month So Far · Day ${day} of ${days}`;
}

/** The split's one sentence, written once though each budget carries it. */
function spendRule(draft: BriefDraft): string {
	for (const { spend } of spendBudgets(draft)) {
		if (spend && str(spend.rule) !== "") return str(spend.rule);
	}
	return "";
}

function accountsInError(draft: BriefDraft): string {
	return spendBudgets(draft)
		.filter(({ spend }) => spend && list(spend.accountsInError).length > 0)
		.map(({ label, spend }) => `${label}: ${list(spend?.accountsInError).map(str).join(", ")}`)
		.join(". ");
}

function moneyEmpty(draft: BriefDraft): boolean {
	return (
		str(draft.money?.read) === "" &&
		spendBudgets(draft).every(({ spend }) => spend === null) &&
		list(draft.money?.rows).length === 0 &&
		list(draft.money?.deletes).length === 0 &&
		list(draft.money?.trips).length === 0 &&
		droppedMoney(draft).length === 0
	);
}

/* ---------- inbox ---------- */

function inboxRows(draft: BriefDraft, which: string): InboxRow[] {
	return list(draft.inbox?.rows).filter((row) => band(row) === which);
}

/**
 * The handled messages grouped by the rule that handled them, in the order
 * the rules first appear. With writes on these are the messages the
 * entrypoint moved, each traced back to its row for the rule; with writes off
 * they are the rows the model banded high.
 */
function inboxTallies(draft: BriefDraft): { rule: string; count: number }[] {
	const rows = list(draft.inbox?.rows);
	const handled: InboxRow[] = writesOn(draft)
		? list(draft.applied?.gmail).map((done) => rows.find((row) => str(row.id) === str(done.id)) ?? { rule: "" })
		: inboxRows(draft, "high");
	const tallies: { rule: string; count: number }[] = [];
	for (const row of handled) {
		const rule = str(row.rule) === "" ? "No rule named" : str(row.rule);
		const found = tallies.find((tally) => tally.rule === rule);
		if (found) found.count += 1;
		else tallies.push({ rule, count: 1 });
	}
	return tallies;
}

/** "task · label 📑 Admin · green star": what the row proposes, in its parts. */
function inboxAction(row: InboxRow): string {
	const action = str(row.action);
	const labels = list(row.labels).map(str).filter((label) => label !== "");
	const label = labels.length === 0 ? "" : `label ${labels.join(", ")}`;
	return [
		action === "label" && label !== "" ? "" : action,
		label,
		str(row.star) === "" ? "" : `${str(row.star)} star`,
	]
		.filter((part) => part !== "")
		.join(" · ");
}

function inboxRecord(row: InboxRow): RecordStackItem {
	return {
		title: str(row.subject) === "" ? "(no subject)" : str(row.subject),
		url: str(row.link) === "" ? undefined : str(row.link),
		badge: str(row.mailbox) === "" ? undefined : str(row.mailbox),
		meta: [str(row.from), str(row.date), inboxAction(row)],
		note: str(row.what) === "" ? undefined : str(row.what),
	};
}

function droppedInbox(draft: BriefDraft): RecordStackItem[] {
	return dropped(draft, "gmail", (id) => {
		const row = list(draft.inbox?.rows).find((candidate) => str(candidate.id) === id);
		return row ? str(row.subject) : id;
	});
}

function inboxEmpty(draft: BriefDraft): boolean {
	return list(draft.inbox?.rows).length === 0 && droppedInbox(draft).length === 0;
}

/* ---------- work, calendar, tasks ---------- */

function issueURL(key: string): string | undefined {
	return /^[A-Za-z]+-\d+$/.test(key) ? `https://linear.app/atelic/issue/${key}` : undefined;
}

function issueTitle(key: string, title: string): string {
	return [key, title].filter((part) => part !== "").join(" ");
}

function flagRecords(draft: BriefDraft): RecordStackItem[] {
	return list(draft.work?.flags).map((row) => ({
		title: issueTitle(str(row.key), str(row.title)),
		url: issueURL(str(row.key)),
		badge: str(row.flag) === "" ? undefined : str(row.flag),
		meta: [str(row.default) === "" ? "" : `Default: ${str(row.default)}`],
		note: str(row.what) === "" ? undefined : str(row.what),
	}));
}

function unplacedRecords(draft: BriefDraft): RecordStackItem[] {
	return list(draft.work?.unplaced).map((row) => {
		const points = str(row.points);
		return {
			title: issueTitle(str(row.key), str(row.title)),
			url: issueURL(str(row.key)),
			meta: [points === "" ? "" : `${points} ${points === "1" ? "point" : "points"}`, str(row.load)],
			note: str(row.what) === "" ? undefined : str(row.what),
		};
	});
}

function findingRecords(draft: BriefDraft): RecordStackItem[] {
	return list(draft.calendar?.findings).map((row) => ({
		title: str(row.what),
		badge: str(row.kind) === "" ? undefined : str(row.kind),
		meta: [str(row.when)],
		note: str(row.default) === "" ? undefined : `Default: ${str(row.default)}`,
	}));
}

function taskRecords(draft: BriefDraft): RecordStackItem[] {
	return list(draft.tasks?.rows).map((row) => ({
		title: str(row.content),
		badge: str(row.kind) === "" ? undefined : str(row.kind),
		meta: [str(row.due) === "" ? "" : `due ${dayOf(row.due)}`, str(row.priority), str(row.load)],
		note: str(row.default) === "" ? undefined : `Default: ${str(row.default)}`,
	}));
}

/* ---------- the parts of a section ---------- */

/**
 * A titled block inside a section card: a table or a stack, or the plain
 * sentence that stands in when it has nothing. `notes` are short asides
 * that sit under the block, eyebrow first.
 */
type Part = {
	title: string;
	html: ReactNode | null;
	text: string | null;
	empty: string;
	notes?: { eyebrow: string; text: string; accented: boolean }[];
};

/**
 * How many records a planning list shows in the html before the rest is a
 * count. Gmail clips a message near 100 KB, and a card runs about a kilobyte,
 * so the lists are held here; the plain text twin and the attached plan carry
 * every row.
 */
const LIST_CAP = 8;

/**
 * A section's decisions are the board's rows, drawn once at the top of the
 * mail with their numbers; here they are a count and a pointer, so the same
 * card is never drawn twice.
 */
function boardPointer(title: string, count: number, empty: string): Part {
	return {
		title: `${title} · ${count}`,
		html: null,
		text: null,
		empty: count === 0 ? empty : `On the board at the top, with ${count === 1 ? "its number" : "their numbers"}.`,
	};
}

function stackPart(title: string, records: RecordStackItem[], empty: string): Part {
	const shown = records.slice(0, LIST_CAP);
	const more = records.length - shown.length;
	return {
		title: `${title} · ${records.length}`,
		html: records.length === 0 ? null : <RecordStack records={shown} />,
		text: records.length === 0 ? null : recordStackText(records),
		empty,
		notes: more > 0 ? [{ eyebrow: "More", text: `${more} more in the attached plan.json.`, accented: false }] : undefined,
	};
}

function partsHTML(parts: Part[]): ReactNode {
	return parts.map((part, index) => {
		const last = index === parts.length - 1;
		const notes = part.notes ?? [];
		return (
			// biome-ignore lint/suspicious/noArrayIndexKey: a part's position is its identity
			<Fragment key={index}>
				<SubEyebrow text={part.title} />
				{part.html === null ? (
					<EmptyRow text={part.empty} />
				) : (
					<RecordsRow last={last || notes.length > 0}>{part.html}</RecordsRow>
				)}
				{notes.map((note, n) => (
					<Note
						// biome-ignore lint/suspicious/noArrayIndexKey: a note's position is its identity
						key={n}
						eyebrowText={note.eyebrow}
						text={note.text}
						accented={note.accented}
						last={n === notes.length - 1}
					/>
				))}
			</Fragment>
		);
	});
}

function partsText(parts: Part[]): string {
	return parts
		.map((part) => {
			let block = `\n${part.title}\n${part.text === null ? wrap(part.empty) : part.text}\n`;
			for (const note of part.notes ?? []) block += `\n${note.eyebrow}\n${wrap(note.text)}\n`;
			return block;
		})
		.join("");
}

/** The section's opening: any pull it missed, then its read when the model wrote one. */
function openingHTML(notes: string[], read: string): ReactNode {
	return (
		<>
			{notes.map((note, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: a notice's position is its identity
				<EmptyRow key={index} text={note} />
			))}
			{read === "" ? null : <ReadBlock text={read} divider={true} />}
		</>
	);
}

/** The notices, the read, and the parts, a blank line between each that is there. */
function sectionText(notes: string[], read: string, body: string): string {
	return [notes.map((note) => `${wrap(note)}\n`).join(""), read === "" ? "" : textRead(read), body]
		.filter((block) => block !== "")
		.join("\n");
}

/* ---------- each section's parts ---------- */

function spendParts(draft: BriefDraft): Part[] {
	const budgets = spendBudgets(draft);
	const read = budgets.filter((budget) => budget.spend !== null);
	if (read.length === 0) {
		return [{ title: "Month So Far", html: null, text: null, empty: "Spend was not read this run." }];
	}
	const notes: Part["notes"] = [];
	for (const missing of budgets.filter((budget) => budget.spend === null)) {
		notes.push({ eyebrow: missing.label, text: "Not read this run.", accented: false });
	}
	const errors = accountsInError(draft);
	if (errors !== "") {
		notes.push({
			eyebrow: "Accounts in Error",
			text: `${errors}. Every number there is a floor until the connection is repaired.`,
			accented: true,
		});
	}
	if (spendRule(draft) !== "") notes.push({ eyebrow: "How It Splits", text: spendRule(draft), accented: false });

	const typical = read.map(({ label, spend }) => {
		const spent = num(spend?.typical?.spent);
		const pace = num(spend?.typical?.pace);
		return { label, spent, pace, average: num(spend?.typical?.monthlyAverage) };
	});
	const parts: Part[] = [
		{
			title: spendTitle(draft),
			html: (
				<Records
					columns={[
						{ label: "Budget" },
						// Short heads: a header never wraps, and four of them have to fit a phone.
						{ label: "Spent", right: true },
						{ label: "Pace", right: true },
						{ label: "Avg", right: true },
					]}
					rows={typical.map((row) => [
						{ value: row.label },
						{ value: usd(row.spent), mono: true, hot: Math.abs(row.spent) > Math.abs(row.pace) },
						{ value: usd(row.pace), mono: true },
						{ value: usd(row.average), mono: true },
					])}
				/>
			),
			text: textTable(
				["Budget", "Spent so far", "Pace", "Monthly avg"],
				typical.map((row) => [row.label, usd(row.spent), usd(row.pace), usd(row.average)]),
				[1, 2, 3],
			),
			empty: "",
			notes,
		},
	];

	for (const { label, spend } of read) {
		const outliers = list(spend?.outliers);
		if (outliers.length > 0) {
			parts.push({
				title: `Outliers · ${label} · ${outliers.length}`,
				html: (
					<Records
						columns={[
							{ label: "Date" },
							{ label: "Payee" },
							{ label: "Amount", right: true },
							{ label: "Category" },
						]}
						rows={outliers.map((row) => [
							{ value: unbroken(dayOf(row.date)), mono: true, muted: true },
							{ value: str(row.payee) },
							{ value: signed(row.amount), mono: true },
							{ value: str(row.category) },
						])}
					/>
				),
				text: textTable(
					["Date", "Payee", "Amount", "Category"],
					outliers.map((row) => [dayOf(row.date), str(row.payee), signed(row.amount), str(row.category)]),
					[2],
				),
				empty: "",
			});
		}
		const trips = list(spend?.trips);
		if (trips.length > 0) {
			parts.push({
				title: `Trips · ${label} · ${trips.length}`,
				html: (
					<Records
						columns={[{ label: "Trip" }, { label: "Total", right: true }, { label: "Charges", right: true }]}
						rows={trips.map((row) => [
							{ value: str(row.memo) },
							{ value: usd(num(row.total)), mono: true },
							{ value: numberString(num(row.count)), mono: true },
						])}
					/>
				),
				text: textTable(
					["Trip", "Total", "Charges"],
					trips.map((row) => [str(row.memo), usd(num(row.total)), numberString(num(row.count))]),
					[1, 2],
				),
				empty: "",
			});
		}
	}
	return parts;
}

function moneyParts(draft: BriefDraft): Part[] {
	const tallies = moneyTallies(draft);
	const parts: Part[] = [
		...spendParts(draft),
		{
			title: handledTitle(draft),
			html:
				tallies.length === 0 ? null : (
					<Records
						columns={[
							{ label: "Budget" },
							{ label: "Category" },
							{ label: "Count", right: true },
							{ label: "Total", right: true },
						]}
						rows={tallies.map((tally) => [
							{ value: tally.budget, muted: true },
							{ value: tally.category },
							{ value: numberString(tally.count), mono: true },
							{ value: signed(tally.total), mono: true },
						])}
					/>
				),
			text:
				tallies.length === 0
					? null
					: textTable(
							["Budget", "Category", "Count", "Total"],
							tallies.map((tally) => [
								tally.budget,
								tally.category,
								numberString(tally.count),
								signed(tally.total),
							]),
							[2, 3],
						),
			empty: "No row matched a rule exactly.",
		},
		stackPart("Spot Check", moneyRows(draft, "medium").map(moneyRecord), "Nothing to spot check."),
		boardPointer("Decisions", moneyRows(draft, "decision").length, "No money decisions this week."),
	];
	const deletes = deleteRecords(draft);
	if (deletes.length > 0) parts.push(stackPart("Proposed Deletes", deletes, ""));
	const memos = tripMemoRecords(draft);
	if (memos.length > 0) parts.push(stackPart("Proposed Trip Memos", memos, ""));
	const drops = droppedMoney(draft);
	if (drops.length > 0) parts.push(stackPart("Dropped", drops, ""));
	return parts;
}

function inboxParts(draft: BriefDraft): Part[] {
	const tallies = inboxTallies(draft);
	const parts: Part[] = [
		{
			title: handledTitle(draft),
			html:
				tallies.length === 0 ? null : (
					<Records
						columns={[{ label: "Rule" }, { label: "Count", right: true }]}
						rows={tallies.map((tally) => [
							{ value: tally.rule },
							{ value: numberString(tally.count), mono: true },
						])}
					/>
				),
			text:
				tallies.length === 0
					? null
					: tallies.map((tally) => hang(lpad(numberString(tally.count), 3), tally.rule, 5).replace(/\n$/, "")).join("\n"),
			empty: "No message matched a rule exactly.",
		},
		stackPart("Spot Check", inboxRows(draft, "medium").map(inboxRecord), "Nothing to spot check."),
		boardPointer("Decisions", inboxRows(draft, "decision").length, "No mail decisions this week."),
	];
	const drops = droppedInbox(draft);
	if (drops.length > 0) parts.push(stackPart("Dropped", drops, ""));
	return parts;
}

function workParts(draft: BriefDraft): Part[] {
	return [
		stackPart("Flags", flagRecords(draft), "Every issue in the cycle is triaged."),
		stackPart("Unplaced", unplacedRecords(draft), "Every issue in the cycle has a block."),
	];
}

/** Each planning section: its name, whether it has nothing at all, the line that says so, and its parts. */
function planningSections(draft: BriefDraft): {
	name: string;
	read: string;
	empty: boolean;
	emptyLine: string;
	parts: Part[];
}[] {
	return [
		{
			name: "Money",
			read: str(draft.money?.read),
			empty: moneyEmpty(draft),
			emptyLine: "Spend was not read this run, and nothing in either budget needs you.",
			parts: moneyParts(draft),
		},
		{
			name: "Inbox",
			read: "",
			empty: inboxEmpty(draft),
			emptyLine: "Nothing in either inbox this week.",
			parts: inboxParts(draft),
		},
		{
			name: "Work",
			read: str(draft.work?.read),
			empty:
				str(draft.work?.read) === "" &&
				list(draft.work?.flags).length === 0 &&
				list(draft.work?.unplaced).length === 0,
			emptyLine: "Nothing in the cycle to flag or place.",
			parts: workParts(draft),
		},
		{
			name: "Calendar",
			read: str(draft.calendar?.read),
			empty: str(draft.calendar?.read) === "" && list(draft.calendar?.findings).length === 0,
			emptyLine: "Nothing on the calendar to fix this week.",
			parts: [stackPart("Findings", findingRecords(draft), "Nothing on the calendar to fix.")],
		},
		{
			name: "Tasks",
			read: str(draft.tasks?.read),
			empty: str(draft.tasks?.read) === "" && list(draft.tasks?.rows).length === 0,
			emptyLine: "No tasks came back from the Schedule filter.",
			parts: [stackPart("To Place", taskRecords(draft), "No tasks to place.")],
		},
	];
}

/* ---------- this run ---------- */

function runStats(draft: BriefDraft): { label: string; n: string }[] {
	return [
		{ label: "Writes", n: writesOn(draft) ? "On" : "Off" },
		{ label: "YNAB Applied", n: numberString(list(draft.applied?.ynab).length) },
		{ label: "Mail Applied", n: numberString(list(draft.applied?.gmail).length) },
		{ label: "Dropped", n: numberString(list(draft.applied?.dropped).length) },
	];
}

function missedRecords(draft: BriefDraft): RecordStackItem[] {
	return missedPulls(draft).map((pull) => ({
		title: str(pull.name),
		meta: [],
		note: str(pull.note) === "" ? undefined : str(pull.note),
	}));
}

/* ---------- the planning pass, html ---------- */

function boardHTML(draft: BriefDraft): ReactNode {
	const records = boardRecords(draft);
	return (
		<>
			<Eyebrow text="Needed From You" />
			<Card>
				{records.length === 0 ? (
					<EmptyRow text={boardEmptyLine(draft)} />
				) : (
					<Row last={true}>
						<RecordStack records={records} />
					</Row>
				)}
			</Card>
		</>
	);
}

function planningHTML(draft: BriefDraft): ReactNode {
	return planningSections(draft).map((section) => (
		<Fragment key={section.name}>
			<Eyebrow text={section.name} />
			<Card>
				{openingHTML(notices(draft, section.name), section.read)}
				{section.empty ? <EmptyRow text={section.emptyLine} /> : partsHTML(section.parts)}
			</Card>
		</Fragment>
	));
}

function thisRunHTML(draft: BriefDraft): ReactNode {
	const missed = missedRecords(draft);
	return (
		<>
			<Eyebrow text="This Run" />
			<Card>
				<Row last={false}>
					<StatStrip stats={runStats(draft)} />
				</Row>
				{missed.length === 0 ? (
					<EmptyRow text="Every pull was read." />
				) : (
					<>
						<SubEyebrow text={`Not Read · ${missed.length}`} />
						<RecordsRow last={true}>
							<RecordStack records={missed} />
						</RecordsRow>
					</>
				)}
			</Card>
		</>
	);
}

/* ---------- the planning pass, plain text ---------- */

function boardText(draft: BriefDraft): string {
	const records = boardRecords(draft);
	return (
		textSection("Needed From You") +
		(records.length === 0 ? `${wrap(boardEmptyLine(draft))}\n` : `${recordStackText(records)}\n`)
	);
}

function planningText(draft: BriefDraft): string {
	return planningSections(draft)
		.map(
			(section) =>
				textSection(section.name) +
				sectionText(
					notices(draft, section.name),
					section.read,
					section.empty ? `${wrap(section.emptyLine)}\n` : partsText(section.parts).replace(/^\n/, ""),
				),
		)
		.join("");
}

function thisRunText(draft: BriefDraft): string {
	const missed = missedRecords(draft);
	let out = textSection("This Run");
	out += runStats(draft)
		.map((stat) => `  ${rpad(stat.label, 16)}${stat.n}`)
		.join("\n");
	out += "\n";
	out += missed.length === 0 ? "\n  Every pull was read.\n" : `\nNot Read · ${missed.length}\n${recordStackText(missed)}\n`;
	return out;
}

/* ---------- html ---------- */

function sessionsTable(week: Session[]): ReactNode {
	const columns: RecordsColumn[] = [
		{ label: "Day" },
		{ label: "Session" },
		{ label: "Type", right: true },
		{ label: "Min", right: true },
		{ label: "Mi", right: true },
	];
	const rows: RecordsCell[][] = week.map((session) => [
		{ value: session.day, mono: true, muted: true },
		{ value: session.name },
		{
			value: session.kind,
			html: (
				<>
					{session.kind}
					{session.social ? <Badge letter="S" /> : null}
				</>
			),
		},
		{ value: numberString(session.minutes), mono: true },
		{ value: session.miles === null ? "" : two(session.miles), mono: true },
	]);
	for (const line of totalLines(week)) {
		rows.push([
			{ value: "" },
			{ value: line.label },
			{ value: "" },
			{ value: numberString(line.minutes), mono: true },
			{ value: two(line.miles), mono: true },
		]);
	}
	return <Records columns={columns} rows={rows} />;
}

function totalMinutes(week: Session[]): number {
	return week.reduce((sum, session) => sum + session.minutes, 0);
}

function totalMiles(week: Session[]): number {
	return week.reduce((sum, session) => sum + alt(session.miles, 0), 0);
}

const KIND_PLURALS: Record<string, string> = {
	Run: "runs",
	Ride: "rides",
	Walk: "walks",
	Workout: "workouts",
	Swim: "swims",
	Hike: "hikes",
};

/** "runs, rides, workouts": every kind that carried miles, in the order the week met them. */
function mileageKinds(week: Session[]): string[] {
	const kinds: string[] = [];
	for (const session of week) {
		if (session.miles === null || kinds.includes(session.kind)) continue;
		kinds.push(session.kind);
	}
	return kinds.map((kind) => (kind === "PT" ? kind : KIND_PLURALS[kind] ?? asciiDowncase(kind)));
}

type TotalLine = { label: string; minutes: number; miles: number };

/**
 * The week's mileage is every session's miles, rides and workouts as much as
 * runs, and the total says what it holds so it is never read as running
 * alone (the W41 narrative did, past a 4.93 mile ride). When anything but a
 * run carried miles, the run only figure sits on the line under it.
 */
function totalLines(week: Session[]): TotalLine[] {
	const kinds = mileageKinds(week);
	const lines: TotalLine[] = [
		{
			label: kinds.length === 0 ? "Total" : `Total: ${kinds.join(", ")}`,
			minutes: totalMinutes(week),
			miles: totalMiles(week),
		},
	];
	const runs = week.filter((session) => session.kind === "Run");
	if (runs.length > 0 && kinds.some((kind) => kind !== "runs")) {
		lines.push({ label: "Runs only", minutes: totalMinutes(runs), miles: totalMiles(runs) });
	}
	return lines;
}

export function briefHTML(input: unknown, context: RenderContext): string {
	const draft = input as BriefDraft;
	const week = sessions(draft);
	const movement = [...movementTargets(draft), takeoutTarget(draft)];
	const atelic = atelicTargets(draft);
	const funnelStages = stages(draft);
	const filled = funnelStages.filter((stage) => stage.rows.length > 0);
	const funnelRows = filled.reduce((sum, stage) => sum + stage.rows.length, 0);
	const moved = alt(draft.whatMoved, []);
	const movedNote = jqToString(alt(draft.whatMovedNote, ""));
	const headline = jqToString(alt(draft.headline, ""));

	return renderEmail({
		title: `${context.week} Brief`,
		preheader: headline,
		children: (
			<>
				<Masthead title={`Brief · Week ${weekNumber(context.week)}`} />
				<TitleCard
					eyebrowText={rangeLine(context.monday, context.sunday)}
					headlineLines={[verdict(draft)]}
					lede={headline}
					stats={
						<>
							<Scoreboard>
								<GroupRow text="Movement" first={true} />
								{movement.map((row, index) => (
									<TargetRow
										// biome-ignore lint/suspicious/noArrayIndexKey: a row's position is its identity
										key={index}
										text={row.label}
										logged={row.logged}
										target={row.target}
										note={row.note}
										last={index === movement.length - 1}
									/>
								))}
								{atelic.length === 0 ? null : (
									<>
										<GroupRow text="Atelic" first={false} />
										{atelic.map((row, index) => (
											<TargetRow
												// biome-ignore lint/suspicious/noArrayIndexKey: a row's position is its identity
												key={index}
												text={row.label}
												logged={row.logged}
												target={row.target}
												note={row.note}
												last={index === atelic.length - 1}
											/>
										))}
									</>
								)}
							</Scoreboard>
							{moved.length > 0 || movedNote !== "" ? (
								<WhatMoved
									items={moved.map((item) => ({
										subject: jqToString(item.subject),
										event: jqToString(item.event),
									}))}
									note={movedNote}
								/>
							) : (
								<SpacerRow />
							)}
						</>
					}
				/>

				{boardHTML(draft)}

				<Eyebrow text="Movement" />
				<Card>
					<ReadBlock text={jqToString(alt(draft.movementRead, ""))} divider={true} />
					<SubEyebrow text="By Day" />
					<DayStrip days={days(context.monday, week)} last={false} />
					<SubEyebrow text={`Sessions · ${week.length}`} />
					{week.length === 0 ? (
						<EmptyRow text="Nothing logged in Strava this week." />
					) : (
						<SessionsRow>{sessionsTable(week)}</SessionsRow>
					)}
				</Card>

				<Eyebrow text="Takeout" />
				<Card>
					<ReadBlock text={jqToString(alt(draft.takeoutRead, ""))} divider={false} />
				</Card>

				<Eyebrow text="Atelic" />
				<Card>
					<ReadBlock text={jqToString(alt(draft.atelicRead, ""))} divider={true} />
					<Row last={false}>
						<StatStrip
							stats={funnelStages.map((stage) => ({ n: stage.rows.length, label: stage.label }))}
						/>
					</Row>
					{funnelRows > FUNNEL_CAP ? (
						<>
							<SubEyebrow text={`Touched This Week · ${funnelRows}`} />
							<RecordsRow last={true}>
								<Records
									columns={[{ label: "Company" }, { label: "Stage" }, { label: "Touch" }, { label: "Reply" }]}
									rows={funnelTable(filled).map(([company, stage, touch, reply]) => [
										{ value: company },
										{ value: stage, muted: true },
										{ value: touch },
										{ value: unbroken(reply), mono: true, muted: true },
									])}
								/>
							</RecordsRow>
						</>
					) : (
						filled.map((stage, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: a stage's position is its identity
							<Fragment key={index}>
								<SubEyebrow text={`${stage.name} · ${stage.rows.length}`} />
								<RecordsRow last={index === filled.length - 1}>
									<RecordStack records={stage.records} />
								</RecordsRow>
							</Fragment>
						))
					)}
				</Card>

				{planningHTML(draft)}

				<Eyebrow text="Blind Spots" />
				<Card>
					<ReadBlock text={jqToString(alt(draft.blindSpots, ""))} divider={false} />
				</Card>

				{thisRunHTML(draft)}

				<Footer meta={context.meta} />
			</>
		),
	});
}

/* ---------- plain text ---------- */

export function briefText(input: unknown, context: RenderContext): string {
	const draft = input as BriefDraft;
	const week = sessions(draft);
	const number = weekNumber(context.week);
	const movement = [...movementTargets(draft), takeoutTarget(draft)];
	const atelic = atelicTargets(draft);
	const funnelStages = stages(draft);
	const moved = alt(draft.whatMoved, []);
	const movedNote = jqToString(alt(draft.whatMovedNote, ""));

	let out = `ATELIC · BRIEF · WEEK ${number}\n${rangeLine(context.monday, context.sunday)}\n\n`;
	out += `${asciiUpcase(verdict(draft))}\n\n`;
	out += `${unindent(wrap(jqToString(alt(draft.headline, ""))))}\n\n\n`;
	out += `SCOREBOARD\n\nMovement\n${movement.map(textTarget).join("\n")}\n`;
	if (atelic.length > 0) out += `\nAtelic\n${atelic.map(textTarget).join("\n")}\n`;
	if (moved.length > 0 || movedNote !== "") {
		out += `\nWhat Moved\n${moved
			.map((item) => `  ${jqToString(item.subject)} ${jqToString(item.event)}`)
			.join("\n")}`;
		if (movedNote !== "") out += `\n  ${movedNote}`;
		out += "\n";
	}

	out += boardText(draft);

	out += textSection("Movement") + textRead(jqToString(alt(draft.movementRead, "")));
	out += `\nBy Day\n${days(context.monday, week)
		.map((day) => {
			const entries = day.entries
				.map((entry) => `${entry.name}${entry.strong ? " (S)" : ""}`)
				.join(" · ");
			return `  ${rpad(day.label, 5)}${entries === "" ? "Rest" : entries}`;
		})
		.join("\n")}\n`;
	out += `\nSessions · ${week.length}\n`;
	out +=
		week.length === 0
			? "  Nothing logged in Strava this week."
			: textTable(
					["Day", "Session", "Type", "Min", "Mi"],
					[
						...week.map((session) => [
							session.day,
							session.name,
							`${session.kind}${session.social ? " (S)" : ""}`,
							numberString(session.minutes),
							session.miles === null ? "" : two(session.miles),
						]),
						...totalLines(week).map((line) => [
							"",
							line.label,
							"",
							numberString(line.minutes),
							two(line.miles),
						]),
					],
					[3, 4],
				);
	out += "\n";

	out += textSection("Takeout") + textRead(jqToString(alt(draft.takeoutRead, "")));

	out += textSection("Atelic") + textRead(jqToString(alt(draft.atelicRead, "")));
	out += `\nThe Funnel\n${funnelStages
		.map((stage) => `  ${rpad(stage.label, 10)}${stage.rows.length}`)
		.join("\n")}\n`;
	const textFilled = funnelStages.filter((stage) => stage.rows.length > 0);
	const textRows = textFilled.reduce((sum, stage) => sum + stage.rows.length, 0);
	out +=
		textRows > FUNNEL_CAP
			? `\nTouched This Week · ${textRows}\n${textTable(["Company", "Stage", "Touch", "Reply"], funnelTable(textFilled), [])}\n`
			: textFilled
					.map((stage) => `\n${stage.name} · ${stage.rows.length}\n${recordStackText(stage.records)}\n`)
					.join("");

	out += planningText(draft);

	out += textSection("Blind Spots") + textRead(jqToString(alt(draft.blindSpots, "")));
	out += thisRunText(draft);
	out += `\n\n${context.meta}\n`;
	return out;
}

/** What the bundle built for this runner renders: build.mjs aliases "runner-page" to this file. */
export const page: Page = { html: briefHTML, text: briefText };
