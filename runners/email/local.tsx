import type { ReactNode } from "react";
import { useEmailTheme } from "@atelic-action/ui/email";

/*
 * The handful of rows and spans the jq renderers built by hand rather
 * than through a library def. Each one is a literal port: the same element, the
 * same attributes, and the style declarations in the same order the jq wrote
 * them, because the parity check compares declarations as an ordered list.
 *
 * Nothing here belongs in the package until a second runner wants it. A piece
 * that earns a second caller graduates to @atelic-action/ui and loses its copy
 * here.
 */

/* ---------- brief ---------- */

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

export type StripedColumn = { label: string; right?: boolean };
export type StripedCell = {
	value: string;
	mono?: boolean;
	muted?: boolean;
	hot?: boolean;
	/** A figure read as good or bad: `up` draws green, `down` red. */
	tone?: "up" | "down";
	html?: ReactNode;
};
export type StripedTableProps = {
	columns: StripedColumn[];
	rows: StripedCell[][];
	/** The closing row, drawn darker than the stripes and in bold: a total. */
	total?: StripedCell[];
};

/**
 * A data table with zebra stripes and a darker total row (Forni, 2026-11-09,
 * on the sessions table: "zebra stripe it so that we can more easily discern
 * what's going on"). The package's Records draws hairlines between rows and
 * has no stripe or footer yet (ATE-675 names the graduation); this is the
 * same type and spacing with a background on every other row, set inline on
 * each cell, which is the one form Gmail keeps.
 */
export function StripedTable({ columns, rows, total }: StripedTableProps) {
	const { palette, fonts } = useEmailTheme();
	const cellStyle = (cell: StripedCell, column: StripedColumn, strong: boolean) => ({
		padding: "8px 8px",
		...(cell.mono ? { fontFamily: fonts.mono, fontSize: "12px" } : {}),
		...(strong ? { fontWeight: 600 } : {}),
		color:
			cell.tone === "up"
				? palette.up
				: cell.tone === "down"
					? palette.down
					: cell.hot
						? palette.accent
						: cell.muted
							? palette.faint
							: cell.mono && !strong
								? palette.dim
								: palette.ink,
		...(column.right ? { whiteSpace: "nowrap" as const } : {}),
	});
	return (
		<table
			role="presentation"
			cellPadding={0}
			cellSpacing={0}
			border={0}
			width="100%"
			style={{ fontFamily: fonts.sans, fontSize: "13px", lineHeight: "1.4", color: palette.ink }}
		>
			<tbody>
				<tr>
					{columns.map((column, i) => (
						<td
							// biome-ignore lint/suspicious/noArrayIndexKey: a column's position is its identity
							key={i}
							align={column.right ? "right" : "left"}
							style={{
								padding: "0 8px 6px",
								fontFamily: fonts.mono,
								fontSize: "10px",
								letterSpacing: "0.1em",
								textTransform: "uppercase",
								color: palette.faint,
								borderBottom: `1px solid ${palette.line}`,
								whiteSpace: "nowrap",
							}}
						>
							{column.label}
						</td>
					))}
				</tr>
				{rows.map((cells, r) => {
					const striped = r % 2 === 1;
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: a row's position is its identity
						<tr key={r}>
							{columns.map((column, i) => {
								const cell = cells[i] ?? { value: "" };
								return (
									<td
										// biome-ignore lint/suspicious/noArrayIndexKey: a column's position is its identity
										key={i}
										align={column.right ? "right" : "left"}
										style={{ ...(striped ? { backgroundColor: palette.hair } : {}), ...cellStyle(cell, column, false) }}
									>
										{cell.html ?? cell.value}
									</td>
								);
							})}
						</tr>
					);
				})}
				{total === undefined ? null : (
					<tr>
						{columns.map((column, i) => {
							const cell = total[i] ?? { value: "" };
							return (
								<td
									// biome-ignore lint/suspicious/noArrayIndexKey: a column's position is its identity
									key={i}
									align={column.right ? "right" : "left"}
									style={{ backgroundColor: palette.line, ...cellStyle(cell, column, true) }}
								>
									{cell.html ?? cell.value}
								</td>
							);
						})}
					</tr>
				)}
			</tbody>
		</table>
	);
}

/* ---------- recruiter ---------- */

export type FaintSpanProps = { children?: ReactNode };

/** A quiet aside inside a list row: a note after a name, a count after a list. */
export function FaintSpan({ children }: FaintSpanProps) {
	const { palette } = useEmailTheme();
	return <span style={{ color: palette.faint }}>{children}</span>;
}

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
