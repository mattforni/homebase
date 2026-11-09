import { Fragment, type ReactNode } from "react";
import {
	asciiDowncase,
	Card,
	type Day,
	DayStrip,
	EmptyRow,
	Eyebrow,
	Footer,
	GroupRow,
	Masthead,
	Note,
	ReadBlock,
	RecordStack,
	type RecordStackItem,
	Records,
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
	weekdayName,
	weekNumber,
} from "./jq";
import { RecordsRow, SpacerRow, StripedTable } from "./local";
import type { Page, RenderContext } from "./types";

/*
 * The Brief, made brief again (ATE-675, 2026-11-09). Two halves, in reading
 * order. Last Week is summaries: the movement scoreboard with takeout on it,
 * the month so far against the pace with the delta in the table, the tasks
 * completed, then the sessions as a striped data table. This Week is What I
 * Did (a ledger of the calls made, one line per source, with the few rows
 * worth a glance and the rules those calls propose), What I Need From You
 * (the decision rows alone, grouped by source and numbered within the group),
 * and This Run.
 *
 * The posture is trust but verify: the runner makes the call wherever a plain
 * read exists, the mail counts it, and Forni corrects on Monday. A row waits
 * for him only when it is irreversible, outbound, changes the shape of his
 * day, or has no plain read (prompt.md, Bands). No headline, no read that
 * restates the numbers under it, no date range, no Atelic outreach.
 *
 * The sessions and the day strip are built from strava.json here, never from
 * the model, so the only numbers the model supplies are the graded coverage
 * counts. The spend tables, the completed tasks, the apply record and the
 * pull ledger are the entrypoint's, merged in after the model runs.
 */

type CoverageRow = { modality?: unknown; logged?: unknown; target?: unknown; note?: unknown };
type TakeoutRow = { day?: unknown; vehicle?: unknown };

type Activity = {
	name?: string | null;
	sportType?: string | null;
	startDateLocal?: string | null;
	distanceMi?: number | null;
	movingMin?: number | null;
	athleteCount?: number | null;
};

export type BriefDraft = {
	coverage?: CoverageRow[] | null;
	takeout?: TakeoutRow[] | null;
	blindSpots?: unknown;
	rules?: RuleRow[] | null;
	strava?: Activity[] | null;
	/* The planning pass: the model's keys (prompt.md, The Shape). */
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
	completed?: CompletedRow[] | null;
	/** The Todoist pull's reason when the completed tasks could not be read; "" when they were. */
	completedNote?: unknown;
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

/**
 * The ISO week the mail plans, the one that opens the day after the closed
 * week's Sunday. The subject carries it (entrypoint.sh), and so does the
 * masthead; every other date on the page is the closed week's.
 */
function planningWeek(context: RenderContext): string {
	const monday = fromDate(`${context.sunday}T00:00:00Z`) + 86400;
	const thursday = new Date((monday + 3 * 86400) * 1000);
	const year = thursday.getUTCFullYear();
	const jan4 = Date.UTC(year, 0, 4) / 1000;
	const jan4Weekday = (new Date(jan4 * 1000).getUTCDay() + 6) % 7;
	const week = Math.ceil(((thursday.getTime() / 1000 - jan4) / 86400 + jan4Weekday + 1) / 7);
	return `${year}-W${String(week).padStart(2, "0")}`;
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

/* ---------- the planning pass ---------- */

type RuleRow = {
	area?: unknown;
	budget?: unknown;
	payee?: unknown;
	rename?: unknown;
	category?: unknown;
	mailbox?: unknown;
	sender?: unknown;
	labels?: unknown[] | null;
	star?: unknown;
	markRead?: unknown;
	archive?: unknown;
};

type MoneyRow = {
	budget?: unknown;
	id?: unknown;
	date?: unknown;
	amount?: unknown;
	payee?: unknown;
	rename?: unknown;
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

type FlagRow = { key?: unknown; title?: unknown; what?: unknown; flag?: unknown; default?: unknown; band?: unknown };
type UnplacedRow = { key?: unknown; title?: unknown; what?: unknown; points?: unknown; load?: unknown };
type Finding = { kind?: unknown; what?: unknown; when?: unknown; default?: unknown; band?: unknown };
type TaskRow = {
	id?: unknown;
	content?: unknown;
	due?: unknown;
	priority?: unknown;
	kind?: unknown;
	default?: unknown;
	load?: unknown;
	band?: unknown;
};

type CompletedRow = { id?: unknown; content?: unknown; project?: unknown; completedAt?: unknown; recurring?: unknown };

type SpendLine = { date?: unknown; payee?: unknown; amount?: unknown; category?: unknown; memo?: unknown };
type SpendTrip = { memo?: unknown; total?: unknown; count?: unknown };

type BudgetSpend = {
	month?: unknown;
	dayOfMonth?: unknown;
	daysInMonth?: unknown;
	typical?: {
		spent?: unknown;
		pace?: unknown;
		delta?: unknown;
		monthlyAverage?: unknown;
		months?: { month?: unknown; total?: unknown }[] | null;
	} | null;
	inflows?: SpendLine[] | null;
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
	const date = slice(str(value), 0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return str(value);
	return `${weekdayName(fromDate(`${date}T00:00:00Z`))} ${slice(date, 5)}`;
}

/**
 * A day that stays on one line in a squeezed table column: a no break space
 * and a no break hyphen, so a phone never splits "Wed 01-14" after the hyphen.
 */
function unbroken(day: string): string {
	return day.replace(/ /g, " ").replace(/-/g, "‑");
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

/**
 * The month's spend against its pace, as a figure Forni reads without doing
 * the arithmetic: "+$850.61" is over the pace, "−$120.00" under it. Spend is
 * negative in YNAB, so over the pace is a more negative number.
 */
function overUnder(spent: number, pace: number): { text: string; over: boolean } {
	const delta = Math.abs(spent) - Math.abs(pace);
	if (Math.abs(delta) < 0.005) return { text: "even", over: false };
	return { text: `${delta > 0 ? "+" : "−"}${usd(delta)}`, over: delta > 0 };
}

/**
 * A row's band, lower cased. A row with none (a draft from before the
 * calendar, work and task rows carried one) falls back to what the old rule
 * made it, so an old draft renders the way it was written: a finding, a note
 * and a fold were decisions, and everything else was the session's.
 */
function bandOf(row: { band?: unknown }, fallback: string): string {
	const named = asciiDowncase(str(row.band));
	return named === "" ? fallback : named;
}

function isApplied(band: string): boolean {
	return band === "high" || band === "medium";
}

/** A band matches a named band, or "applied" for either of the two the runner acts on. */
function inBand(band: string, which: string): boolean {
	return which === "applied" ? isApplied(band) : band === which;
}

function writesOn(draft: BriefDraft): boolean {
	return draft.applied?.writes === true;
}

/*
 * Which pull feeds which source, matched on the front of the pull's name
 * (ynab covers ynab-personal and ynab-atelic). A pull named nothing here
 * still shows in This Run.
 */
const SOURCE_PULLS: Record<string, string[]> = {
	Money: ["ynab", "spend", "planning"],
	Email: ["gmail", "inbox", "planning"],
	Work: ["linear", "planning"],
	Calendar: ["calendar", "planning"],
	Tasks: ["todoist", "planning"],
};

/**
 * The entrypoint records a pull named "planning" when the model's planning
 * half did not validate and every planning section was emptied. Every source
 * then opens on the notice, and What I Need From You says so instead of an
 * all clear, since an empty board on a failed half is the one thing this
 * mail must never say.
 */
function planningMissed(draft: BriefDraft): Pull | undefined {
	return missedPulls(draft).find((pull) => asciiDowncase(str(pull.name)) === "planning");
}

function needsEmptyLine(draft: BriefDraft): string {
	const missed = planningMissed(draft);
	if (missed === undefined) return "Nothing needs you this week.";
	return `The planning half was not read this run${str(missed.note) === "" ? "" : `: ${str(missed.note)}`}. Run the Monday session's own passes.`;
}

function missedPulls(draft: BriefDraft): Pull[] {
	return list(draft.pulls).filter((pull) => pull && pull.ok === false);
}

/** The one line notices for a source whose pull was not read. */
function notices(draft: BriefDraft, source: string): string[] {
	const prefixes = SOURCE_PULLS[source] ?? [];
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

/* ---------- money ---------- */

const BUDGETS: { key: "personal" | "atelic"; label: string }[] = [
	{ key: "personal", label: "Personal" },
	{ key: "atelic", label: "Atelic" },
];

/** A row the runner (or the session) categorized: banded high or medium. */
function moneyDone(draft: BriefDraft): MoneyRow[] {
	const rows = list(draft.money?.rows).filter((row) => isApplied(bandOf(row, "decision")));
	if (!writesOn(draft)) return rows;
	// Writes on: only the rows the apply actually approved count as done.
	const done = new Set(list(draft.applied?.ynab).map((a) => str(a.id)));
	return rows.filter((row) => done.has(str(row.id)));
}

/**
 * The rows worth a glance among the ones categorized: anything of $500 or
 * more that was not on an exact rule, and every inflow of that size, since a
 * refund landing is news even when its category is plain (Forni, 2026-11-09:
 * "a $3,000 influx is a lot of money and we should definitely be paying
 * attention to that"; a dry cleaner or a pizza place is not worth a line).
 */
const BIG_ROW = 500;

function bigRows(draft: BriefDraft): MoneyRow[] {
	return moneyDone(draft).filter((row) => {
		const amount = num(row.amount);
		if (Math.abs(amount) < BIG_ROW) return false;
		return amount > 0 || bandOf(row, "decision") === "medium";
	});
}

function moneyRecord(row: MoneyRow): RecordStackItem {
	return {
		title: str(row.rename) === "" ? str(row.payee) : str(row.rename),
		badge: str(row.budget) === "" ? undefined : str(row.budget),
		meta: [dayOf(row.date), str(row.category), str(row.memo)],
		aside: { text: signed(row.amount) },
		note: str(row.reason) === "" ? undefined : str(row.reason),
	};
}

/** A decision row reads its question, not its rule: the reason is the line Forni decides from. */
function moneyDecision(row: MoneyRow): RecordStackItem {
	const category = str(row.category);
	return {
		title: `${str(row.payee)}, ${signed(row.amount)} on ${dayOf(row.date)}`,
		badge: str(row.budget) === "" ? undefined : str(row.budget),
		meta: [category === "" ? "Default: hold it" : `Default: ${category}`],
		note: str(row.reason) === "" ? undefined : str(row.reason),
	};
}

function moneyRows(draft: BriefDraft, which: string): MoneyRow[] {
	return list(draft.money?.rows).filter((row) => inBand(bandOf(row, "decision"), which));
}

function deleteRecords(draft: BriefDraft): RecordStackItem[] {
	return list(draft.money?.deletes).map((row) => ({
		title: `Delete ${str(row.payee)}, ${signed(row.amount)} on ${dayOf(row.date)}`,
		badge: str(row.budget) === "" ? undefined : str(row.budget),
		meta: ["Default: delete it"],
		note: str(row.reason) === "" ? undefined : str(row.reason),
	}));
}

function tripMemoRecords(draft: BriefDraft): RecordStackItem[] {
	return list(draft.money?.trips).map((row) => {
		const count = list(row.ids).length;
		return {
			title: `Memo ${count} ${count === 1 ? "charge" : "charges"} as ${str(row.memo)}`,
			meta: ["Default: write the memo"],
		};
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

function accountsInError(draft: BriefDraft): string {
	return spendBudgets(draft)
		.filter(({ spend }) => spend && list(spend.accountsInError).length > 0)
		.map(({ label, spend }) => `${label}: ${list(spend?.accountsInError).map(str).join(", ")}`)
		.join(". ");
}

/* ---------- email ---------- */

function inboxRows(draft: BriefDraft, which: string): InboxRow[] {
	return list(draft.inbox?.rows).filter((row) => inBand(bandOf(row, "decision"), which));
}

/** The messages filed: labeled or archived by the runner, or by the session when writes were off. */
function emailDone(draft: BriefDraft): InboxRow[] {
	const rows = list(draft.inbox?.rows);
	if (writesOn(draft)) {
		return list(draft.applied?.gmail).flatMap((done) => {
			const row = rows.find((candidate) => str(candidate.id) === str(done.id));
			return row ? [row] : [];
		});
	}
	// A keep that adds a label is filed too; a bare keep is kept, below.
	return rows.filter(
		(row) =>
			isApplied(bandOf(row, "decision")) &&
			(["label", "archive"].includes(str(row.action)) || (str(row.action) === "keep" && hasLabels(row))),
	);
}

function hasLabels(row: InboxRow): boolean {
	return list(row.labels).some((label) => str(label) !== "");
}

/** The messages left exactly as they are: a keep with no label to add, so nothing was filed. */
function emailKept(draft: BriefDraft): InboxRow[] {
	return list(draft.inbox?.rows).filter(
		(row) => isApplied(bandOf(row, "decision")) && str(row.action) === "keep" && !hasLabels(row),
	);
}

/** The tasks the mail asks the session to create, each a row the reader can check. */
function emailTasks(draft: BriefDraft): InboxRow[] {
	return list(draft.inbox?.rows).filter((row) => isApplied(bandOf(row, "decision")) && str(row.action) === "task");
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

/** A decision message leads with what it says, and its default is the action proposed. */
function inboxDecision(row: InboxRow): RecordStackItem {
	const action = inboxAction(row);
	return {
		title: str(row.subject) === "" ? "(no subject)" : str(row.subject),
		url: str(row.link) === "" ? undefined : str(row.link),
		badge: str(row.mailbox) === "" ? undefined : str(row.mailbox),
		meta: [str(row.from), str(row.date), action === "" ? "" : `Default: ${action}`],
		note: str(row.what) === "" ? undefined : str(row.what),
	};
}

function droppedInbox(draft: BriefDraft): RecordStackItem[] {
	return dropped(draft, "gmail", (id) => {
		const row = list(draft.inbox?.rows).find((candidate) => str(candidate.id) === id);
		return row ? str(row.subject) : id;
	});
}

/* ---------- work, calendar, tasks ---------- */

function issueURL(key: string): string | undefined {
	return /^[A-Za-z]+-\d+$/.test(key) ? `https://linear.app/atelic/issue/${key}` : undefined;
}

function issueTitle(key: string, title: string): string {
	return [key, title].filter((part) => part !== "").join(" ");
}

function flagRecord(row: FlagRow): RecordStackItem {
	return {
		title: issueTitle(str(row.key), str(row.title)),
		url: issueURL(str(row.key)),
		badge: str(row.flag) === "" ? undefined : str(row.flag),
		meta: [str(row.default) === "" ? "" : `Default: ${str(row.default)}`],
		note: str(row.what) === "" ? undefined : str(row.what),
	};
}

function flags(draft: BriefDraft, which: string): FlagRow[] {
	return list(draft.work?.flags).filter((row) => inBand(bandOf(row, "medium"), which));
}

function findingRecord(row: Finding): RecordStackItem {
	return {
		title: str(row.what),
		badge: str(row.kind) === "" ? undefined : str(row.kind),
		meta: [str(row.when)],
		note: str(row.default) === "" ? undefined : `Default: ${str(row.default)}`,
	};
}

function findings(draft: BriefDraft, which: string): Finding[] {
	return list(draft.calendar?.findings).filter((row) => inBand(bandOf(row, "decision"), which));
}

function taskRecord(row: TaskRow): RecordStackItem {
	return {
		title: str(row.content),
		badge: str(row.kind) === "" ? undefined : str(row.kind),
		meta: [str(row.due) === "" ? "" : `due ${dayOf(row.due)}`, str(row.priority), str(row.load)],
		note: str(row.default) === "" ? undefined : `Default: ${str(row.default)}`,
	};
}

/** A task row's band when the draft gave none: a note or a fold was a decision, the rest the session's. */
function taskFallback(row: TaskRow): string {
	const kind = asciiDowncase(str(row.kind));
	return kind === "note" || kind === "duplicate" ? "decision" : "medium";
}

function taskRows(draft: BriefDraft, which: string): TaskRow[] {
	return list(draft.tasks?.rows).filter((row) => inBand(bandOf(row, taskFallback(row)), which));
}

/* ---------- the parts of a card ---------- */

/**
 * A titled block inside a card: a table or a stack, or the plain sentence
 * that stands in when it has nothing. `notes` are short asides that sit
 * under the block, eyebrow first.
 */
type Part = {
	title: string;
	html: ReactNode | null;
	text: string | null;
	empty: string;
	notes?: { eyebrow: string; text: string; accented: boolean }[];
};

function stackPart(title: string, records: RecordStackItem[], empty: string): Part {
	return {
		title: `${title} · ${records.length}`,
		html: records.length === 0 ? null : <RecordStack records={records} />,
		text: records.length === 0 ? null : recordStackText(records),
		empty,
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

/* ---------- money, the month so far ---------- */

/**
 * The month so far as one striped data table: what went out, what came in,
 * the pace, and the delta against it, green under and red over (Forni,
 * 2026-11-09). Inflows are a total, never a list; trips are gone; outliers
 * stay as a small table under it when there are any, since they are what
 * keeps the typical line honest. The warning sign rides on the eyebrow when
 * an account is in error, with the warning itself at the bottom.
 */
function spendParts(draft: BriefDraft): Part[] {
	const budgets = spendBudgets(draft);
	const read = budgets.filter((budget) => budget.spend !== null);
	if (read.length === 0) {
		return [{ title: "Money", html: null, text: null, empty: "Spend was not read this run." }];
	}
	const notes: Part["notes"] = [];
	for (const missing of budgets.filter((budget) => budget.spend === null)) {
		notes.push({ eyebrow: missing.label, text: "Not read this run.", accented: false });
	}
	const errors = accountsInError(draft);

	const typical = read.map(({ label, spend }) => {
		const spent = num(spend?.typical?.spent);
		const pace = num(spend?.typical?.pace);
		const inflow = list(spend?.inflows).reduce((sum, row) => sum + num(row.amount), 0);
		return { label, spent, inflow, pace, delta: overUnder(spent, pace) };
	});
	const parts: Part[] = [
		{
			title: `Money${errors === "" ? "" : " · ⚠️"}`,
			html: (
				<StripedTable
					columns={[
						{ label: "Budget" },
						// Short heads: a header never wraps, and five of them have to fit a phone.
						{ label: "Out", right: true },
						{ label: "In", right: true },
						{ label: "Pace", right: true },
						{ label: "Delta", right: true },
					]}
					rows={typical.map((row) => [
						{ value: row.label },
						{ value: usd(row.spent), mono: true },
						{ value: row.inflow === 0 ? "" : usd(row.inflow), mono: true },
						{ value: usd(row.pace), mono: true },
						{ value: row.delta.text, mono: true, tone: row.delta.over ? "down" : "up" },
					])}
				/>
			),
			text: textTable(
				["Budget", "Out", "In", "Pace", "Delta"],
				typical.map((row) => [
					row.label,
					usd(row.spent),
					row.inflow === 0 ? "" : usd(row.inflow),
					usd(row.pace),
					row.delta.text,
				]),
				[1, 2, 3, 4],
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
	}
	if (errors !== "") {
		const last = parts[parts.length - 1];
		last.notes = [
			...(last.notes ?? []),
			{
				eyebrow: "⚠️ Accounts in Error",
				text: `${errors}. Every number above is a floor until the connection is repaired in the YNAB app.`,
				accented: true,
			},
		];
	}
	return parts;
}

/* ---------- done, the tasks completed ---------- */

/**
 * One line, not a table: the count of tasks completed in the closed week is
 * the summary Forni wanted and the list is not (2026-11-09). A run whose
 * Todoist pull did not include them says so rather than saying zero.
 */
function completedLine(draft: BriefDraft): string {
	if (!Array.isArray(draft.completed) || str(draft.completedNote) !== "") {
		return "The tasks completed last week were not read this run.";
	}
	const count = draft.completed.length;
	return `${numberString(count)} ${count === 1 ? "task" : "tasks"} completed last week.`;
}

/* ---------- this week: the ledger ---------- */

/**
 * The ledger: one line per source saying what was done, in counts, with a
 * notice where a pull was not read. The rows worth a glance follow it as
 * parts, and the whole thing is short on purpose: the point is that Forni
 * can trust it and look only where a count surprises him.
 */
type Ledger = { source: string; did: string };

function plural(count: number, one: string, many: string): string {
	return `${numberString(count)} ${count === 1 ? one : many}`;
}

/** A name cut to fit a ledger line, an ellipsis where the rest was. */
function short(value: string): string {
	const chars = [...value];
	return chars.length <= 48 ? value : `${chars.slice(0, 47).join("").trimEnd()}…`;
}

/** "the subject", "the subject and the other", "a, b and c": names in a sentence. */
function named(items: string[]): string {
	const names = items.filter((item) => item !== "").map(short);
	if (names.length <= 1) return names.join("");
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The hours a list of unplaced issues asks for: one point is thirty minutes. */
function hoursOf(rows: UnplacedRow[]): string {
	const points = rows.reduce((sum, row) => sum + num(row.points), 0);
	const hours = points / 2;
	return `${Number.isInteger(hours) ? numberString(hours) : hours.toFixed(1)} ${hours === 1 ? "hour" : "hours"}`;
}

/** The task a message creates, as its title when the row names one, else the subject. */
function taskName(row: InboxRow): string {
	const what = str(row.what);
	const match = what.match(/task[^:]*:\s*([^;.]+)/i);
	return match ? match[1].trim() : str(row.subject);
}

function ledger(draft: BriefDraft): Ledger[] {
	const lines: Ledger[] = [];
	const notice = (source: string) => notices(draft, source)[0];
	const money = moneyDone(draft).length;
	lines.push({ source: "Money", did: notice("Money") ?? `${plural(money, "row", "rows")} categorized` });
	// Money and email have an apply path, so their lines say what was done;
	// the work, calendar and task rows have none yet, so their lines say what
	// the Monday sitting has to do (review of PR #410).
	const filed = emailDone(draft);
	const tasks = emailTasks(draft);
	const kept = emailKept(draft).length;
	// A star or a reply has no apply path; the sitting makes it, so say so.
	const acts = list(draft.inbox?.rows).filter(
		(row) => isApplied(bandOf(row, "decision")) && ["star", "reply"].includes(str(row.action)),
	).length;
	lines.push({
		source: "Email",
		did:
			notice("Email") ??
			[
				filed.length === 0
					? "nothing filed"
					: `${plural(filed.length, "message", "messages")} filed${filed.length <= 3 ? ` (${named(filed.map((row) => str(row.subject)))})` : ""}`,
				tasks.length === 0
					? ""
					: `${plural(tasks.length, "task", "tasks")} to create${tasks.length <= 3 ? ` (${named(tasks.map(taskName))})` : ""}`,
				kept === 0 ? "" : `${numberString(kept)} kept`,
				acts === 0 ? "" : `${plural(acts, "message", "messages")} to star or reply to`,
			]
				.filter((part) => part !== "")
				.join("; "),
	});
	const set = flags(draft, "applied").length;
	const unplaced = list(draft.work?.unplaced);
	lines.push({
		source: "Work",
		did:
			notice("Work") ??
			[
				unplaced.length === 0
					? "every issue has a block"
					: `${plural(unplaced.length, "issue", "issues")} to place, about ${hoursOf(unplaced)}`,
				set === 0 ? "" : `${plural(set, "field", "fields")} to set`,
			]
				.filter((part) => part !== "")
				.join("; "),
	});
	const fixes = findings(draft, "applied").length;
	lines.push({ source: "Calendar", did: notice("Calendar") ?? `${plural(fixes, "fix", "fixes")} to make` });
	const placed = taskRows(draft, "applied").length;
	lines.push({ source: "Tasks", did: notice("Tasks") ?? `${plural(placed, "task", "tasks")} to place` });
	return lines;
}

/* ---------- this week: the new rules ---------- */

function moneyRules(draft: BriefDraft): RuleRow[] {
	return list(draft.rules).filter((row) => asciiDowncase(str(row.area)) === "money" && str(row.payee) !== "");
}

function emailRules(draft: BriefDraft): RuleRow[] {
	return list(draft.rules).filter((row) => asciiDowncase(str(row.area)) === "email" && str(row.sender) !== "");
}

/**
 * The money rules as a table Forni reads at a glance: the budget, the payee
 * as it will be named from now on, and the category it takes. The descriptor
 * a renamed payee came in under is not worth a column (Forni, 2026-11-09).
 */
function moneyRulesPart(draft: BriefDraft): Part {
	const rows = moneyRules(draft);
	const payee = (row: RuleRow) => (str(row.rename) === "" ? str(row.payee) : str(row.rename));
	return {
		title: `Money Rules · ${rows.length}`,
		html:
			rows.length === 0 ? null : (
				<Records
					columns={[{ label: "Budget" }, { label: "Payee" }, { label: "Category" }]}
					rows={rows.map((row) => [
						{ value: str(row.budget), muted: true },
						{ value: payee(row) },
						{ value: str(row.category) },
					])}
				/>
			),
		text:
			rows.length === 0
				? null
				: textTable(
						["Budget", "Payee", "Category"],
						rows.map((row) => [str(row.budget), payee(row), str(row.category)]),
						[],
					),
		empty: "Every money row sat on a rule already written.",
	};
}

/** "✓" for a rule that does the thing, "✗" for one that does not. */
function check(value: unknown): string {
	return value === true ? "✓" : "✗";
}

/** The email rules as a table of checks: the labels added, the star set, read, archived. */
function emailRulesPart(draft: BriefDraft): Part {
	const rows = emailRules(draft);
	const labels = (row: RuleRow) => list(row.labels).map(str).filter((label) => label !== "").join(", ");
	const star = (row: RuleRow) => (str(row.star) === "" ? "✗" : str(row.star));
	return {
		title: `Email Rules · ${rows.length}`,
		html:
			rows.length === 0 ? null : (
				<Records
					columns={[
						{ label: "Mailbox" },
						{ label: "Sender" },
						{ label: "Label" },
						{ label: "Star" },
						{ label: "Read", right: true },
						{ label: "Archive", right: true },
					]}
					rows={rows.map((row) => [
						{ value: str(row.mailbox), muted: true },
						{ value: str(row.sender) },
						{ value: labels(row) },
						{ value: star(row), muted: str(row.star) === "" },
						{ value: check(row.markRead), muted: row.markRead !== true },
						{ value: check(row.archive), muted: row.archive !== true },
					])}
				/>
			),
		text:
			rows.length === 0
				? null
				: textTable(
						["Mailbox", "Sender", "Label", "Star", "Read", "Archive"],
						rows.map((row) => [str(row.mailbox), str(row.sender), labels(row), star(row), check(row.markRead), check(row.archive)]),
						[],
					),
		empty: "Every message sat on a rule already written.",
	};
}

/** The parts under the ledger: the big money rows, anything the apply dropped, and the rules the week proposes. */
function didParts(draft: BriefDraft): Part[] {
	const parts: Part[] = [];
	const big = bigRows(draft).map(moneyRecord);
	if (big.length > 0) parts.push(stackPart("Big Rows", big, ""));
	const drops = [...droppedMoney(draft), ...droppedInbox(draft)];
	if (drops.length > 0) parts.push(stackPart("Dropped", drops, ""));
	parts.push(moneyRulesPart(draft), emailRulesPart(draft));
	return parts;
}

/** The one honest sentence over the ledger: what was applied overnight and what waits for the sitting. */
function didLine(draft: BriefDraft): string {
	return writesOn(draft)
		? "Money and email were applied overnight; the work, calendar and task rows are made in the Monday sitting. Every row is in the attached plan, and a correction on Monday is a rule for next week."
		: "Writes were off this run, so every row below is applied in the Monday sitting.";
}

/* ---------- what I need from you ---------- */

/**
 * The decision rows alone, grouped by source and numbered within the group,
 * so a reply can say "Money 2, no". The groups run in the order the sources
 * do, and a source with nothing to decide is not drawn at all.
 */
type Needs = { name: string; records: RecordStackItem[] };

function needs(draft: BriefDraft): Needs[] {
	const groups: Needs[] = [
		{
			name: "Money",
			records: [
				...moneyRows(draft, "decision").map(moneyDecision),
				...deleteRecords(draft),
				...tripMemoRecords(draft),
			],
		},
		{ name: "Email", records: inboxRows(draft, "decision").map(inboxDecision) },
		{ name: "Work", records: flags(draft, "decision").map(flagRecord) },
		{ name: "Calendar", records: findings(draft, "decision").map(findingRecord) },
		{ name: "Tasks", records: taskRows(draft, "decision").map(taskRecord) },
	];
	return groups
		.filter((group) => group.records.length > 0)
		.map((group) => ({
			name: group.name,
			records: group.records.map((record, index) => ({ ...record, title: `${index + 1}. ${record.title}` })),
		}));
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

/* ---------- html ---------- */

export function briefHTML(input: unknown, context: RenderContext): string {
	const draft = input as BriefDraft;
	const week = sessions(draft);
	const movement = [...movementTargets(draft), takeoutTarget(draft)];
	const planning = planningWeek(context);
	const groups = needs(draft);
	const lines = ledger(draft);
	const blindSpots = jqToString(alt(draft.blindSpots, ""));
	const missed = missedRecords(draft);

	return renderEmail({
		title: `${planning} Brief`,
		preheader: `Week ${weekNumber(context.week)} closed; ${groups.length === 0 ? (planningMissed(draft) === undefined ? "nothing needs you" : "the planning half was not read") : plural(groups.reduce((sum, group) => sum + group.records.length, 0), "decision", "decisions")} for week ${weekNumber(planning)}.`,
		children: (
			<>
				<Masthead title={`Brief · Week ${weekNumber(planning)}`} />
				<TitleCard
					eyebrowText={`Week ${weekNumber(context.week)}`}
					headlineLines={["Last Week"]}
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
							</Scoreboard>
							<SpacerRow />
							<SubEyebrow text="By Day" />
							<DayStrip days={days(context.monday, week)} last={false} />
							{notices(draft, "Money").map((note, index) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: a notice's position is its identity
								<EmptyRow key={index} text={note} />
							))}
							{partsHTML(spendParts(draft))}
							<EmptyRow text={completedLine(draft)} />
						</>
					}
				/>

				<Eyebrow text="This Week" />
				<Card>
					<ReadBlock text={didLine(draft)} divider={true} />
					<SubEyebrow text="The Ledger" />
					<RecordsRow last={false}>
						<Records
							columns={[{ label: "Source" }, { label: "Did" }]}
							rows={lines.map((line) => [{ value: line.source, muted: true }, { value: line.did }])}
						/>
					</RecordsRow>
					{partsHTML(didParts(draft))}
				</Card>

				<Eyebrow text="What I Need From You" />
				<Card>
					{groups.length === 0 ? (
						<EmptyRow text={needsEmptyLine(draft)} />
					) : (
						groups.map((group, index) => (
							<Fragment key={group.name}>
								<SubEyebrow text={`${group.name} · ${group.records.length}`} />
								<RecordsRow last={index === groups.length - 1}>
									<RecordStack records={group.records} />
								</RecordsRow>
							</Fragment>
						))
					)}
				</Card>

				<Eyebrow text="This Run" />
				<Card>
					<Row last={false}>
						<StatStrip stats={runStats(draft)} />
					</Row>
					{blindSpots === "" ? null : <ReadBlock text={blindSpots} divider={true} />}
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

				<Footer meta={context.meta} />
			</>
		),
	});
}

/* ---------- plain text ---------- */

export function briefText(input: unknown, context: RenderContext): string {
	const draft = input as BriefDraft;
	const week = sessions(draft);
	const planning = planningWeek(context);
	const movement = [...movementTargets(draft), takeoutTarget(draft)];

	let out = `ATELIC · BRIEF · WEEK ${weekNumber(planning)}\n`;
	out += textSection(`Last Week · Week ${weekNumber(context.week)}`);
	out += `Movement\n${movement.map(textTarget).join("\n")}\n`;
	out += `\nBy Day\n${days(context.monday, week)
		.map((day) => {
			const entries = day.entries
				.map((entry) => `${entry.name}${entry.strong ? " (S)" : ""}`)
				.join(" · ");
			return `  ${rpad(day.label, 5)}${entries === "" ? "Rest" : entries}`;
		})
		.join("\n")}\n`;
	for (const note of notices(draft, "Money")) out += `\n${wrap(note)}\n`;
	out += partsText(spendParts(draft));
	out += `\n${wrap(completedLine(draft))}\n`;

	out += textSection("This Week") + textRead(didLine(draft));
	out += `\nThe Ledger\n${textTable(
		["Source", "Did"],
		ledger(draft).map((line) => [line.source, line.did]),
		[],
	)}\n`;
	out += partsText(didParts(draft));

	out += textSection("What I Need From You");
	const groups = needs(draft);
	if (groups.length === 0) out += `${wrap(needsEmptyLine(draft))}\n`;
	else for (const group of groups) out += `\n${group.name} · ${group.records.length}\n${recordStackText(group.records)}\n`;

	out += textSection("This Run");
	out += runStats(draft)
		.map((stat) => `  ${rpad(stat.label, 16)}${stat.n}`)
		.join("\n");
	out += "\n";
	const blindSpots = jqToString(alt(draft.blindSpots, ""));
	if (blindSpots !== "") out += `\nBlind Spots\n${wrap(blindSpots)}\n`;
	const missed = missedRecords(draft);
	out += missed.length === 0 ? "\n  Every pull was read.\n" : `\nNot Read · ${missed.length}\n${recordStackText(missed)}\n`;
	out += `\n\n${context.meta}\n`;
	return out;
}

/** What the bundle built for this runner renders: build.mjs aliases "runner-page" to this file. */
export const page: Page = { html: briefHTML, text: briefText };
