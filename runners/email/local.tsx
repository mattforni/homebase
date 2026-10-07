import { Fragment, type ReactNode } from "react";
import { eyebrowStyle, useEmailTheme } from "@atelic-action/ui/email";

/*
 * The handful of rows and spans the three jq renderers built by hand rather
 * than through a library def. Each one is a literal port: the same element, the
 * same attributes, and the style declarations in the same order the jq wrote
 * them, because the parity check compares declarations as an ordered list.
 *
 * Nothing here belongs in the package until a second runner wants it. A piece
 * that earns a second caller graduates to @atelic-action/ui and loses its copy
 * here.
 */

/* ---------- retro ---------- */

export type RecordsRowProps = { last: boolean; children?: ReactNode };

/**
 * The card row a records table sits in: the card's own side padding with no
 * top, and a line border until the last table closes the card.
 */
export function RecordsRow({ last, children }: RecordsRowProps) {
	const { palette } = useEmailTheme();
	return (
		<tr>
			<td
				style={
					last
						? { padding: "0 24px 22px" }
						: { padding: "0 24px 18px", borderBottom: `1px solid ${palette.line}` }
				}
			>
				{children}
			</td>
		</tr>
	);
}

export type SessionsRowProps = { children?: ReactNode };

/** The card row the sessions table sits in, which never closes a card. */
export function SessionsRow({ children }: SessionsRowProps) {
	return (
		<tr>
			<td style={{ padding: "0 24px 20px" }}>{children}</td>
		</tr>
	);
}

/** The empty row that stands in for the what moved bar, so the card keeps its foot. */
export function SpacerRow() {
	return (
		<tr>
			<td style={{ padding: "0 0 26px" }} />
		</tr>
	);
}

/* ---------- pipeline ---------- */

export type LinkProps = { text: string; url?: string | null };

/**
 * A name that carries its record's url, underlined in the accent. Without a
 * url it degrades to the plain words, which is what a name with no record
 * looks like.
 */
export function Link({ text, url }: LinkProps) {
	const { palette } = useEmailTheme();
	if (!url) return <>{text}</>;
	return (
		<a
			href={url}
			style={{
				color: palette.ink,
				textDecoration: "underline",
				textDecorationColor: palette.accent,
			}}
		>
			{text}
		</a>
	);
}

export type RosterLineProps = { url: string };

/**
 * The last line of the read card: where the long read lives. It sits in the
 * TitleCard's stats slot, so the lede keeps the card's foot and this line
 * reads as its own paragraph (Forni, 2026-09-29, after the roster link rode
 * as a card of its own).
 */
export function RosterLine({ url }: RosterLineProps) {
	const { palette, fonts } = useEmailTheme();
	return (
		<tr>
			<td style={{ padding: "14px 26px 26px", fontFamily: fonts.sans, fontSize: "15px", lineHeight: "1.6", color: palette.dim }}>
				The full read is in <Link text="the roster" url={url} />.
			</td>
		</tr>
	);
}

/**
 * One line of the list: a bold lead (linked when it carries the record), the
 * sentence after it, the due date, and a linked key at the end. The due date
 * and the key each hold to one line, since a browser breaks "10-15" and
 * "ATE-633" at the hyphen and leaves half a date at the end of a row.
 */
export type NeedsItem = { lead: string; url?: string | null; rest: string; due?: string; ref?: string; refUrl?: string | null };
export type NeedsGroup = { label: string; items: NeedsItem[] };
export type NeedsListProps = { groups: NeedsGroup[] };

/**
 * The numbered list the mail opens on (Forni, 2026-10-07, ATE-630): one line
 * per thing that needs him, numbered straight through, with a quiet label
 * over each group so a line's rank explains itself. The number is a cell of
 * its own rather than an ordered list's marker, since Gmail drops list
 * markers inside a table cell on some accounts and a to do list without its
 * numbers is a paragraph.
 */
export function NeedsList({ groups }: NeedsListProps) {
	const { palette, fonts } = useEmailTheme();
	const starts = groups.map((_, g) => groups.slice(0, g).reduce((sum, group) => sum + group.items.length, 0));
	const line = `1px solid ${palette.hair}`;
	return (
		<table role="presentation" cellPadding="0" cellSpacing="0" border={0} width="100%">
			<tbody>
				{groups.map((group, g) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: a group's position is its identity
					<Fragment key={g}>
						<tr>
							<td colSpan={2} style={{ padding: g === 0 ? "0 0 6px" : "18px 0 6px", ...eyebrowStyle(fonts), color: palette.faint }}>
								{group.label}
							</td>
						</tr>
						{group.items.map((item, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: a line's position is its identity
							<tr key={i}>
								<td
									width="26"
									valign="top"
									align="right"
									style={{
										width: "26px",
										padding: "8px 10px 8px 0",
										borderTop: line,
										fontFamily: fonts.mono,
										fontSize: "12px",
										lineHeight: "22px",
										color: palette.faint,
										whiteSpace: "nowrap",
									}}
								>
									{`${starts[g] + i + 1}.`}
								</td>
								<td valign="top" style={{ padding: "8px 0", borderTop: line, fontSize: "15px", lineHeight: "22px", color: palette.ink }}>
									<b style={{ fontWeight: "600" }}>
										<Link text={item.lead} url={item.url} />
									</b>
									{item.rest}
									{item.due ? (
										<>
											{" "}
											<span style={{ whiteSpace: "nowrap" }}>{item.due}</span>
										</>
									) : null}
									{item.ref ? (
										<>
											{" "}
											<span style={{ whiteSpace: "nowrap" }}>
												<Link text={item.ref} url={item.refUrl} />.
											</span>
										</>
									) : null}
								</td>
							</tr>
						))}
					</Fragment>
				))}
			</tbody>
		</table>
	);
}

export type DimLineProps = { text: string };

/** One dim sentence filling a card row: the board's empty state. */
export function DimLine({ text }: DimLineProps) {
	const { palette } = useEmailTheme();
	return <span style={{ fontSize: "14px", color: palette.dim }}>{text}</span>;
}

export type GroupLabelProps = { text: string };

/** The bold label over one of the board's lists. */
export function GroupLabel({ text }: GroupLabelProps) {
	const { palette, fonts } = useEmailTheme();
	return (
		<b
			style={{
				fontFamily: fonts.sans,
				fontSize: "14px",
				color: palette.ink,
				fontWeight: "600",
			}}
		>
			{text}
		</b>
	);
}

/* ---------- pipeline and recruiter ---------- */

export type FaintSpanProps = { children?: ReactNode };

/** A quiet aside inside a list row: a note after a name, a count after a list. */
export function FaintSpan({ children }: FaintSpanProps) {
	const { palette } = useEmailTheme();
	return <span style={{ color: palette.faint }}>{children}</span>;
}

/* ---------- recruiter ---------- */

export type FractionalEmptyRowProps = { text: string };

/**
 * The fractional lane's empty state, which keeps its bottom line because the
 * prospects and tradeoff notes follow it inside the same card.
 */
export function FractionalEmptyRow({ text }: FractionalEmptyRowProps) {
	const { palette, fonts } = useEmailTheme();
	return (
		<tr>
			<td
				style={{
					padding: "22px 24px 20px",
					fontFamily: fonts.sans,
					fontSize: "14px",
					color: palette.dim,
					borderBottom: `1px solid ${palette.line}`,
				}}
			>
				{text}
			</td>
		</tr>
	);
}
