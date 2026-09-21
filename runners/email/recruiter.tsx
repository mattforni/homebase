import {
	asciiUpcase,
	BigFold,
	Card,
	EmptyRow,
	Eyebrow,
	Footer,
	FoldRow,
	Item,
	LeadRow,
	List,
	ListRow,
	Masthead,
	Note,
	Stat,
	StatsRow,
	textSection,
	TitleCard,
	wrap,
} from "@atelic-action/ui/email";
import { renderEmail } from "@atelic-action/ui/email/render";
import { alt, jqToString, shortDate, unindent, weekNumber } from "./jq";
import { FaintSpan, FractionalEmptyRow } from "./local";
import { hang, leadBlock } from "./text";
import type { RenderContext } from "./types";

/*
 * The Recruiter email, ported from runners/recruiter/render.jq: the shortlist,
 * the escape hatches above the fold where they cannot be read past, the
 * fractional lane, and the considered and rejected tail behind a fold. The
 * ledger is deliberately not here: it travels as a file beside the email,
 * since the Tuesday block appends it rather than reads it.
 */

type Role = {
	company?: unknown;
	role?: string | null;
	comp?: string | null;
	arrangement?: string | null;
	fit?: unknown;
	missed?: unknown;
	why?: unknown;
	about?: unknown;
	url?: unknown;
};

type Fractional = {
	company?: unknown;
	role?: string | null;
	rate?: unknown;
	hours?: string | null;
	location?: string | null;
	why?: unknown;
	detail?: unknown;
};

type Rejected = { company?: unknown; reason?: unknown };
type Source = { lead?: unknown; note?: unknown };

export type RecruiterDraft = {
	preheader?: unknown;
	headline?: string[] | null;
	lede?: unknown;
	shortlist?: Role[] | null;
	flagged?: Role[] | null;
	fractional?: Fractional[] | null;
	prospects?: unknown;
	tradeoff?: unknown;
	rejected?: Rejected[] | null;
	rejected_note?: unknown;
	sources?: Source[] | null;
};

/* ---------- html ---------- */

export function recruiterHTML(input: unknown, context: RenderContext): string {
	const draft = input as RecruiterDraft;
	const shortlist = alt(draft.shortlist, []);
	const flagged = alt(draft.flagged, []);
	const fractional = alt(draft.fractional, []);
	const rejected = alt(draft.rejected, []);
	const sources = alt(draft.sources, []);
	const prospects = jqToString(alt(draft.prospects, ""));
	const tradeoff = jqToString(alt(draft.tradeoff, ""));
	const rejectedNote = jqToString(alt(draft.rejected_note, ""));

	return renderEmail({
		title: `${context.week} Recruiter`,
		preheader: jqToString(alt(draft.preheader, "")),
		children: (
			<>
				<Masthead title="Recruiter" />
				<TitleCard
					eyebrowText={`Week ${weekNumber(context.week)} · ${shortDate(context.monday)} to ${shortDate(context.sunday)}`}
					headlineLines={alt(draft.headline, [])}
					lede={jqToString(alt(draft.lede, ""))}
					stats={
						<StatsRow>
							<Stat n={shortlist.length} caption="shortlisted" />
							<Stat n={flagged.length} caption="for your call" />
							<Stat n={rejected.length} caption="verified & killed" />
						</StatsRow>
					}
				/>

				<Eyebrow text="Shortlist" />
				<Card>
					{shortlist.length === 0 ? (
						<EmptyRow text="Nothing cleared every filter this week." />
					) : (
						shortlist.map((role, index) => (
							<Item
								// biome-ignore lint/suspicious/noArrayIndexKey: a role's position is its identity
								key={index}
								name={jqToString(role.company)}
								right={jqToString(role.fit)}
								subparts={[alt(role.role, null), alt(role.comp, null), alt(role.arrangement, null)]}
								body={jqToString(alt(role.why, ""))}
								foldLabel="what they do"
								foldBody={jqToString(alt(role.about, ""))}
								linkText="Posting"
								url={jqToString(alt(role.url, ""))}
								last={index === shortlist.length - 1}
							/>
						))
					)}
				</Card>

				{flagged.length === 0 ? null : (
					<>
						<Eyebrow text="For your call" />
						<Card>
							{flagged.map((role, index) => (
								<Item
									// biome-ignore lint/suspicious/noArrayIndexKey: a role's position is its identity
									key={index}
									name={jqToString(role.company)}
									right={jqToString(alt(role.missed, "flagged"))}
									subparts={[
										alt(role.role, null),
										alt(role.comp, null),
										alt(role.arrangement, null),
									]}
									body={jqToString(alt(role.why, ""))}
									foldLabel=""
									foldBody=""
									linkText="Posting"
									url={jqToString(alt(role.url, ""))}
									last={index === flagged.length - 1}
								/>
							))}
						</Card>
					</>
				)}

				<Eyebrow text="Fractional lane" />
				<Card>
					{fractional.length === 0 ? (
						<FractionalEmptyRow text="No posted fractional role cleared the band this week." />
					) : (
						fractional.map((role, index) => (
							<Item
								// biome-ignore lint/suspicious/noArrayIndexKey: a role's position is its identity
								key={index}
								name={jqToString(role.company)}
								right={jqToString(alt(role.rate, "Rate undisclosed"))}
								subparts={[alt(role.role, null), alt(role.hours, null), alt(role.location, null)]}
								body={jqToString(alt(role.why, ""))}
								foldLabel="detail"
								foldBody={jqToString(alt(role.detail, ""))}
								linkText=""
								url=""
								last={false}
							/>
						))
					)}
					{prospects === "" ? null : (
						<Note
							eyebrowText="Prospects"
							text={prospects}
							accented={false}
							last={tradeoff === ""}
						/>
					)}
					{tradeoff === "" ? null : (
						<Note eyebrowText="One tradeoff" text={tradeoff} accented={true} last={true} />
					)}
				</Card>

				<Eyebrow text="If you want to dig in" />
				<Card>
					<FoldRow last={false}>
						<BigFold summary="Considered and rejected" count={String(rejected.length)}>
							<List fontSize="13px">
								{rejected.map((row, index) => (
									<LeadRow
										// biome-ignore lint/suspicious/noArrayIndexKey: a row's position is its identity
										key={index}
										lead={jqToString(row.company)}
										rest={`· ${jqToString(row.reason)}`}
									/>
								))}
								{rejectedNote === "" ? null : (
									<ListRow>
										<FaintSpan>{rejectedNote}</FaintSpan>
									</ListRow>
								)}
							</List>
						</BigFold>
					</FoldRow>
					<FoldRow last={true}>
						<BigFold summary="Source notes">
							<List fontSize="14px">
								{sources.map((row, index) => (
									<LeadRow
										// biome-ignore lint/suspicious/noArrayIndexKey: a row's position is its identity
										key={index}
										lead={jqToString(row.lead)}
										rest={jqToString(row.note)}
									/>
								))}
							</List>
						</BigFold>
					</FoldRow>
				</Card>

				<Footer meta={context.meta} />
			</>
		),
	});
}

/* ---------- plain text ---------- */
/*
 * No jq twin: the recruiter email mailed html alone until the node renderer
 * arrived. Written in the retro's idiom so the two read as one family. A role
 * is a block: its name on its own line, every fact in a padded label column,
 * then its prose wrapped beneath.
 */

const LABEL_WIDTH = 15;

function field(label: string, value: string): string {
	return hang(label, value, LABEL_WIDTH);
}

function prose(text: string): string {
	return text === "" ? "" : `\n${wrap(text)}\n`;
}

function roleBlock(role: Role, rightLabel: string, rightValue: string): string {
	let block = `${jqToString(role.company)}\n`;
	block += field("Role", jqToString(alt(role.role, "")));
	block += field("Comp", jqToString(alt(role.comp, "")));
	block += field("Arrangement", jqToString(alt(role.arrangement, "")));
	block += field(rightLabel, rightValue);
	const url = jqToString(alt(role.url, ""));
	if (url !== "") block += field("Posting", url);
	block += prose(jqToString(alt(role.why, "")));
	block += prose(jqToString(alt(role.about, "")));
	return block;
}

export function recruiterText(input: unknown, context: RenderContext): string {
	const draft = input as RecruiterDraft;
	const number = weekNumber(context.week);
	const shortlist = alt(draft.shortlist, []);
	const flagged = alt(draft.flagged, []);
	const fractional = alt(draft.fractional, []);
	const rejected = alt(draft.rejected, []);
	const sources = alt(draft.sources, []);
	const prospects = jqToString(alt(draft.prospects, ""));
	const tradeoff = jqToString(alt(draft.tradeoff, ""));
	const rejectedNote = jqToString(alt(draft.rejected_note, ""));

	let out = `ATELIC · RECRUITER · WEEK ${number}\n`;
	out += `Week ${number} · ${shortDate(context.monday)} to ${shortDate(context.sunday)}\n\n`;
	out += `${asciiUpcase(alt(draft.headline, []).join("\n"))}\n\n`;
	out += `${unindent(wrap(jqToString(alt(draft.lede, ""))))}\n`;

	out += textSection(`Shortlist · ${shortlist.length}`);
	out +=
		shortlist.length === 0
			? "  Nothing cleared every filter this week.\n"
			: shortlist.map((role) => roleBlock(role, "Fit", jqToString(role.fit))).join("\n");

	if (flagged.length > 0) {
		out += textSection(`For Your Call · ${flagged.length}`);
		out += flagged
			.map((role) => roleBlock(role, "Missed", jqToString(alt(role.missed, "flagged"))))
			.join("\n");
	}

	out += textSection(`Fractional Lane · ${fractional.length}`);
	if (fractional.length === 0) {
		out += "  No posted fractional role cleared the band this week.\n";
	} else {
		out += fractional
			.map((role) => {
				let block = `${jqToString(role.company)}\n`;
				block += field("Role", jqToString(alt(role.role, "")));
				block += field("Rate", jqToString(alt(role.rate, "Rate undisclosed")));
				block += field("Hours", jqToString(alt(role.hours, "")));
				block += field("Location", jqToString(alt(role.location, "")));
				block += prose(jqToString(alt(role.why, "")));
				block += prose(jqToString(alt(role.detail, "")));
				return block;
			})
			.join("\n");
	}
	if (prospects !== "") out += `\nProspects\n${wrap(prospects)}\n`;
	if (tradeoff !== "") out += `\nOne tradeoff\n${wrap(tradeoff)}\n`;

	out += textSection("If You Want to Dig In");
	out += `Considered and rejected · ${rejected.length}\n`;
	out +=
		rejected.length === 0
			? "  Nothing was rejected this week.\n"
			: `${rejected
					.map((row) => leadBlock(jqToString(row.company), jqToString(alt(row.reason, ""))))
					.join("\n\n")}\n`;
	// A blank line first, or the note reads as the tail of the last reason.
	if (rejectedNote !== "") out += `${rejected.length > 0 ? "\n" : ""}${wrap(rejectedNote)}\n`;

	out += `\nSource notes · ${sources.length}\n`;
	out +=
		sources.length === 0
			? "  Nothing would change the source list.\n"
			: `${sources
					.map((row) => leadBlock(jqToString(row.lead), jqToString(alt(row.note, ""))))
					.join("\n\n")}\n`;

	out += `\n\n${context.meta}\n`;
	return out;
}
