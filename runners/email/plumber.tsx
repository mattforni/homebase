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
	ReadBlock,
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
 * the board first layout read to Forni as the same email in different words.
 *
 * The runner, not the model, supplies the funnel and the groom: the sweep
 * reads the groom's seven buckets now and seven days ago off HubSpot's own
 * entered dates, moves every stage and status the record justifies, and the
 * entrypoint folds both into the draft before the render. The model writes
 * the read, the names owed, and up to five flags. New, Lead and Closed are
 * read as a count and a change; MQL, SQL, Oppty and Customer list every
 * company, on a RecordStack so a name never squashes on a phone. Everything
 * the email leaves out (the drafts, each name's full line, the could not
 * verify list, the names left off on purpose) lives in the attached roster.
 */

type Name = {
	person?: unknown;
	company?: unknown;
	contact_url?: string | null;
	company_url?: string | null;
	note?: unknown;
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
	deal?: Deal;
	closed?: Closed;
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

const OWED_KINDS: { key: keyof Owed; label: string }[] = [
	{ key: "reply", label: "Reply to" },
	{ key: "bump", label: "Bump" },
	{ key: "visit", label: "Visit" },
	{ key: "first_touch", label: "First touch" },
	{ key: "decide", label: "Decide" },
];

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

/** "+3 · +12%", or "0" when nothing moved, or the count alone when there was nothing a week ago. */
function deltaText(stage: FunnelStage): string {
	const delta = alt(stage.delta, 0);
	const pct = stage.pct;
	if (delta === 0) return "0";
	return pct === null || pct === undefined ? signed(delta) : `${signed(delta)} · ${signed(pct)}%`;
}

function stripStats(funnel: Funnel): StatStripEntry[] {
	return alt(funnel?.stages, []).map((stage) => ({
		n: alt(stage.now, 0),
		label: jqToString(stage.label),
		delta: deltaText(stage),
	}));
}

/** One line for a stage read as a count: what came in and what went out this week. */
function countLine(stage: FunnelStage): string {
	const label = jqToString(stage.label);
	const entered = alt(stage.entered, []).length;
	const left = alt(stage.left, []).length;
	const movement =
		entered === 0 && left === 0
			? "nothing moved this week"
			: `${numberString(entered)} in, ${numberString(left)} out this week`;
	return `${label} ${numberString(alt(stage.now, 0))}, ${deltaText(stage) === "0" ? "unchanged" : deltaText(stage)}: ${movement}.`;
}

function statusWord(value: unknown): string {
	const s = jqToString(value);
	return s === "" ? "" : s.charAt(0) + s.slice(1).toLowerCase();
}

function money(amount: number | null | undefined): string {
	if (amount === null || amount === undefined) return "";
	return `$${Math.round(amount).toLocaleString("en-US")}`;
}

/** A company on a stage list: the name, then what the record says about it. */
function companyRecord(stage: FunnelStage, company: FunnelCompany): RecordStackItem {
	const key = jqToString(stage.key);
	const meta: string[] = [];
	if (key === "opportunity" || key === "customer") {
		const deal = company.deal;
		if (deal) {
			if (jqToString(deal.stage) !== "") meta.push(jqToString(deal.stage));
			if (money(deal.amount) !== "") meta.push(money(deal.amount));
			if (jqToString(deal.close) !== "") meta.push(`${key === "customer" ? "signed" : "closes"} ${jqToString(deal.close)}`);
		} else {
			meta.push("no deal on the record");
		}
		if (statusWord(company.status) !== "") meta.push(statusWord(company.status));
	} else {
		if (statusWord(company.status) !== "") meta.push(statusWord(company.status));
		const touches = alt(company.touches, 0);
		if (jqToString(company.last_touch) !== "" && jqToString(company.last_send) !== "") {
			meta.push(`${jqToString(company.last_touch).toLowerCase()} on ${jqToString(company.last_send)}`);
		}
		meta.push(`${numberString(touches)} ${touches === 1 ? "touch" : "touches"}`);
		if (company.opens !== null && company.opens !== undefined) {
			meta.push(`${numberString(company.opens)} ${company.opens === 1 ? "open" : "opens"}`);
		}
		if (jqToString(company.replied) !== "") meta.push(`replied ${jqToString(company.replied)}`);
	}
	return { title: jqToString(company.name), url: company.url, meta };
}

function owedRecords(names: Name[]): RecordStackItem[] {
	return names.map((name) => ({
		title: jqToString(name.person),
		url: name.contact_url,
		meta: [jqToString(alt(name.company, ""))].filter((m) => m !== ""),
		note: jqToString(alt(name.note, "")) === "" ? undefined : jqToString(name.note),
	}));
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

function plural(count: number, noun: string): string {
	if (count === 1) return `${numberString(count)} ${noun}`;
	return `${numberString(count)} ${noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;
}

/** The one line that stands in for the two lists the roster carries at its foot. */
function rosterTail(unverified: number, notInBlock: number): string {
	const could =
		unverified === 0
			? "Everything on the roster was verified"
			: `${plural(unverified, "claim")} could not be verified today`;
	const left =
		notInBlock === 0
			? "nothing was left off on purpose"
			: `${plural(notInBlock, "name")} ${notInBlock === 1 ? "was" : "were"} left off on purpose`;
	return `${could}, and ${left}. Every draft, each name's full line, and both lists are in the attached roster.`;
}

function groomLine(groom: Groom): string {
	const stages = alt(groom?.companies, []).length;
	const contacts = alt(groom?.contacts, []).length;
	if (groom === null || groom === undefined) return "The groom did not run this week.";
	if (groom.applied === false) return `Read only this run: ${plural(stages, "stage move")} and ${plural(contacts, "status move")} were computed and nothing was written.`;
	if (stages === 0 && contacts === 0) return "The portal already said what was true; nothing moved.";
	return `The groom moved ${plural(stages, "company")} and ${plural(contacts, "contact")} to match what the record already showed.`;
}

/* ---------- html ---------- */

export function pipelineHTML(input: unknown, context: RenderContext): string {
	const draft = input as PipelineDraft;
	const funnel = draft.funnel ?? null;
	const stages = alt(funnel?.stages, []);
	const counted = stages.filter((stage) => !LISTED_STAGES.has(jqToString(stage.key)));
	const listed = stages.filter((stage) => LISTED_STAGES.has(jqToString(stage.key)));
	const owed = alt(draft.owed, {});
	const owedKinds = OWED_KINDS.map((kind) => ({ ...kind, names: alt(owed[kind.key], []) })).filter(
		(kind) => kind.names.length > 0,
	);
	const moves = moveRecords(draft.groom ?? null);
	const left = leftForYou(draft);
	const unverified = alt(draft.unverified, []).length;
	const notInBlock = alt(draft.not_in_block, []).length;

	return renderEmail({
		title: `${context.week} Pipeline`,
		preheader: jqToString(alt(draft.preheader, "")),
		children: (
			<>
				<Masthead title="Pipeline" />
				<TitleCard
					eyebrowText={`Week ${weekNumber(context.week)} · ${shortDate(context.monday)} to ${shortDate(context.sunday)}`}
					headlineLines={alt(draft.headline, [])}
					lede=""
				/>

				<Eyebrow text="The pipeline" />
				<Card>
					<ReadBlock text={jqToString(alt(draft.lede, ""))} divider={true} />
					{funnel === null ? (
						<EmptyRow text="The portal sweep carried no funnel this run." />
					) : (
						<>
							<Row last={false}>
								<StatStrip stats={stripStats(funnel)} />
							</Row>
							<Row last={listed.length === 0}>
								<List fontSize="13px">
									{counted.map((stage, index) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: a stage's position is its identity
										<ListRow key={index}>{countLine(stage)}</ListRow>
									))}
								</List>
							</Row>
							{listed.map((stage, index) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: a stage's position is its identity
								<Fragment key={index}>
									<SubEyebrow text={`${jqToString(stage.label)} · ${numberString(alt(stage.now, 0))}`} />
									<Row last={index === listed.length - 1}>
										{alt(stage.companies, []).length === 0 ? (
											<DimLine text="Nobody here this week." />
										) : (
											<RecordStack records={alt(stage.companies, []).map((c) => companyRecord(stage, c))} />
										)}
									</Row>
								</Fragment>
							))}
						</>
					)}
				</Card>

				<Eyebrow text="This week" />
				<Card>
					{owedKinds.length === 0 ? (
						<EmptyRow text="Nothing is owed this week." />
					) : (
						owedKinds.map((kind, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: a kind's position is its identity
							<Fragment key={index}>
								<SubEyebrow text={`${kind.label} · ${numberString(kind.names.length)}`} />
								<Row last={index === owedKinds.length - 1}>
									<RecordStack records={owedRecords(kind.names)} />
								</Row>
							</Fragment>
						))
					)}
				</Card>

				<Eyebrow text="The groom" />
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

				<Eyebrow text="In the roster" />
				<Card>
					<Row last={true}>
						<DimLine text={rosterTail(unverified, notInBlock)} />
					</Row>
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
	const stages = alt(funnel?.stages, []);
	const counted = stages.filter((stage) => !LISTED_STAGES.has(jqToString(stage.key)));
	const listed = stages.filter((stage) => LISTED_STAGES.has(jqToString(stage.key)));
	const owed = alt(draft.owed, {});
	const moves = moveRecords(draft.groom ?? null);
	const left = leftForYou(draft);

	let out = `ATELIC · PIPELINE · WEEK ${number}\n`;
	out += `Week ${number} · ${shortDate(context.monday)} to ${shortDate(context.sunday)}\n\n`;
	out += `${asciiUpcase(alt(draft.headline, []).join("\n"))}\n`;

	const lede = unindent(jqToString(alt(draft.lede, "")));
	out += textSection("The Pipeline") + (lede === "" ? "" : textRead(lede));
	if (funnel === null) {
		out += `${lede === "" ? "" : "\n"}  The portal sweep carried no funnel this run.\n`;
	} else {
		out += `\n${textTable(
			["Stage", "Now", "Change"],
			stages.map((stage) => [jqToString(stage.label), numberString(alt(stage.now, 0)), deltaText(stage)]),
			[1],
		)}\n`;
		out += `\n${counted.map((stage) => wrap(countLine(stage))).join("\n")}\n`;
		for (const stage of listed) {
			out += `\n${jqToString(stage.label)} · ${numberString(alt(stage.now, 0))}\n`;
			const companies = alt(stage.companies, []);
			out +=
				companies.length === 0
					? "  Nobody here this week.\n"
					: recordStackText(companies.map((c) => companyRecord(stage, c)));
		}
	}

	out += textSection("This Week");
	const owedKinds = OWED_KINDS.map((kind) => ({ ...kind, names: alt(owed[kind.key], []) })).filter(
		(kind) => kind.names.length > 0,
	);
	if (owedKinds.length === 0) out += "  Nothing is owed this week.\n";
	for (const kind of owedKinds) {
		out += `${kind.label} · ${numberString(kind.names.length)}\n${recordStackText(owedRecords(kind.names))}\n`;
	}

	out += textSection("The Groom");
	out += `${wrap(groomLine(draft.groom ?? null))}\n`;
	if (moves.length > 0) out += `\n${recordStackText(moves)}`;
	if (left.length > 0) {
		out += `\nLeft for you · ${numberString(left.length)}\n${left.map((line) => wrap(line)).join("\n")}\n`;
	}

	out += textSection("In the Roster");
	out += `${wrap(rosterTail(alt(draft.unverified, []).length, alt(draft.not_in_block, []).length))}\n`;

	out += `\n\n${context.meta}\n`;
	return out;
}
