import { Fragment } from "react";
import {
	asciiUpcase,
	Card,
	EmptyRow,
	Eyebrow,
	Footer,
	List,
	ListRow,
	Masthead,
	type RecordBadge,
	RecordStack,
	type RecordStackItem,
	recordStackText,
	RecordTimelineLegend,
	Row,
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
import { alt, jqToString, numberString, shortDate, unindent, weekNumber } from "./jq";
import { DimLine, NameRun, RosterLine } from "./local";
import { recordCard, statusWord, TIMELINE_DAYS, type TouchLine } from "./records";
import type { RenderContext } from "./types";

/*
 * The Pipeline email: the state of the pipeline first, then what the week
 * owes. Reshaped 2026-09-24 on the retro's Atelic section (ATE-551), after
 * the board first layout read to Forni as the same email in different words,
 * then tuned the same morning off his phone: relative times instead of ISO
 * dates on a record, the last open beside the last touch, a strip that holds
 * two rows (New left off it and read as a line), one card per listed stage
 * so the boundaries show, and every record on the same two lines so the eye
 * learns where each number sits.
 *
 * The runner, not the model, supplies the funnel, the groom and the numbers
 * on the owed names: the sweep reads the groom's seven buckets now and seven
 * days ago off HubSpot's own entered dates, moves every stage and status the
 * record justifies, and the entrypoint folds all of it into the draft before
 * the render. The model writes the read, the names owed with a note each,
 * and up to five flags. New and Closed are read as a count and a week over
 * week change on the strip; Lead, MQL, SQL and Oppty list every company;
 * Customer lists only a customer with activity this week, and the card stays
 * out when there was none (Forni, 2026-09-29). Every list is a RecordStack so a name
 * never squashes on a phone. Everything the email leaves out lives in the
 * roster, which the runner commits into the Atelic repo and the read card
 * links as its last line (roster_url); a run that could not push attaches it
 * instead.
 *
 * The stage cards are the Company Cards IA (Forni, 2026-09-29): inside a
 * stage the names sit under the touch they owe next (Reply, Decide, Visit,
 * Bump, First touch, Waiting), each on the shared card with a New pill when
 * it entered the stage this week, the next touch as a pill, a thirty day
 * timeline of its sends and last open, the counts, and the open's age set
 * right. The model's note on an owed name rides on its company's card. So
 * This Week keeps its strip and the first touch list alone; every other owed
 * name already sits under its group in its stage.
 */

type Metrics = {
	days_since_send?: number | null;
	touches?: number | null;
	/** Sends that carried tracking, so a card can say "1 of 2 tracked". */
	tracked?: number | null;
	opens?: number | null;
	days_since_open?: number | null;
	last_reply?: unknown;
	fit?: number | null;
	email?: unknown;
} | null;
type Name = {
	person?: unknown;
	company?: unknown;
	contact_url?: string | null;
	company_url?: string | null;
	note?: unknown;
	metrics?: Metrics;
};
type Owed = {
	reply?: Name[] | null;
	bump?: Name[] | null;
	visit?: Name[] | null;
	first_touch?: Name[] | null;
	decide?: Name[] | null;
};
type LeadNote = { lead?: unknown; note?: unknown };
type Deal = { name?: unknown; stage?: unknown; amount?: number | null; close?: unknown } | null;
type Closed = { reason?: unknown; date?: unknown } | null;
type FunnelCompany = {
	name?: unknown;
	url?: string | null;
	fit?: number | null;
	status?: unknown;
	last_touch?: unknown;
	last_send?: unknown;
	touches?: number | null;
	opens?: number | null;
	replied?: unknown;
	days_since_send?: number | null;
	days_since_open?: number | null;
	days_since_reply?: number | null;
	deal?: Deal;
	closed?: Closed;
	task?: { due?: unknown; reading?: unknown; subject?: unknown } | null;
	note?: { date?: unknown; text?: unknown } | null;
	/** Every send as days back from today, and the last known open the same way. */
	touch_days?: number[] | null;
	open_days?: number[] | null;
	/** True when the company was not in this stage a week ago. */
	entered?: boolean | null;
	/** The touch the record owes next: reply, decide, visit, bump, first, wait, parked. */
	next?: unknown;
};

/** The groups inside a stage card, in the order the desk works them, with the pill each wears. */
const NEXT_GROUPS: { key: string; label: string; pill: string; tone: RecordBadge["tone"] }[] = [
	{ key: "reply", label: "Reply", pill: "Reply", tone: "ink" },
	{ key: "decide", label: "Decide", pill: "Decide", tone: "ink" },
	{ key: "visit", label: "Visit", pill: "Visit", tone: "ink" },
	{ key: "bump", label: "Bump", pill: "Bump", tone: "ink" },
	{ key: "first", label: "First touch", pill: "First", tone: "ink" },
	{ key: "wait", label: "Waiting", pill: "Wait", tone: "faint" },
	{ key: "", label: "Nothing owed", pill: "", tone: "faint" },
];

type NextGroup = { key: string; label: string; companies: FunnelCompany[] };

/** The waiting names as one linked sentence; nothing is owed on them, so they take no card. */
function nameRun(companies: FunnelCompany[]): { text: string; url?: string | null }[] {
	return companies.map((c) => ({ text: jqToString(c.name), url: c.url }));
}

/** The two deal stages keep a card for every name, waiting or not: the deal's stage and its money are the read. */
function onDeal(stage: FunnelStage): boolean {
	const key = jqToString(stage.key);
	return key === "opportunity" || key === "customer";
}

/** A stage's companies under their next touch, empty groups dropped; a next the groups do not name lands in the last one. */
function groupedByNext(companies: FunnelCompany[]): NextGroup[] {
	const known = new Set(NEXT_GROUPS.map((g) => g.key));
	const nextOf = (c: FunnelCompany) => (known.has(jqToString(alt(c.next, ""))) ? jqToString(alt(c.next, "")) : "");
	return NEXT_GROUPS.map((group) => ({
		key: group.key,
		label: group.label,
		companies: companies.filter((c) => nextOf(c) === group.key),
	})).filter((group) => group.companies.length > 0);
}

/** The notes the model wrote on the owed names, keyed by company url, so they ride on the stage cards. */
function notesByCompany(draft: PipelineDraft): Map<string, string> {
	const notes = new Map<string, string>();
	for (const kind of OWED_KINDS) {
		for (const name of alt(alt(draft.owed, {})[kind.key], [])) {
			const url = jqToString(alt(name.company_url, ""));
			const note = jqToString(alt(name.note, ""));
			if (url === "" || note === "") continue;
			const line = `${jqToString(alt(name.person, ""))}: ${note}`.replace(/^: /, "");
			notes.set(url, notes.has(url) ? `${notes.get(url)} · ${line}` : line);
		}
	}
	return notes;
}
type FunnelStage = {
	key?: unknown;
	label?: unknown;
	now?: number | null;
	then?: number | null;
	delta?: number | null;
	pct?: number | null;
	entered?: unknown[] | null;
	left?: unknown[] | null;
	companies?: FunnelCompany[] | null;
};
type Funnel = { from?: unknown; to?: unknown; stages?: FunnelStage[] | null } | null;
type StageMove = { name?: unknown; url?: string | null; from?: unknown; to?: unknown; why?: unknown };
type StatusMove = { name?: unknown; company?: unknown; from?: unknown; to?: unknown; why?: unknown };
type Proposed = { kind?: unknown; name?: unknown; company?: unknown; url?: string | null; note?: unknown };
type Groom = {
	applied?: boolean | null;
	companies?: StageMove[] | null;
	contacts?: StatusMove[] | null;
	proposed?: Proposed[] | null;
} | null;

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
};

/**
 * A parked name (an open task dated past this week) is noise until its week,
 * whatever stage it sits in, so the stage lists leave it out (Forni,
 * 2026-09-29). It comes back the week its task falls due, or sooner when a
 * reply lands on the record: the sweep reads that as the next touch, and a
 * name whose next is not the park itself still shows, in its group, with
 * the park as its callout.
 */
function shownCompanies(stage: FunnelStage): FunnelCompany[] {
	return alt(stage.companies, []).filter(
		(company) => jqToString(alt(company.task?.reading, "")) !== "parked" || jqToString(alt(company.next, "")) !== "parked",
	);
}

/**
 * A customer shows only with activity this week: a send or a reply inside
 * the window, a note dated in it, or a deal closed in it. Without one the
 * Customer card stays out of the mail altogether (Forni, 2026-09-29).
 */
function activeThisWeek(company: FunnelCompany, from: string): boolean {
	const within = (days: number | null | undefined) => days !== null && days !== undefined && days <= 7;
	if (within(company.days_since_send) || within(company.days_since_reply)) return true;
	const note = jqToString(alt(company.note?.date, ""));
	if (note !== "" && note >= from) return true;
	const close = jqToString(alt(company.deal?.close, ""));
	return close !== "" && close >= from;
}

/** The companies a stage card lists: parked names out everywhere, and on Customer only the active ones. */
function listedCompanies(stage: FunnelStage, funnel: Funnel): FunnelCompany[] {
	const shown = shownCompanies(stage);
	if (jqToString(stage.key) !== "customer") return shown;
	return shown.filter((company) => activeThisWeek(company, jqToString(alt(funnel?.from, ""))));
}

function emptyText(stage: FunnelStage): string {
	if (alt(stage.companies, []).length > 0) return "Everyone here is parked until a later week.";
	return "Nobody here this week.";
}

/* ---------- shared readings ---------- */

/**
 * The week's order (Forni, 2026-09-29): the new names first, then the bumps,
 * then the calls only Forni makes, then the replies owed, then Thursday's
 * visits. Until W40 replies led and first touches came fourth.
 */
const OWED_KINDS: { key: keyof Owed; label: string }[] = [
	{ key: "first_touch", label: "First touch" },
	{ key: "bump", label: "Bump" },
	{ key: "decide", label: "Decide" },
	{ key: "reply", label: "Reply to" },
	{ key: "visit", label: "Visit" },
];

/** The strip: the funnel Forni works, each stage with its week over week change. New stays off it. */
const STRIP_STAGES = ["lead", "mql", "sql", "opportunity", "customer", "closed"];
/** The stages that list their companies; Customer lists only the active ones. */
const LISTED_STAGES = new Set(["lead", "mql", "sql", "opportunity", "customer"]);

const STAGE_WORD: Record<string, string> = {
	lead: "Lead",
	marketingqualifiedlead: "MQL",
	salesqualifiedlead: "SQL",
	opportunity: "Oppty",
	customer: "Customer",
};

function stageWord(value: unknown): string {
	const key = jqToString(value);
	return STAGE_WORD[key] === undefined ? key : STAGE_WORD[key];
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
	return alt(funnel?.stages, [])
		.filter((stage) => STRIP_STAGES.includes(jqToString(stage.key)))
		.map((stage) => ({ n: alt(stage.now, 0), label: jqToString(stage.label), delta: deltaText(stage) }));
}

function plural(count: number, noun: string): string {
	if (count === 1) return `${numberString(count)} ${noun}`;
	return `${numberString(count)} ${noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;
}

/*
 * A company on a stage list, on the same two lines every time. The meta line
 * is the state (status, touches, opens); the note line is the clock (the last
 * touch and when, the last open, the reply). A deal stage reads the deal
 * instead: its stage and the money, then the date and the status.
 */
/**
 * A company on a stage list: the Company Card. New when it entered the stage
 * this week, the next touch as a pill, the timeline of its sends and last
 * open, the deal on the two deal stages and the touch line on the rest, the
 * model's note when one of its people is owed a touch, and a park as the
 * only callout.
 */
function companyRecord(stage: FunnelStage, company: FunnelCompany, notes: Map<string, string>): RecordStackItem {
	const key = jqToString(stage.key);
	const onDeal = key === "opportunity" || key === "customer";
	const next = NEXT_GROUPS.find((g) => g.key === jqToString(alt(company.next, "")) && g.pill !== "");
	// A waiting name owes nothing yet, so it reads compact: the New pill and
	// the counts, no strip and no Wait pill, since its group already says so
	// and Gmail clips a mail past about 100 KB.
	const waiting = jqToString(alt(company.next, "")) === "wait";
	const pills: RecordBadge[] = [];
	if (company.entered === true) pills.push({ text: "New", tone: "accent" });
	if (next && !waiting) pills.push({ text: next.pill, tone: next.tone });
	return recordCard({
		title: company.name,
		url: company.url,
		pills,
		days: waiting ? undefined : { touches: company.touch_days, opens: company.open_days },
		note: notes.get(jqToString(alt(company.url, ""))),
		deal: onDeal
			? company.deal
				? { stage: company.deal.stage, amount: company.deal.amount, close: company.deal.close, signed: key === "customer" }
				: null
			: undefined,
		touch: onDeal
			? undefined
			: {
					touches: company.touches,
					opens: company.opens,
					lastTouch: company.last_touch,
					daysSinceSend: company.days_since_send,
					daysSinceOpen: company.days_since_open,
					daysSinceReply: company.days_since_reply,
				},
		callout: nextStep(company),
	});
}

/**
 * The one callout a stage card carries: a park, with its date. A task due
 * and the newest note used to show here too, and read as noise on every
 * windshield sighting (Forni, 2026-09-29: no notes on the cards unless the
 * note is that the name is parked for now).
 */
function nextStep(company: FunnelCompany): { eyebrow: string; text: string } | undefined {
	const task = company.task;
	if (!task || jqToString(alt(task.subject, "")) === "" || jqToString(alt(task.reading, "")) !== "parked") return undefined;
	return { eyebrow: `Parked until ${jqToString(alt(task.due, ""))}`, text: jqToString(task.subject) };
}

/** The five kinds of touch owed as a strip, in the desk block's order. */
function owedStats(draft: PipelineDraft): StatStripEntry[] {
	const owed = alt(draft.owed, {});
	return OWED_KINDS.map((kind) => ({ n: alt(owed[kind.key], []).length, label: kind.label }));
}

/** The numbers under an owed name, from the sweep, in the same slots for every kind. */
/**
 * A person owed a touch: the shared card with the company leading the meta
 * line. A first touch carries the fit and the door instead of a touch line,
 * since nothing has been sent; every other kind carries the sweep's numbers.
 */
function owedRecords(kind: keyof Owed, names: Name[]): RecordStackItem[] {
	return names.map((name) => {
		const m = name.metrics ?? null;
		const lead: unknown[] = [name.company];
		let touch: TouchLine | undefined;
		if (kind === "first_touch") {
			if (m && m.fit !== null && m.fit !== undefined) lead.push(`fit ${numberString(m.fit)}`);
			if (m) lead.push(jqToString(alt(m.email, "")) === "" ? "shared inbox" : "owner direct");
		} else if (m) {
			touch = {
				touches: m.touches,
				tracked: m.tracked,
				opens: m.opens,
				daysSinceSend: m.days_since_send,
				daysSinceOpen: m.days_since_open,
				lastReply: kind === "reply" ? m.last_reply : undefined,
			};
		}
		return recordCard({ title: name.person, url: name.contact_url, lead, touch, note: name.note });
	});
}

function moveRecords(groom: Groom): RecordStackItem[] {
	const stages = alt(groom?.companies, []).map((m) => ({
		title: jqToString(m.name),
		url: m.url,
		meta: [`${stageWord(m.from)} to ${stageWord(m.to)}`, jqToString(alt(m.why, ""))].filter((x) => x !== ""),
	}));
	const contacts = alt(groom?.contacts, []).map((m) => ({
		title: `${jqToString(m.name) === "" ? "(no name)" : jqToString(m.name)}, ${jqToString(m.company)}`,
		url: null,
		meta: [`${statusWord(m.from)} to ${statusWord(m.to)}`, jqToString(alt(m.why, ""))].filter((x) => x !== ""),
	}));
	return [...stages, ...contacts];
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

/** The stages that get a card: the listed set, minus Customer in a week no customer had activity. */
function listedStages(funnel: Funnel): FunnelStage[] {
	return alt(funnel?.stages, [])
		.filter((stage) => LISTED_STAGES.has(jqToString(stage.key)))
		.filter((stage) => jqToString(stage.key) !== "customer" || listedCompanies(stage, funnel).length > 0);
}

function owedKindsOf(draft: PipelineDraft) {
	const owed = alt(draft.owed, {});
	return OWED_KINDS.map((kind) => ({ ...kind, names: alt(owed[kind.key], []) })).filter((kind) => kind.names.length > 0);
}

/** The owed lists the mail still prints: the first touches, whose names sit in no stage yet. */
function listedKinds(draft: PipelineDraft) {
	return owedKindsOf(draft).filter((kind) => kind.key === "first_touch");
}

/* ---------- html ---------- */

export function pipelineHTML(input: unknown, context: RenderContext): string {
	const draft = input as PipelineDraft;
	const funnel = draft.funnel ?? null;
	const listed = listedStages(funnel);
	const owedKinds = owedKindsOf(draft);
	const notes = notesByCompany(draft);
	const moves = moveRecords(draft.groom ?? null);
	const left = leftForYou(draft);
	const rosterUrl = jqToString(alt(draft.roster_url, ""));

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

				<Eyebrow text="The pipeline" strong={true} />
				<Card>
					{funnel === null ? (
						<EmptyRow text="The portal sweep carried no funnel this run." />
					) : (
						<>
							<Row last={false}>
								<StatStrip stats={stripStats(funnel)} />
							</Row>
							<Row last={true}>
								<RecordTimelineLegend days={TIMELINE_DAYS} />
							</Row>
						</>
					)}
				</Card>

				{listed.map((stage, index) => {
					const companies = listedCompanies(stage, funnel);
					const groups = groupedByNext(companies);
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: a stage's position is its identity
						<Fragment key={index}>
							<Eyebrow text={`${jqToString(stage.label)} · ${numberString(alt(stage.now, 0))}`} strong={true} />
							<Card>
								{companies.length === 0 ? <EmptyRow text={emptyText(stage)} /> : null}
								{groups.map((group, g) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: a group's position is its identity
									<Fragment key={g}>
										<SubEyebrow text={`${group.label} · ${numberString(group.companies.length)}`} />
										<Row last={g === groups.length - 1}>
											{group.key === "wait" && !onDeal(stage) ? (
												<NameRun names={nameRun(group.companies)} />
											) : (
												<RecordStack records={group.companies.map((c) => companyRecord(stage, c, notes))} />
											)}
										</Row>
									</Fragment>
								))}
							</Card>
						</Fragment>
					);
				})}

				<Eyebrow text="This week" strong={true} />
				<Card>
					{owedKinds.length === 0 ? (
						<EmptyRow text="Nothing is owed this week." />
					) : (
						<Row last={true}>
							<StatStrip stats={owedStats(draft)} />
						</Row>
					)}
				</Card>

				{listedKinds(draft).map((kind, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: a kind's position is its identity
					<Fragment key={index}>
						<Eyebrow text={`${kind.label} · ${numberString(kind.names.length)}`} strong={true} />
						<Card>
							<Row last={true}>
								<RecordStack records={owedRecords(kind.key, kind.names)} />
							</Row>
						</Card>
					</Fragment>
				))}

				<Eyebrow text="The groom" strong={true} />
				<Card>
					<Row last={moves.length === 0 && left.length === 0}>
						<DimLine text={groomLine(draft.groom ?? null)} />
					</Row>
					{moves.length === 0 ? null : (
						<Row last={left.length === 0}>
							<RecordStack records={moves} />
						</Row>
					)}
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
	const listed = listedStages(funnel);
	const notes = notesByCompany(draft);
	const moves = moveRecords(draft.groom ?? null);
	const left = leftForYou(draft);

	let out = `ATELIC · PIPELINE · WEEK ${number} · ${shortDate(context.monday)} TO ${shortDate(context.sunday)}\n\n`;
	out += `${asciiUpcase(alt(draft.headline, []).join("\n"))}\n`;
	const lede = unindent(jqToString(alt(draft.lede, "")));
	if (lede !== "") out += `\n${textRead(lede)}`;
	const rosterUrl = jqToString(alt(draft.roster_url, ""));
	if (rosterUrl !== "") out += `\nThe full read is in the roster: ${rosterUrl}\n`;

	out += textSection("The Pipeline");
	if (funnel === null) {
		out += "  The portal sweep carried no funnel this run.\n";
	} else {
		const strip = stripStats(funnel);
		out += `${textTable(["Stage", "Now", "Change"], strip.map((s) => [s.label, numberString(Number(s.n)), s.delta ?? ""]), [1])}\n`;
		out += `\n  # a send · o an open · @ both · | today · ${numberString(TIMELINE_DAYS)} days to today\n`;
		for (const stage of listed) {
			out += textSection(`${jqToString(stage.label)} · ${numberString(alt(stage.now, 0))}`);
			const companies = listedCompanies(stage, funnel);
			if (companies.length === 0) out += `  ${emptyText(stage)}\n`;
			out += groupedByNext(companies)
				.map(
					(group) =>
						`${asciiUpcase(group.label)} · ${numberString(group.companies.length)}\n\n${
							group.key === "wait" && !onDeal(stage)
								? `${wrap(nameRun(group.companies).map((n) => n.text).join(", "))}\n`
								: `${recordStackText(group.companies.map((c) => companyRecord(stage, c, notes)))}\n`
						}`,
				)
				.join("\n");
		}
	}

	out += textSection("This Week");
	const owedKinds = owedKindsOf(draft);
	if (owedKinds.length === 0) out += "  Nothing is owed this week.\n";
	else out += `${textTable(["Touch", "Owed"], owedStats(draft).map((s) => [s.label, numberString(Number(s.n))]), [1])}\n`;
	for (const kind of listedKinds(draft)) {
		out += textSection(`${kind.label} · ${numberString(kind.names.length)}`);
		out += recordStackText(owedRecords(kind.key, kind.names));
	}

	out += textSection("The Groom");
	out += `${wrap(groomLine(draft.groom ?? null))}\n`;
	if (moves.length > 0) out += `\n${recordStackText(moves)}`;
	if (left.length > 0) {
		out += `\nLeft for you · ${numberString(left.length)}\n${left.map((line) => wrap(line)).join("\n")}\n`;
	}

	out += `\n\n${context.meta}\n`;
	return out;
}
