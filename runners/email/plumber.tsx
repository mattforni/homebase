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
	RecordStack,
	type RecordStackItem,
	recordStackText,
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
import { DimLine } from "./local";
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
 * and up to five flags. New, Lead and Closed are read as a count and a
 * change; MQL, SQL, Oppty and Customer list every company on a RecordStack so
 * a name never squashes on a phone. Everything the email leaves out lives in
 * the attached roster.
 */

type Metrics = {
	days_since_send?: number | null;
	touches?: number | null;
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
};
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
};

/* ---------- shared readings ---------- */

/** The desk block's order: replies first, then bumps, then the new names, then Thursday's visits, then the calls only Forni makes. */
const OWED_KINDS: { key: keyof Owed; label: string }[] = [
	{ key: "reply", label: "Reply to" },
	{ key: "bump", label: "Bump" },
	{ key: "first_touch", label: "First touch" },
	{ key: "visit", label: "Visit" },
	{ key: "decide", label: "Decide" },
];

/** The strip: the funnel Forni works. New is the pool waiting for a first send and reads as a line beneath. */
const STRIP_STAGES = ["lead", "mql", "sql", "opportunity", "customer", "closed"];
const LISTED_STAGES = new Set(["mql", "sql", "opportunity", "customer"]);

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

/** "+6 (15%)", "+9" when there was nothing a week ago, or "0" when nothing moved. */
function deltaText(stage: FunnelStage): string {
	const delta = alt(stage.delta, 0);
	const pct = stage.pct;
	if (delta === 0) return "0";
	return pct === null || pct === undefined ? signed(delta) : `${signed(delta)} (${numberString(Math.abs(pct))}%)`;
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

/** "today", "yesterday", "3 days ago"; empty when there is no date. */
function ago(days: number | null | undefined): string {
	if (days === null || days === undefined) return "";
	if (days <= 0) return "today";
	if (days === 1) return "yesterday";
	return `${numberString(days)} days ago`;
}

function stageOf(funnel: Funnel, key: string): FunnelStage | undefined {
	return alt(funnel?.stages, []).find((stage) => jqToString(stage.key) === key);
}

/** New as the pool: how many names wait for a first send and how the week moved it. */
function poolLine(stage: FunnelStage | undefined): string {
	if (stage === undefined) return "";
	const entered = alt(stage.entered, []).length;
	const left = alt(stage.left, []).length;
	return `${plural(alt(stage.now, 0), "name")} waiting for a first send: ${numberString(entered)} in and ${numberString(left)} out this week.`;
}

/** Lead and Closed as one line each: the count, the change, what came in and went out. */
function countLine(stage: FunnelStage): string {
	const entered = alt(stage.entered, []).length;
	const left = alt(stage.left, []).length;
	const change = deltaText(stage) === "0" ? "unchanged" : deltaText(stage);
	return `${jqToString(stage.label)} ${numberString(alt(stage.now, 0))}, ${change}: ${numberString(entered)} in and ${numberString(left)} out this week.`;
}

/** The pool line and the two count lines, in the order the funnel runs. */
function funnelLines(funnel: Funnel): string[] {
	const lead = stageOf(funnel, "lead");
	const closed = stageOf(funnel, "closed");
	return [
		poolLine(stageOf(funnel, "new")),
		lead === undefined ? "" : countLine(lead),
		closed === undefined ? "" : countLine(closed),
	].filter((line) => line !== "");
}

function statusWord(value: unknown): string {
	const s = jqToString(value);
	return s === "" ? "" : s.charAt(0) + s.slice(1).toLowerCase();
}

function money(amount: number | null | undefined): string {
	if (amount === null || amount === undefined) return "";
	return `$${Math.round(amount).toLocaleString("en-US")}`;
}

function count(n: number, noun: string): string {
	return `${numberString(n)} ${n === 1 ? noun : `${noun}${noun.endsWith("ch") ? "es" : "s"}`}`;
}

/*
 * A company on a stage list, on the same two lines every time. The meta line
 * is the state (status, touches, opens); the note line is the clock (the last
 * touch and when, the last open, the reply). A deal stage reads the deal
 * instead: its stage and the money, then the date and the status.
 */
function companyRecord(stage: FunnelStage, company: FunnelCompany): RecordStackItem {
	const key = jqToString(stage.key);
	if (key === "opportunity" || key === "customer") {
		const deal = company.deal;
		const meta = deal
			? [jqToString(alt(deal.stage, "")), money(deal.amount)].filter((m) => m !== "")
			: ["no deal on the record"];
		const clock: string[] = [];
		if (deal && jqToString(alt(deal.close, "")) !== "") {
			clock.push(`${key === "customer" ? "signed" : "closes"} ${jqToString(deal.close)}`);
		}
		return {
			title: jqToString(company.name),
			url: company.url,
			badge: statusWord(company.status) || undefined,
			meta,
			note: clock.join(" · ") || undefined,
			callout: nextStep(company),
		};
	}
	const meta = [
		count(alt(company.touches, 0), "touch"),
		company.opens === null || company.opens === undefined ? "untracked" : count(company.opens, "open"),
	].filter((m) => m !== "");
	const clock: string[] = [];
	if (jqToString(alt(company.last_touch, "")) !== "" && ago(company.days_since_send) !== "") {
		clock.push(`${jqToString(company.last_touch).toLowerCase()} ${ago(company.days_since_send)}`);
	}
	if (ago(company.days_since_open) !== "") clock.push(`opened ${ago(company.days_since_open)}`);
	if (ago(company.days_since_reply) !== "") clock.push(`replied ${ago(company.days_since_reply)}`);
	return {
		title: jqToString(company.name),
		url: company.url,
		badge: statusWord(company.status) || undefined,
		meta,
		note: clock.join(" · ") || undefined,
		callout: nextStep(company),
	};
}

/** The next step on the record, as the orange callout under the name: a park with its date, a task due, or the newest note. */
function nextStep(company: FunnelCompany): { eyebrow: string; text: string } | undefined {
	const task = company.task;
	if (task && jqToString(alt(task.subject, "")) !== "") {
		const due = jqToString(alt(task.due, ""));
		const reading = jqToString(alt(task.reading, ""));
		const eyebrow =
			reading === "parked" ? `Parked until ${due}` : reading === "stale" ? `Task overdue since ${due}` : due === "" ? "Task" : `Task due ${due}`;
		return { eyebrow, text: jqToString(task.subject) };
	}
	const note = company.note;
	if (note && jqToString(alt(note.text, "")) !== "") {
		return { eyebrow: `Note ${jqToString(alt(note.date, ""))}`.trim(), text: jqToString(note.text) };
	}
	return undefined;
}

/** The five kinds of touch owed as a strip, in the desk block's order. */
function owedStats(draft: PipelineDraft): StatStripEntry[] {
	const owed = alt(draft.owed, {});
	return OWED_KINDS.map((kind) => ({ n: alt(owed[kind.key], []).length, label: kind.label }));
}

/** The numbers under an owed name, from the sweep, in the same slots for every kind. */
function metricsLine(kind: keyof Owed, m: Metrics): string {
	if (m === null || m === undefined) return "";
	if (kind === "first_touch") {
		const parts: string[] = [];
		if (m.fit !== null && m.fit !== undefined) parts.push(`fit ${numberString(m.fit)}`);
		parts.push(jqToString(alt(m.email, "")) === "" ? "shared inbox" : "owner direct");
		return parts.join(" · ");
	}
	const parts: string[] = [];
	if (kind === "reply") {
		if (jqToString(alt(m.last_reply, "")) !== "") parts.push(`replied ${jqToString(m.last_reply)}`);
	} else if (ago(m.days_since_send) !== "") {
		parts.push(`sent ${ago(m.days_since_send)}`);
	}
	parts.push(count(alt(m.touches, 0), "touch"));
	parts.push(m.opens === null || m.opens === undefined ? "untracked" : count(m.opens, "open"));
	if (ago(m.days_since_open) !== "") parts.push(`opened ${ago(m.days_since_open)}`);
	return parts.join(" · ");
}

function owedRecords(kind: keyof Owed, names: Name[]): RecordStackItem[] {
	return names.map((name) => {
		const company = jqToString(alt(name.company, ""));
		const metrics = metricsLine(kind, name.metrics ?? null);
		return {
			title: jqToString(name.person),
			url: name.contact_url,
			meta: [company, metrics].filter((m) => m !== ""),
			note: jqToString(alt(name.note, "")) === "" ? undefined : jqToString(name.note),
		};
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

function owedKindsOf(draft: PipelineDraft) {
	const owed = alt(draft.owed, {});
	return OWED_KINDS.map((kind) => ({ ...kind, names: alt(owed[kind.key], []) })).filter((kind) => kind.names.length > 0);
}

/* ---------- html ---------- */

export function pipelineHTML(input: unknown, context: RenderContext): string {
	const draft = input as PipelineDraft;
	const funnel = draft.funnel ?? null;
	const listed = alt(funnel?.stages, []).filter((stage) => LISTED_STAGES.has(jqToString(stage.key)));
	const lines = funnelLines(funnel);
	const owedKinds = owedKindsOf(draft);
	const moves = moveRecords(draft.groom ?? null);
	const left = leftForYou(draft);

	return renderEmail({
		title: `${context.week} Pipeline`,
		preheader: jqToString(alt(draft.preheader, "")),
		children: (
			<>
				<Masthead
					title="Pipeline"
					meta={`Week ${weekNumber(context.week)} · ${shortDate(context.monday)} to ${shortDate(context.sunday)}`}
				/>
				<TitleCard eyebrowText="The read" headlineLines={alt(draft.headline, [])} lede={jqToString(alt(draft.lede, ""))} />

				<Eyebrow text="The pipeline" strong={true} />
				<Card>
					{funnel === null ? (
						<EmptyRow text="The portal sweep carried no funnel this run." />
					) : (
						<>
							<Row last={lines.length === 0}>
								<StatStrip stats={stripStats(funnel)} />
							</Row>
							{lines.length === 0 ? null : (
								<Row last={true}>
									<List fontSize="13px">
										{lines.map((line, index) => (
											// biome-ignore lint/suspicious/noArrayIndexKey: a line's position is its identity
											<ListRow key={index}>{line}</ListRow>
										))}
									</List>
								</Row>
							)}
						</>
					)}
				</Card>

				{listed.map((stage, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: a stage's position is its identity
					<Fragment key={index}>
						<Eyebrow text={`${jqToString(stage.label)} · ${numberString(alt(stage.now, 0))}`} strong={true} />
						<Card>
							{alt(stage.companies, []).length === 0 ? (
								<EmptyRow text="Nobody here this week." />
							) : (
								<Row last={true}>
									<RecordStack records={alt(stage.companies, []).map((c) => companyRecord(stage, c))} />
								</Row>
							)}
						</Card>
					</Fragment>
				))}

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
	const listed = alt(funnel?.stages, []).filter((stage) => LISTED_STAGES.has(jqToString(stage.key)));
	const moves = moveRecords(draft.groom ?? null);
	const left = leftForYou(draft);

	let out = `ATELIC · PIPELINE · WEEK ${number} · ${shortDate(context.monday)} TO ${shortDate(context.sunday)}\n\n`;
	out += `${asciiUpcase(alt(draft.headline, []).join("\n"))}\n`;
	const lede = unindent(jqToString(alt(draft.lede, "")));
	if (lede !== "") out += `\n${textRead(lede)}`;

	out += textSection("The Pipeline");
	if (funnel === null) {
		out += "  The portal sweep carried no funnel this run.\n";
	} else {
		const strip = stripStats(funnel);
		out += `${textTable(["Stage", "Now", "Change"], strip.map((s) => [s.label, numberString(Number(s.n)), s.delta ?? ""]), [1])}\n`;
		const lines = funnelLines(funnel);
		if (lines.length > 0) out += `\n${lines.map((line) => wrap(line)).join("\n")}\n`;
		for (const stage of listed) {
			out += textSection(`${jqToString(stage.label)} · ${numberString(alt(stage.now, 0))}`);
			const companies = alt(stage.companies, []);
			out += companies.length === 0 ? "  Nobody here this week.\n" : recordStackText(companies.map((c) => companyRecord(stage, c)));
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

	out += textSection("The Groom");
	out += `${wrap(groomLine(draft.groom ?? null))}\n`;
	if (moves.length > 0) out += `\n${recordStackText(moves)}`;
	if (left.length > 0) {
		out += `\nLeft for you · ${numberString(left.length)}\n${left.map((line) => wrap(line)).join("\n")}\n`;
	}

	out += `\n\n${context.meta}\n`;
	return out;
}
