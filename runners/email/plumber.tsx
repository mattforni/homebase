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
import { DimLine, type NeedsGroup, type NeedsItem, NeedsList, RosterLine } from "./local";
import { money } from "./records";
import { hang } from "./text";
import type { RenderContext } from "./types";

/*
 * The Pipeline email: what needs Forni first, then the health of the funnel,
 * and no lists of names. Reshaped 2026-10-07 (ATE-630) after he opened the
 * W41 mail, met dozens of MQL names, and could not tell which of them needed
 * him: it was a to do list problem wearing a report. So the mail is two
 * things now. Needs You Now is one numbered list in his own order, customers
 * before proposals before conversations before cold outreach, a named line
 * for everything that has a person waiting on the other end and a bare count
 * for the outreach kinds, whose names live in the roster. Funnel Health is
 * the strip, how many names entered and left each stage, and the open rate of
 * the last four send weeks, all as counts.
 *
 * The runner, not the model, supplies the funnel, the groom, the named lines
 * (`needs`) and the send weeks (`health`): the sweep reads the groom's seven
 * buckets now and seven days ago off HubSpot's own entered dates, moves every
 * stage and status the record justifies, and the entrypoint folds all of it
 * into the draft before the render. The model writes the read and the names
 * owed a touch, which the mail only counts. Everything the email leaves out
 * lives in the roster, which the runner commits into the Atelic repo and the
 * read card links as its last line (roster_url); a run that could not push
 * attaches it instead.
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

/** A name owed a touch. The draft carries the person, the company and a note as well; the mail reads only whether a send was opened. */
type Name = { metrics?: { opens?: number | null } | null };
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
 * by when, and a link. `ref` is a ticket key ("ATE-633") and takes the link
 * when there is one; without it the link rides on the name, which is what a
 * HubSpot hold looks like. `due` is an ISO date. `amount` is a proposal's
 * money, in dollars.
 */
type NeedLine = {
	who?: unknown;
	owed?: unknown;
	due?: unknown;
	ref?: unknown;
	url?: string | null;
	amount?: number | null;
};
/** A tier of named lines. `key` is one of NEED_TIERS; `label` overrides the label there. The runner sorts a tier's lines, soonest due first. */
type NeedTier = { key?: unknown; label?: unknown; lines?: NeedLine[] | null };
type Needs = { tiers?: NeedTier[] | null } | null;

/** One send week: the tracked sends, how many were opened, the rate in whole percent, and the change in points on the week before. */
type SendWeek = {
	/** "2026-W38", which reads as W38. */
	week?: unknown;
	/** Every send that week, tracked or not; the column shows only when a week carries it. */
	sends?: number | null;
	tracked?: number | null;
	opened?: number | null;
	rate?: number | null;
	/** Null on the first row, which has no week before it. */
	delta?: number | null;
	/** True for a week still running, which reads "W41 so far". */
	partial?: boolean | null;
};
/** The trailing send weeks, oldest first, and one sentence to call out when the rate has turned. */
type Health = { weeks?: SendWeek[] | null; flag?: string | null } | null;

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
 * The outreach the list counts and never names, in the same order (Forni,
 * 2026-10-07, ATE-630): bumps to people who opened, then first touches, then
 * bumps to people who have not opened. Replies sit ahead of all three for
 * now, directly under the warm SQLs, until the runner folds each reply into
 * that tier as a named line. Visits and decides close the list: his order
 * does not name them, and they are still his to do. Until W41 the mail
 * carried a card per person here, first touches leading (2026-09-29), and
 * until W40 replies led.
 */
const OWED_COUNTS: { label: string; count: (owed: Owed) => number; drafted?: string; tail?: string }[] = [
	{ label: "Replies owed", count: (owed) => alt(owed.reply, []).length },
	{ label: "Bumps to people who opened", count: (owed) => bumps(owed, true), drafted: "bump" },
	{ label: "First touches", count: (owed) => alt(owed.first_touch, []).length, drafted: "first_touch" },
	{ label: "Bumps to people who have not opened", count: (owed) => bumps(owed, false), drafted: "bump" },
	{ label: "Visits", count: (owed) => alt(owed.visit, []).length, tail: "Thursday walkabout" },
	{ label: "Decisions owed", count: (owed) => alt(owed.decide, []).length },
];

/** The bumps owed to people who opened a send, or to the ones who did not; an untracked send counts as not opened. */
function bumps(owed: Owed, opened: boolean): number {
	return alt(owed.bump, []).filter((name) => alt(name.metrics?.opens, 0) > 0 === opened).length;
}

/**
 * What a count line says about its drafts, read off the fires of its kind of
 * touch: "drafts ready" when every one fired, a pointer at the Drafting card
 * when one did not, and nothing at all when the runner fired none, so the
 * line never promises a draft nobody asked for.
 */
function draftedWord(drafting: Drafting, touch: string, count: number): string {
	const fires = alt(drafting?.fires, []).filter((fire) => jqToString(alt(fire.touch, "")) === touch);
	if (fires.length === 0) return "";
	if (fires.some((fire) => jqToString(alt(fire.outcome, "")) !== "fired")) return ", not every draft fired";
	return count === 1 ? " draft ready" : " drafts ready";
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
 * Thu 10-08. ATE-633." The money follows the name on a proposal. The link
 * rides on the ticket key, or on the name when there is no key.
 */
function needItem(line: NeedLine): NeedsItem {
	const ref = jqToString(alt(line.ref, ""));
	const cash = money(line.amount);
	const owed = jqToString(alt(line.owed, ""));
	const due = dueText(line.due);
	return {
		lead: jqToString(line.who),
		url: ref === "" ? line.url : null,
		rest: `${cash === "" ? "" : `, ${cash}`}${owed === "" && due === "" ? "" : ":"}${owed === "" ? "" : ` ${sentence(owed)}`}`,
		due: due === "" ? undefined : due,
		ref: ref === "" ? undefined : ref,
		refUrl: ref === "" ? null : line.url,
	};
}

/** The named tiers in the list's order, each under its label, the empty ones dropped. */
function needGroups(needs: Needs): NeedsGroup[] {
	const tiers = alt(needs?.tiers, []);
	const known = NEED_TIERS.map((tier) => tier.key);
	const ordered = [
		...NEED_TIERS.flatMap((tier) => tiers.filter((t) => jqToString(alt(t.key, "")) === tier.key)),
		...tiers.filter((t) => !known.includes(jqToString(alt(t.key, "")))),
	];
	return ordered
		.map((tier) => {
			const fallback = NEED_TIERS.find((t) => t.key === jqToString(alt(tier.key, "")))?.label ?? jqToString(alt(tier.key, ""));
			const label = jqToString(alt(tier.label, ""));
			return { label: label === "" ? fallback : label, items: alt(tier.lines, []).map(needItem) };
		})
		.filter((group) => group.items.length > 0);
}

/** The count lines, one per kind of outreach with anything owed; a zero says nothing. */
function countGroup(draft: PipelineDraft): NeedsGroup[] {
	const owed = alt(draft.owed, {});
	const items = OWED_COUNTS.map((line) => ({ line, count: line.count(owed) }))
		.filter(({ count }) => count > 0)
		.map(({ line, count }) => {
			const drafted = line.drafted === undefined ? "" : draftedWord(draft.drafting ?? null, line.drafted, count);
			const tail = drafted !== "" ? drafted : line.tail === undefined ? "" : `, ${line.tail}`;
			return { lead: line.label, rest: `: ${numberString(count)}${tail}` };
		});
	return items.length === 0 ? [] : [{ label: "Touches Owed", items }];
}

/** The whole list: the named tiers, then the counts. */
function needsOf(draft: PipelineDraft): NeedsGroup[] {
	return [...needGroups(draft.needs ?? null), ...countGroup(draft)];
}

function lineCount(groups: NeedsGroup[]): number {
	return groups.reduce((sum, group) => sum + group.items.length, 0);
}

/**
 * The list's plain text twin: each group under its label in upper case, each
 * line under its number with a hanging indent, and the link on a line of its
 * own beneath, since a url is the one token the wrap cannot break.
 */
function needsText(groups: NeedsGroup[]): string {
	const width = numberString(lineCount(groups)).length + 2;
	let n = 0;
	return groups
		.map((group) => {
			const lines = group.items.map((item) => {
				n += 1;
				const url = jqToString(alt(item.refUrl, alt(item.url, "")));
				const text = `${item.lead}${item.rest}${item.due ? ` ${item.due}` : ""}${item.ref ? ` ${item.ref}.` : ""}`;
				return `${hang(lpad(`${numberString(n)}.`, width - 1), text, width)}${url === "" ? "" : `${spaces(2 + width)}${url}\n`}`;
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

function healthWeeks(health: Health): SendWeek[] {
	return alt(health?.weeks, []);
}

/** "W38" from "2026-W38", and "W41 so far" for the week still running. */
function weekLabel(week: SendWeek): string {
	const raw = jqToString(alt(week.week, ""));
	const label = /^\d{4}-W\d{2}$/.test(raw) ? `W${weekNumber(raw)}` : raw;
	return week.partial === true ? `${label} so far` : label;
}

function optional(n: number | null | undefined): string {
	return n === null || n === undefined ? "" : numberString(n);
}

/** One send week as the five values the table shows: the sends, the tracked, the opened, the rate, the change in points. */
function weekValues(week: SendWeek): string[] {
	const rate = optional(week.rate);
	const delta = week.delta === null || week.delta === undefined ? "" : `${signed(week.delta)} ${Math.abs(week.delta) === 1 ? "pt" : "pts"}`;
	return [weekLabel(week), optional(week.sends), optional(week.tracked), optional(week.opened), rate === "" ? "" : `${rate}%`, delta];
}

/** Short on purpose: at a phone's width the five headers have about three hundred pixels between them, and "Tracked Sends" beside "Open Rate" squeezed the week into three lines. */
const WEEK_COLUMNS = ["Week", "Sends", "Tracked", "Opened", "Rate", "Change"];

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
	const needs = needsOf(draft);
	const weeks = healthWeeks(draft.health ?? null);
	const flag = jqToString(alt(draft.health?.flag, ""));
	const left = leftForYou(draft);
	const rosterUrl = jqToString(alt(draft.roster_url, ""));
	const drafting = draft.drafting ?? null;
	const misfires = misfireRecords(drafting);

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

				<Eyebrow text={needs.length === 0 ? "Needs You Now" : `Needs You Now · ${numberString(lineCount(needs))}`} strong={true} />
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
						<Eyebrow text="Tracked Sends and Open Rate by Week" />
						<Card>
							{flag === "" ? null : <Note eyebrowText="Flag" text={flag} accented={true} last={false} />}
							<Row last={true}>
								<Records
									columns={WEEK_COLUMNS.map((label, i) => ({ label, right: i > 0 }))}
									rows={weeks.map((week) =>
									weekValues(week).map((value, i) =>
										i === 0 ? { value, html: <span style={{ whiteSpace: "nowrap" }}>{value}</span> } : { value, mono: true },
									),
								)}
								/>
							</Row>
						</Card>
					</>
				)}

				{drafting === null ? null : (
					<>
						<Eyebrow text={`Drafting · ${numberString(alt(drafting.fires, []).length)}`} strong={true} />
						<Card>
							<Row last={misfires.length === 0}>
								<DimLine text={jqToString(alt(drafting.note, ""))} />
							</Row>
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
	const needs = needsOf(draft);
	const weeks = healthWeeks(draft.health ?? null);
	const flag = jqToString(alt(draft.health?.flag, ""));
	const left = leftForYou(draft);

	let out = `ATELIC · PIPELINE · WEEK ${number} · ${shortDate(context.monday)} TO ${shortDate(context.sunday)}\n\n`;
	out += `${asciiUpcase(alt(draft.headline, []).join("\n"))}\n`;
	const lede = unindent(jqToString(alt(draft.lede, "")));
	if (lede !== "") out += `\n${textRead(lede)}`;
	const rosterUrl = jqToString(alt(draft.roster_url, ""));
	if (rosterUrl !== "") out += `\nThe full read is in the roster: ${rosterUrl}\n`;

	out += textSection(needs.length === 0 ? "Needs You Now" : `Needs You Now · ${numberString(lineCount(needs))}`);
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
		out += "\nTracked Sends and Open Rate by Week\n";
		if (flag !== "") out += `${wrap(`Flag: ${flag}`)}\n\n`;
		out += `${textTable(WEEK_COLUMNS, weeks.map(weekValues), [1, 2, 3, 4, 5])}\n`;
	}

	const drafting = draft.drafting ?? null;
	if (drafting !== null) {
		const misfires = misfireRecords(drafting);
		out += textSection(`Drafting · ${numberString(alt(drafting.fires, []).length)}`);
		out += `${wrap(jqToString(alt(drafting.note, "")))}\n`;
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
