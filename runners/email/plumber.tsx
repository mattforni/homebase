import {
	asciiUpcase,
	Card,
	EmptyRow,
	Eyebrow,
	Footer,
	List,
	ListRow,
	Masthead,
	MonoTable,
	Note,
	Row,
	Stat,
	StatsRow,
	textSection,
	textTable,
	TitleCard,
	wrap,
} from "@atelic-action/ui/email";
import { renderEmail } from "@atelic-action/ui/email/render";
import { alt, jqToString, numberString, shortDate, unindent, weekNumber } from "./jq";
import { DimLine, GroupLabel, Link } from "./local";
import { leadBlock } from "./text";
import type { RenderContext } from "./types";

/*
 * The Pipeline email: the week's scoreboard as the roster carries it, one list
 * of bare names per type of everyone still owed that touch, the queue counts,
 * the flags from the portal diff as one line each, and one line saying what
 * the roster holds beyond that. The roster itself is deliberately not here: it
 * travels as a file beside the email, since the block reads it in the repo,
 * and it carries everything the email leaves out (the per name notes, every
 * flag's full note, the could not verify list and the names left off on
 * purpose). The first mail of this page, 2026-W39, carried all of that inline
 * and Forni read it as too dense to run unattended; the two minute read is
 * the email's whole job, and the roster gets the block (ATE-551, 2026-09-24).
 */

type ScoreboardRow = { type?: unknown; target?: number | null; details?: unknown };
type ChecklistName = {
	person?: unknown;
	company?: unknown;
	contact_url?: string | null;
	company_url?: string | null;
	note?: unknown;
};
type ChecklistRow = { type?: unknown; names?: ChecklistName[] | null };
type LeadNote = { lead?: unknown; note?: unknown };

export type PipelineDraft = {
	preheader?: unknown;
	headline?: string[] | null;
	lede?: unknown;
	scoreboard?: ScoreboardRow[] | null;
	checklist?: ChecklistRow[] | null;
	counts?: {
		next_up?: unknown;
		next_up_new?: unknown;
		unscored?: unknown;
		tasks_due?: unknown;
		tasks_parked?: unknown;
		tasks_stale?: unknown;
		top_opened?: unknown;
	} | null;
	flags?: LeadNote[] | null;
	unverified?: LeadNote[] | null;
	not_in_block?: LeadNote[] | null;
};

function targetOf(draft: PipelineDraft, type: string): number {
	const match = alt(draft.scoreboard, []).filter((row) => row.type === type)[0];
	return match === undefined ? 0 : alt(match.target, 0);
}

/** The board's rows, Complete at zero on the day the roster is built. */
function boardRows(draft: PipelineDraft): string[][] {
	const rows = alt(draft.scoreboard, []);
	const total = rows.reduce((sum, row) => sum + alt(row.target, 0), 0);
	return [
		...rows.map((row) => [
			jqToString(row.type),
			"0",
			numberString(alt(row.target, 0)),
			"0",
			jqToString(alt(row.details, "")),
		]),
		["Total", "0", numberString(total), "0", ""],
	];
}

function filledLists(draft: PipelineDraft): ChecklistRow[] {
	return alt(draft.checklist, []).filter((row) => alt(row.names, []).length > 0);
}

/** The six queue counts, each of which reads as a question mark when the sweep could not see it. */
function countRows(draft: PipelineDraft): string[][] {
	const counts = alt(draft.counts, {});
	return [
		[
			jqToString(alt(counts.next_up, "?")),
			jqToString(alt(counts.next_up_new, "?")),
			jqToString(alt(counts.unscored, "?")),
			jqToString(alt(counts.tasks_due, "?")),
			jqToString(alt(counts.tasks_parked, "?")),
			jqToString(alt(counts.tasks_stale, "?")),
		],
	];
}

const COUNT_HEADERS = ["Next Up", "Still NEW", "Unscored", "Tasks due", "Parked", "Stale"];
const BOARD_HEADERS = ["Type", "Complete", "Target", "%", "Details"];

function plural(count: number, noun: string): string {
	return `${numberString(count)} ${noun}${count === 1 ? "" : "s"}`;
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
	return `${could}, and ${left}. Both lists, every draft, and each flag's full note are in the attached roster.`;
}

/* ---------- html ---------- */

export function pipelineHTML(input: unknown, context: RenderContext): string {
	const draft = input as PipelineDraft;
	const lists = filledLists(draft);
	const counts = alt(draft.counts, {});
	const topOpened = jqToString(alt(counts.top_opened, ""));
	const flags = alt(draft.flags, []);
	const unverified = alt(draft.unverified, []);
	const notInBlock = alt(draft.not_in_block, []);

	return renderEmail({
		title: `${context.week} Pipeline`,
		preheader: jqToString(alt(draft.preheader, "")),
		children: (
			<>
				<Masthead title="Pipeline" />
				<TitleCard
					eyebrowText={`Week ${weekNumber(context.week)} · ${shortDate(context.monday)} to ${shortDate(context.sunday)}`}
					headlineLines={alt(draft.headline, [])}
					lede={jqToString(alt(draft.lede, ""))}
					stats={
						<StatsRow>
							<Stat n={targetOf(draft, "Replies")} caption="replies owed" />
							<Stat n={targetOf(draft, "Bumps")} caption="bumps due" />
							<Stat n={targetOf(draft, "Intros")} caption="first touches" />
						</StatsRow>
					}
				/>

				<Eyebrow text="The board" />
				<Card>
					<Row last={false}>
						<MonoTable headers={BOARD_HEADERS} rows={boardRows(draft)} />
					</Row>
					{lists.length === 0 ? (
						<Row last={true}>
							<DimLine text="Nobody is owed a touch this week." />
						</Row>
					) : (
						lists.map((list, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: a list's position is its identity
							<Row key={index} last={index === lists.length - 1}>
								<GroupLabel text={jqToString(list.type)} />
								<List fontSize="13px">
									{alt(list.names, []).map((name, position) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: a name's position is its identity
										<ListRow key={position}>
											<Link text={jqToString(name.person)} url={name.contact_url} />
											{", "}
											<Link text={jqToString(name.company)} url={name.company_url} />
										</ListRow>
									))}
								</List>
							</Row>
						))
					)}
				</Card>

				<Eyebrow text="The queue" />
				<Card>
					<Row last={topOpened === ""}>
						<MonoTable headers={COUNT_HEADERS} rows={countRows(draft)} />
					</Row>
					{topOpened === "" ? null : (
						<Note eyebrowText="Hottest reader" text={topOpened} accented={true} last={true} />
					)}
				</Card>

				<Eyebrow text="Flags from the portal diff" />
				<Card>
					{flags.length === 0 ? (
						<EmptyRow text="The roster and the portal agree." />
					) : (
						<Row last={true}>
							<List fontSize="14px">
								{flags.map((flag, index) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: a flag's position is its identity
									<ListRow key={index}>{jqToString(flag.lead)}</ListRow>
								))}
							</List>
						</Row>
					)}
				</Card>

				<Eyebrow text="In the roster" />
				<Card>
					<Row last={true}>
						<DimLine text={rosterTail(unverified.length, notInBlock.length)} />
					</Row>
				</Card>

				<Footer meta={context.meta} />
			</>
		),
	});
}

/* ---------- plain text ---------- */
/*
 * No jq twin: the Pipeline email mailed html alone until the node renderer
 * arrived. Written in the retro's idiom, because the two land in the same
 * inbox and should read as one family: a title block, a ruled section per
 * card, a column table wherever the html shows a table, and every label and
 * number in its own column.
 */

/** The flags as one wrapped line each; the full note is the roster's. */
function leadsText(rows: LeadNote[], empty: string): string {
	if (rows.length === 0) return `  ${empty}\n`;
	return `${rows.map((row) => wrap(jqToString(row.lead))).join("\n")}\n`;
}

/*
 * One name on the week's list: the person and the company on a line, wrapped
 * as prose, since a company with its role title is as long as any sentence.
 */
function nameText(name: ChecklistName): string {
	const person = jqToString(name.person);
	const company = jqToString(alt(name.company, ""));
	return leadBlock(company === "" ? person : `${person} · ${company}`, "");
}

export function pipelineText(input: unknown, context: RenderContext): string {
	const draft = input as PipelineDraft;
	const number = weekNumber(context.week);
	const counts = alt(draft.counts, {});
	const topOpened = jqToString(alt(counts.top_opened, ""));
	const lists = filledLists(draft);

	let out = `ATELIC · PIPELINE · WEEK ${number}\n`;
	out += `Week ${number} · ${shortDate(context.monday)} to ${shortDate(context.sunday)}\n\n`;
	out += `${asciiUpcase(alt(draft.headline, []).join("\n"))}\n\n`;
	out += `${unindent(wrap(jqToString(alt(draft.lede, ""))))}\n`;

	out += textSection("The Board");
	// The numbers keep their table; Details is free text, so it leaves the grid
	// and each row that has one says it beneath, under its own type.
	const board = boardRows(draft);
	out += `${textTable(
		BOARD_HEADERS.slice(0, -1),
		board.map((row) => row.slice(0, -1)),
		[1, 2, 3],
	)}\n`;
	const detailed = board.filter((row) => row[row.length - 1] !== "");
	if (detailed.length > 0) {
		out += `\n${detailed.map((row) => leadBlock(row[0], row[row.length - 1])).join("\n\n")}\n`;
	}
	if (lists.length === 0) {
		out += "\n  Nobody is owed a touch this week.\n";
	} else {
		out += lists
			.map((list) => {
				const names = alt(list.names, []);
				return `\n${jqToString(list.type)} · ${names.length}\n${names.map(nameText).join("\n")}\n`;
			})
			.join("");
	}

	out += textSection("The Queue");
	out += `${textTable(
		["Measure", "Count"],
		COUNT_HEADERS.map((header, index) => [header, countRows(draft)[0][index]]),
		[1],
	)}\n`;
	if (topOpened !== "") out += `\nHottest reader\n${wrap(topOpened)}\n`;

	out += textSection("Flags From the Portal Diff");
	out += leadsText(alt(draft.flags, []), "The roster and the portal agree.");

	out += textSection("In the Roster");
	out += `${wrap(rosterTail(alt(draft.unverified, []).length, alt(draft.not_in_block, []).length))}\n`;

	out += `\n\n${context.meta}\n`;
	return out;
}
