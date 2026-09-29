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

function leadRecord(row: FunnelRow): RecordStackItem {
	const kind = titlecase(alt(row.kind, ""));
	const touches = row.touches === null || row.touches === undefined ? null : Number(row.touches);
	const opens = row.opens === null || row.opens === undefined ? null : Number(row.opens);
	return recordCard({
		title: row.company,
		badge: row.status,
		touch: { touches, opens, replied: row.replied === "yes" },
		note: kind === "" ? undefined : `Last touch: ${kind}`,
	});
}

function dealRecord(row: FunnelRow): RecordStackItem {
	const cash = alt(row.cash, "-");
	return recordCard({
		title: row.company,
		deal: { stage: alt(row.stage, ""), amount: null, cash: cash === "-" ? "" : cash },
	});
}

function closedRecord(row: FunnelRow): RecordStackItem {
	const reason = alt(row.reason, "-");
	return recordCard({
		title: row.company,
		badge: row.stage === "Closed Lost" ? "Closed Lost" : row.status,
		closed: reason === "-" ? null : { reason },
	});
}

type Stage = {
	name: string;
	label: string;
	rows: Staged[];
	records: RecordStackItem[];
};

/** Each stage with its rows and the records that list them. */
function stages(draft: RetroDraft): Stage[] {
	const all = funnel(draft);
	const shapes: { name: string; label: string; record: (row: FunnelRow) => RecordStackItem }[] = [
		{ name: "Lead", label: "Lead", record: leadRecord },
		{ name: "MQL", label: "MQL", record: leadRecord },
		{ name: "SQL", label: "SQL", record: leadRecord },
		{ name: "Opportunity", label: "Oppty", record: dealRecord },
		{ name: "Customer", label: "Customer", record: dealRecord },
		{ name: "Closed", label: "Closed", record: closedRecord },
	];
	return shapes.map((shape) => {
		const rows = all.filter((row) => row.funnel === shape.name);
		return { name: shape.name, label: shape.label, rows, records: rows.map(shape.record) };
	});
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
								<RecordStack records={stage.records} />
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
	out += funnelStages
		.filter((stage) => stage.rows.length > 0)
		.map((stage) => `\n${stage.name} · ${stage.rows.length}\n${recordStackText(stage.records)}\n`)
		.join("");

	out += textSection("Blind Spots") + textRead(jqToString(alt(draft.blind_spots, "")));
	out += `\n\n${context.meta}\n`;
	return out;
}
