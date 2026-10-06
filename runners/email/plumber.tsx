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
 * The cards are the Company Cards IA (Forni, 2026-09-29): a thirty day
 * timeline of the sends and last open, the counts, and the open's age set
 * right. The strip is followed by the stage lists, every company in the
 * card's compact form (a New pill when it entered the stage this week, no
 * strip), the waiting names (nothing owed yet) as one linked sentence at the
 * foot, since a card each ran the mail past Gmail's clip; then This Week,
 * broken out by the touch owed, each person on the full card with the
 * model's note (Forni, 2026-09-29: the pipeline, then all the businesses
 * below it, then the individual actions to take). The stage lists were grouped by the next touch for one afternoon and
 * read as the same thing twice.
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
	/** The person's sends and last open as day counts, for the strip on an owed card. */
	touch_days?: number[] | null;
	open_days?: number[] | null;
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

/** The waiting names as one linked sentence; nothing is owed on them, so they take no card. */
function nameRun(companies: FunnelCompany[]): { text: string; url?: string | null }[] {
	return companies.map((c) => ({ text: jqToString(c.name), url: c.url }));
}

/** The two deal stages keep a card for every name, waiting or not: the deal's stage and its money are the read. */
function onDeal(stage: FunnelStage): boolean {
	const key = jqToString(stage.key);
	return key === "opportunity" || key === "customer";
}

/** A stage's companies split into the ones that get a card and the waiting ones that read as a sentence. */
function splitWaiting(stage: FunnelStage, companies: FunnelCompany[]): { carded: FunnelCompany[]; waiting: FunnelCompany[] } {
	if (onDeal(stage)) return { carded: companies, waiting: [] };
	const waiting = companies.filter((c) => jqToString(alt(c.next, "")) === "wait");
	return { carded: companies.filter((c) => !waiting.includes(c)), waiting };
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
	/** What the runner sent to the Outreach routine after the roster was placed; absent on a run from before 2026-10-06. */
	drafting?: Drafting;
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
 * One line per payload the runner sent to the Outreach routine (Forni,
 * 2026-10-06): the business, linked to its cloud session when the API named
 * one, then the touch and how the fire went, so Tuesday knows which drafts to
 * expect in the Drafts.
 */
function fireRecords(drafting: Drafting): RecordStackItem[] {
	return alt(drafting?.fires, []).map((fire) => {
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
 * A company on a stage list: the shared card in its compact form. New when
 * it entered the stage this week, the deal on the two deal stages and the
 * touch line on the rest, a park as the only callout. The strip and the next
 * touch live on the person's card under This Week; drawn here as well they
 * ran the mail past Gmail's clip, and read as the same thing twice.
 */
function companyRecord(stage: FunnelStage, company: FunnelCompany): RecordStackItem {
	const key = jqToString(stage.key);
	const onDeal = key === "opportunity" || key === "customer";
	const pills: RecordBadge[] = [];
	if (company.entered === true) pills.push({ text: "New", tone: "accent" });
	return recordCard({
		title: company.name,
		url: company.url,
		pills,
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
		const days = m && kind !== "first_touch" ? { touches: m.touch_days, opens: m.open_days } : undefined;
		return recordCard({ title: name.person, url: name.contact_url, lead, touch, days, note: name.note });
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

/* ---------- html ---------- */

export function pipelineHTML(input: unknown, context: RenderContext): string {
	const draft = input as PipelineDraft;
	const funnel = draft.funnel ?? null;
	const listed = listedStages(funnel);
	const owedKinds = owedKindsOf(draft);
	const moves = moveRecords(draft.groom ?? null);
	const left = leftForYou(draft);
	const rosterUrl = jqToString(alt(draft.roster_url, ""));
	const drafting = draft.drafting ?? null;
	const fires = fireRecords(drafting);

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

				<Eyebrow text="The pipeline" strong={true} aside={<RecordTimelineLegend days={TIMELINE_DAYS} />} />
				<Card>
					{funnel === null ? (
						<EmptyRow text="The portal sweep carried no funnel this run." />
					) : (
						<Row last={true}>
							<StatStrip stats={stripStats(funnel)} />
						</Row>
					)}
				</Card>

				{listed.map((stage, index) => {
					const { carded, waiting } = splitWaiting(stage, listedCompanies(stage, funnel));
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: a stage's position is its identity
						<Fragment key={index}>
							<Eyebrow text={`${jqToString(stage.label)} · ${numberString(alt(stage.now, 0))}`} strong={true} />
							<Card>
								{carded.length === 0 && waiting.length === 0 ? <EmptyRow text={emptyText(stage)} /> : null}
								{carded.length === 0 ? null : (
									<Row last={waiting.length === 0}>
										<RecordStack records={carded.map((c) => companyRecord(stage, c))} />
									</Row>
								)}
								{waiting.length === 0 ? null : (
									<Row last={true}>
										<DimLine text={`Waiting on a send, ${numberString(waiting.length)}: `} />
										<NameRun names={nameRun(waiting)} />
									</Row>
								)}
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

				{owedKinds.map((kind, index) => (
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

				{drafting === null ? null : (
					<>
						<Eyebrow text={`Drafting · ${numberString(fires.length)}`} strong={true} />
						<Card>
							<Row last={fires.length === 0}>
								<DimLine text={jqToString(alt(drafting.note, ""))} />
							</Row>
							{fires.length === 0 ? null : (
								<Row last={true}>
									<RecordStack records={fires} />
								</Row>
							)}
						</Card>
					</>
				)}

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
	}

	if (funnel !== null) {
		for (const stage of listed) {
			out += textSection(`${jqToString(stage.label)} · ${numberString(alt(stage.now, 0))}`);
			const { carded, waiting } = splitWaiting(stage, listedCompanies(stage, funnel));
			if (carded.length === 0 && waiting.length === 0) out += `  ${emptyText(stage)}\n`;
			if (carded.length > 0) out += `${recordStackText(carded.map((c) => companyRecord(stage, c)))}\n`;
			if (waiting.length > 0) out += `\n${wrap(`Waiting on a send, ${numberString(waiting.length)}: ${nameRun(waiting).map((n) => n.text).join(", ")}`)}\n`;
		}
	}

	out += textSection("This Week");
	const owedKinds = owedKindsOf(draft);
	if (owedKinds.length === 0) out += "  Nothing is owed this week.\n";
	else out += `${textTable(["Touch", "Owed"], owedStats(draft).map((s) => [s.label, numberString(Number(s.n))]), [1])}\n`;
	for (const kind of owedKinds) {
		out += textSection(`${kind.label} · ${numberString(kind.names.length)}`);
		out += recordStackText(owedRecords(kind.key, kind.names));
	}

	const drafting = draft.drafting ?? null;
	if (drafting !== null) {
		const fires = fireRecords(drafting);
		out += textSection(`Drafting · ${numberString(fires.length)}`);
		out += `${wrap(jqToString(alt(drafting.note, "")))}\n`;
		if (fires.length > 0) out += `\n${recordStackText(fires)}`;
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
