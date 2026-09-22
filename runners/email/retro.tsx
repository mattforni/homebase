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
	Masthead,
	ReadBlock,
	Records,
	type RecordsCell,
	type RecordsColumn,
	Row,
	rpad,
	Scoreboard,
	StatStrip,
	SubEyebrow,
	TargetRow,
	textRead,
	textSection,
	textTable,
	textTableGrid,
	textTarget,
	TitleCard,
	WhatMoved,
	wrap,
} from "@atelic-action/ui/email";
import { renderEmail } from "@atelic-action/ui/email/render";
import {
	alt,
	codepoints,
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
import type { RenderContext } from "./types";

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
	sport_type?: string | null;
	start_date_local?: string | null;
	distance_mi?: number | null;
	moving_min?: number | null;
	athlete_count?: number | null;
};

type FunnelRow = {
	company?: unknown;
	lifecycle?: string | null;
	status?: unknown;
	kind?: unknown;
	touches?: unknown;
	opens?: unknown;
	replied?: unknown;
	stage?: string | null;
	cash?: string | null;
	reason?: unknown;
};

export type RetroDraft = {
	headline?: unknown;
	coverage?: CoverageRow[] | null;
	what_moved?: MovedRow[] | null;
	what_moved_note?: unknown;
	movement_read?: unknown;
	takeout?: TakeoutRow[] | null;
	takeout_read?: unknown;
	atelic_read?: unknown;
	blind_spots?: unknown;
	strava?: Activity[] | null;
	atelic?: {
		coverage?: AtelicCoverageRow[] | null;
		open_leads?: FunnelRow[] | null;
		opportunities?: FunnelRow[] | null;
		closed_leads?: FunnelRow[] | null;
	} | null;
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

function kindOf(activity: Activity): string {
	const mapped = KINDS[alt(activity.sport_type, "")];
	return mapped === undefined ? alt(activity.sport_type, "Session") : mapped;
}

/**
 * The same test the prompt grades by: a run Strava matched other athletes
 * into, or one whose name says who it was with.
 */
function isSocial(activity: Activity): boolean {
	if (kindOf(activity) !== "Run") return false;
	return alt(activity.athlete_count, 1) >= 2 || /diego|drc|sprc/i.test(alt(activity.name, ""));
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

function sessions(draft: RetroDraft): Session[] {
	const activities = [...alt(draft.strava, [])];
	activities.sort((a, b) => {
		const left = alt(a.start_date_local, "");
		const right = alt(b.start_date_local, "");
		return left < right ? -1 : left > right ? 1 : 0;
	});
	return activities.map((activity) => {
		const date = slice(alt(activity.start_date_local, ""), 0, 10);
		const miles = alt(activity.distance_mi, 0);
		return {
			day: weekdayName(fromDate(`${date}T00:00:00Z`)),
			date,
			name: cleanName(activity),
			kind: kindOf(activity),
			social: isSocial(activity),
			minutes: alt(activity.moving_min, 0),
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

/** The model's coverage, with its note. */
function movementTargets(draft: RetroDraft): Target[] {
	return alt(draft.coverage, []).map((row) => ({
		label: titlecase(row.modality),
		logged: num(row.logged),
		target: num(row.target),
		note: jqToString(alt(row.note, "")),
	}));
}

/** Takeout as a bare count: nothing measures it. */
function takeoutTarget(draft: RetroDraft): Target {
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
function atelicTargets(draft: RetroDraft): Target[] {
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

function graded(draft: RetroDraft): Target[] {
	return [...movementTargets(draft), ...atelicTargets(draft)];
}

function verdict(draft: RetroDraft): string {
	const all = graded(draft);
	if (all.length === 0) return "No targets graded.";
	const hit = all.filter((row) => row.target !== null && row.logged >= row.target).length;
	return `${word(hit)} of ${asciiDowncase(word(all.length))} targets hit.`;
}

/* ---------- the funnel ---------- */
/*
 * Six stages, the operating model's own (Atelic Tools/hubspot.md): Lead, MQL,
 * SQL, Opportunity, Customer, Closed. Lifecycle places a company, a closed
 * lead status or a Closed Lost deal overrides it, and a Closed Won deal reads
 * as Customer even before the lifecycle catches up.
 */

const LEAD_STAGES: Record<string, string> = {
	lead: "Lead",
	marketingqualifiedlead: "MQL",
	salesqualifiedlead: "SQL",
};

function leadStage(row: FunnelRow): string {
	const mapped = LEAD_STAGES[alt(row.lifecycle, "lead")];
	return mapped === undefined ? "Lead" : mapped;
}

function dealStage(row: FunnelRow): string {
	if (row.stage === "Closed Lost") return "Closed";
	if (row.stage === "Closed Won" || row.lifecycle === "customer") return "Customer";
	return "Opportunity";
}

type Staged = FunnelRow & { funnel: string };

function funnel(draft: RetroDraft): Staged[] {
	const atelic = alt(draft.atelic, {});
	return [
		...alt(atelic.open_leads, []).map((row) => ({ ...row, funnel: leadStage(row) })),
		...alt(atelic.opportunities, []).map((row) => ({ ...row, funnel: dealStage(row) })),
		...alt(atelic.closed_leads, []).map((row) => ({ ...row, funnel: "Closed" })),
	];
}

/*
 * Two families of tables, each on one fixed grid so Lead, MQL, and SQL line up
 * with each other, and Opportunity, Customer, and Closed with each other; the
 * Company column takes whatever width is left.
 */
const LEAD_COLS: RecordsColumn[] = [
	{ label: "Company", keep: true },
	{ label: "Status", right: true, width: 92, keep: true },
	{ label: "Last Touch", right: true, width: 92, keep: true },
	{ label: "Touches", right: true, width: 66, keep: true },
	{ label: "Opens", right: true, width: 56, keep: true },
	{ label: "Replied", right: true, width: 62, keep: true },
];

const DEAL_COLS: RecordsColumn[] = [
	{ label: "Company", keep: true },
	{ label: "Stage", right: true, width: 130, keep: true },
	{ label: "Cash", right: true, width: 110, keep: true },
];

const CLOSED_COLS: RecordsColumn[] = [
	{ label: "Company", keep: true },
	{ label: "Outcome", right: true, width: 130, keep: true },
	{ label: "Reason", right: true, width: 110, keep: true },
];

function leadCells(row: FunnelRow): RecordsCell[] {
	return [
		{ value: jqToString(row.company) },
		{ value: titlecase(row.status) },
		{ value: titlecase(row.kind) },
		{ value: jqToString(alt(row.touches, "")), mono: true },
		{ value: jqToString(alt(row.opens, "-")), mono: true },
		{ value: row.replied === "yes" ? "Yes" : "" },
	];
}

function dealCells(row: FunnelRow): RecordsCell[] {
	const stage = alt(row.stage, "-");
	const cash = alt(row.cash, "-");
	return [
		{ value: jqToString(row.company) },
		stage === "-" ? { value: "No stage set", muted: true } : { value: stage },
		{ value: cash === "-" ? "" : cash, mono: true },
	];
}

function closedCells(row: FunnelRow): RecordsCell[] {
	const reason = alt(row.reason, "-");
	return [
		{ value: jqToString(row.company) },
		{ value: row.stage === "Closed Lost" ? "Closed Lost" : titlecase(row.status), hot: true },
		{ value: reason === "-" ? "" : titlecase(reason) },
	];
}

type Stage = {
	name: string;
	label: string;
	cols: RecordsColumn[];
	family: string;
	right: number[];
	rows: Staged[];
	cells: RecordsCell[][];
};

/** Each stage with its rows, its columns, and the columns plain text aligns right. */
function stages(draft: RetroDraft): Stage[] {
	const all = funnel(draft);
	const shapes: {
		name: string;
		label: string;
		cols: RecordsColumn[];
		cell: (row: FunnelRow) => RecordsCell[];
		family: string;
		right: number[];
	}[] = [
		{ name: "Lead", label: "Lead", cols: LEAD_COLS, cell: leadCells, family: "lead", right: [3, 4] },
		{ name: "MQL", label: "MQL", cols: LEAD_COLS, cell: leadCells, family: "lead", right: [3, 4] },
		{ name: "SQL", label: "SQL", cols: LEAD_COLS, cell: leadCells, family: "lead", right: [3, 4] },
		{
			name: "Opportunity",
			label: "Oppty",
			cols: DEAL_COLS,
			cell: dealCells,
			family: "deal",
			right: [2],
		},
		{
			name: "Customer",
			label: "Customer",
			cols: DEAL_COLS,
			cell: dealCells,
			family: "deal",
			right: [2],
		},
		{
			name: "Closed",
			label: "Closed",
			cols: CLOSED_COLS,
			cell: closedCells,
			family: "deal",
			right: [],
		},
	];
	return shapes.map((shape) => {
		const rows = all.filter((row) => row.funnel === shape.name);
		return {
			name: shape.name,
			label: shape.label,
			cols: shape.cols,
			family: shape.family,
			right: shape.right,
			rows,
			cells: rows.map(shape.cell),
		};
	});
}

/** A stage's cells as the plain text tables read them: the value, or nothing. */
function plainCells(stage: Stage): string[][] {
	return stage.cells.map((row) => row.map((cell) => alt(cell.value, "")));
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
	rows.push([
		{ value: "" },
		{ value: "Total" },
		{ value: "" },
		{ value: numberString(totalMinutes(week)), mono: true },
		{ value: two(totalMiles(week)), mono: true },
	]);
	return <Records columns={columns} rows={rows} />;
}

function totalMinutes(week: Session[]): number {
	return week.reduce((sum, session) => sum + session.minutes, 0);
}

function totalMiles(week: Session[]): number {
	return week.reduce((sum, session) => sum + alt(session.miles, 0), 0);
}

export function retroHTML(input: unknown, context: RenderContext): string {
	const draft = input as RetroDraft;
	const week = sessions(draft);
	const movement = [...movementTargets(draft), takeoutTarget(draft)];
	const atelic = atelicTargets(draft);
	const funnelStages = stages(draft);
	const filled = funnelStages.filter((stage) => stage.rows.length > 0);
	const moved = alt(draft.what_moved, []);
	const movedNote = jqToString(alt(draft.what_moved_note, ""));
	const headline = jqToString(alt(draft.headline, ""));

	return renderEmail({
		title: `${context.week} Retro`,
		preheader: headline,
		children: (
			<>
				<Masthead title={`Retro · Week ${weekNumber(context.week)}`} />
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

				<Eyebrow text="Movement" />
				<Card>
					<ReadBlock text={jqToString(alt(draft.movement_read, ""))} divider={true} />
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
					<ReadBlock text={jqToString(alt(draft.takeout_read, ""))} divider={false} />
				</Card>

				<Eyebrow text="Atelic" />
				<Card>
					<ReadBlock text={jqToString(alt(draft.atelic_read, ""))} divider={true} />
					<Row last={false}>
						<StatStrip
							stats={funnelStages.map((stage) => ({ n: stage.rows.length, label: stage.label }))}
						/>
					</Row>
					{filled.map((stage, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: a stage's position is its identity
						<Fragment key={index}>
							<SubEyebrow text={`${stage.name} · ${stage.rows.length}`} />
							<RecordsRow last={index === filled.length - 1}>
								<Records columns={stage.cols} rows={stage.cells} />
							</RecordsRow>
						</Fragment>
					))}
				</Card>

				<Eyebrow text="Blind Spots" />
				<Card>
					<ReadBlock text={jqToString(alt(draft.blind_spots, ""))} divider={false} />
				</Card>

				<Footer meta={context.meta} />
			</>
		),
	});
}

/* ---------- plain text ---------- */

export function retroText(input: unknown, context: RenderContext): string {
	const draft = input as RetroDraft;
	const week = sessions(draft);
	const number = weekNumber(context.week);
	const movement = [...movementTargets(draft), takeoutTarget(draft)];
	const atelic = atelicTargets(draft);
	const funnelStages = stages(draft);
	const moved = alt(draft.what_moved, []);
	const movedNote = jqToString(alt(draft.what_moved_note, ""));

	let out = `ATELIC · RETRO · WEEK ${number}\n${rangeLine(context.monday, context.sunday)}\n\n`;
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

	out += textSection("Movement") + textRead(jqToString(alt(draft.movement_read, "")));
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
						["", "Total", "", numberString(totalMinutes(week)), two(totalMiles(week))],
					],
					[3, 4],
				);
	out += "\n";

	out += textSection("Takeout") + textRead(jqToString(alt(draft.takeout_read, "")));

	out += textSection("Atelic") + textRead(jqToString(alt(draft.atelic_read, "")));
	out += `\nThe Funnel\n${funnelStages
		.map((stage) => `  ${rpad(stage.label, 10)}${stage.rows.length}`)
		.join("\n")}\n`;
	// One width per column per family, the widest header or cell across every
	// table in it, so the plain text tables line up the way the html ones do.
	const grid: Record<string, number[]> = {};
	for (const stage of funnelStages) {
		if (grid[stage.family] !== undefined) continue;
		const family = funnelStages.filter((other) => other.family === stage.family);
		grid[stage.family] = rangeOf(family[0].cols.length).map((index) =>
			Math.max(
				...family.flatMap((member) => [
					codepoints(member.cols[index].label),
					...plainCells(member).map((row) => codepoints(alt(row[index], ""))),
				]),
			),
		);
	}
	out += funnelStages
		.filter((stage) => stage.rows.length > 0)
		.map(
			(stage) =>
				`\n${stage.name} · ${stage.rows.length}\n${textTableGrid(
					stage.cols.map((column) => column.label),
					plainCells(stage),
					stage.right,
					grid[stage.family],
				)}\n`,
		)
		.join("");

	out += textSection("Blind Spots") + textRead(jqToString(alt(draft.blind_spots, "")));
	out += `\n\n${context.meta}\n`;
	return out;
}
